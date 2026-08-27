'use strict';

const { mapAgentAction } = require('../strategy/agent_action_contract.js');
const { sampledBehavior } = require('../behavior/empirical_policy.js');
const { buildCdpPlan } = require('../execution/cdp_plan.js');
const { buildDragCdpPlan } = require('../execution/drag_plan.js');
const { buildFormCdpPlan } = require('../execution/form_plan.js');
const { buildMediaCdpPlan } = require('../execution/media_plan.js');
const { buildWaitAndObservePlan } = require('../execution/wait_plan.js');

const BRIDGE_VERSION = '0.3.0';
const BROWSER_ACTION_VERSION = '0.1.0';
const TAB_LIFECYCLE_ACTION_TYPES = new Set(['switchTab', 'openNewTab', 'closeTab']);
const TARGET_ACQUISITION_ACTION_TYPES = new Set([
  'click', 'doubleClick', 'hover', 'hoverAndObserve', 'moveTo', 'focus',
  'toggle', 'submit', 'play', 'pause', 'mute', 'unmute', 'dismiss',
  'setChecked', 'selectOption', 'setVolume', 'seek', 'changePlaybackRate'
]);
const DEFAULT_POST_ACTION_SETTLE = Object.freeze({
  pollMs: 80,
  minWindowMs: 400,
  maxWindowMs: 800,
  stableSamples: 2
});
const DEFAULT_WAIT_AND_OBSERVE_SETTLE = Object.freeze({
  pollMs: 80,
  minWindowMs: 400,
  maxWindowMs: 6000,
  stableSamples: 2
});
const SETTLE_ACTION_TYPES = new Set([
  'click', 'doubleClick', 'hover', 'hoverAndObserve', 'moveTo', 'drag', 'focus',
  'toggle', 'submit', 'play', 'pause', 'mute', 'unmute', 'dismiss',
  'pressKey', 'keyCombo', 'typeText', 'replaceText', 'clear',
  'setChecked', 'selectOption', 'setVolume', 'seek', 'changePlaybackRate',
  'waitAndObserve'
]);

function findTarget(observation, targetRef) {
  if (!targetRef) return null;
  const targets = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return targets.find(target => target?.ref === targetRef) || null;
}

function pointerStartFor(observation, previousPointer = null) {
  if (previousPointer && Number.isFinite(Number(previousPointer.x)) && Number.isFinite(Number(previousPointer.y))) {
    return { x: Number(previousPointer.x), y: Number(previousPointer.y) };
  }
  const viewport = observation?.viewport || {};
  const width = Number(viewport.width), height = Number(viewport.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: width / 2, y: height / 2 };
  }
  return { x: 400, y: 300 };
}

function normalizeIdentityText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function targetCenterInViewport(target, observation, marginPx = 4) {
  const rect = target?.rect || null;
  const viewport = observation?.viewport || {};
  const x = Number(rect?.x), y = Number(rect?.y), width = Number(rect?.width), height = Number(rect?.height);
  const viewportWidth = Number(viewport.width), viewportHeight = Number(viewport.height);
  if (![x, y, width, height, viewportWidth, viewportHeight].every(Number.isFinite)) return true;
  if (width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return true;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const margin = Math.max(0, Number(marginPx) || 0);
  return centerX >= margin && centerX <= viewportWidth - margin && centerY >= margin && centerY <= viewportHeight - margin;
}

function targetNeedsAcquisition(mappedAction, target, observation) {
  if (!target || !TARGET_ACQUISITION_ACTION_TYPES.has(mappedAction?.type)) return false;
  return !targetCenterInViewport(target, observation);
}

function sameSemanticTarget(a, b) {
  if (!a || !b) return false;
  return normalizeIdentityText(a.label) === normalizeIdentityText(b.label) &&
    normalizeIdentityText(a.tag) === normalizeIdentityText(b.tag) &&
    normalizeIdentityText(a.role) === normalizeIdentityText(b.role) &&
    !!a.editable === !!b.editable;
}

function findEquivalentTarget(observation, previousTarget) {
  if (!previousTarget) return null;
  const exactRef = findTarget(observation, previousTarget.ref);
  if (exactRef && sameSemanticTarget(exactRef, previousTarget)) return exactRef;
  const targets = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const candidates = targets.filter(target =>
    target?.visible !== false && target?.enabled !== false && sameSemanticTarget(target, previousTarget)
  );
  return candidates.length === 1 ? candidates[0] : null;
}

async function acquireTargetIfNeeded(runtime, before, mappedAction, target, behavior, options = {}) {
  if (!targetNeedsAcquisition(mappedAction, target, before)) {
    return {
      used: false,
      observation: before,
      target,
      execution: null,
      observationIdBefore: before?.observationId || null,
      observationIdAfter: before?.observationId || null,
      originalTargetRef: target?.ref || null,
      resolvedTargetRef: target?.ref || null
    };
  }

  const context = {
    pointerStart: pointerStartFor(before, options.previousPointer || before.agentPointer || null),
    viewportCenter: pointerStartFor(before, null),
    rng: options.rng || Math.random
  };
  const acquisitionAction = {
    type: 'scrollIntoView',
    targetRef: target.ref,
    args: {},
    behaviorFamily: 'scroll-vertical'
  };
  const acquisitionPlan = buildCdpPlan({
    mappedAction: acquisitionAction,
    behavior,
    target,
    context
  });
  const execution = await runtime.executePlan({
    observationId: before.observationId,
    plan: acquisitionPlan
  });
  if (execution?.ok !== true) throw new Error('target_acquisition_execution_failed');

  const observation = await runtime.observe();
  if (!observation?.observationId) throw new Error('target_acquisition_observation_missing');
  const refreshedTarget = findEquivalentTarget(observation, target);
  if (!refreshedTarget) throw new Error('target_acquisition_target_not_found');
  if (targetNeedsAcquisition(mappedAction, refreshedTarget, observation)) {
    throw new Error('target_acquisition_incomplete');
  }

  return {
    used: true,
    observation,
    target: refreshedTarget,
    execution,
    observationIdBefore: before.observationId,
    observationIdAfter: observation.observationId,
    originalTargetRef: target.ref,
    resolvedTargetRef: refreshedTarget.ref
  };
}

function semanticObservationFingerprint(observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return JSON.stringify({
    url: String(observation?.url || ''),
    title: String(observation?.title || ''),
    focusedRef: observation?.focusedRef || null,
    scroll: {
      x: Number(observation?.scroll?.x || 0),
      y: Number(observation?.scroll?.y || 0)
    },
    elements: elements.map(element => ({
      tag: element?.tag || null,
      role: element?.role || null,
      label: String(element?.label || ''),
      editable: !!element?.editable,
      enabled: element?.enabled !== false,
      visible: element?.visible !== false,
      checked: typeof element?.checked === 'boolean' ? element.checked : null,
      selectedValue: element?.selectedValue == null ? null : String(element.selectedValue),
      selectedIndex: Number.isInteger(Number(element?.selectedIndex)) ? Number(element.selectedIndex) : null
    }))
  });
}

function browserContextFingerprint(tabs) {
  const normalized = (Array.isArray(tabs) ? tabs : []).map(tab => ({
    tabId: Number(tab?.tabId),
    windowId: Number.isInteger(Number(tab?.windowId)) ? Number(tab.windowId) : null,
    active: tab?.active === true,
    title: String(tab?.title || ''),
    url: String(tab?.url || '')
  })).sort((a, b) => a.tabId - b.tabId);
  return JSON.stringify(normalized);
}

function buildBrowserAction(mappedAction) {
  if (!TAB_LIFECYCLE_ACTION_TYPES.has(mappedAction?.type)) throw new Error('browser_action_type_required');
  const args = mappedAction?.args && typeof mappedAction.args === 'object' ? { ...mappedAction.args } : {};
  if (mappedAction.type === 'openNewTab' && !String(args.url || '').trim()) {
    throw new Error('openNewTab requires args.url');
  }
  return {
    browserActionVersion: BROWSER_ACTION_VERSION,
    actionType: mappedAction.type,
    args
  };
}

function settlePolicy(options, mappedAction) {
  const requested = options?.postActionSettle;
  if (requested === false || requested?.enabled === false) return null;
  if (!SETTLE_ACTION_TYPES.has(mappedAction?.type)) return null;
  const source = requested && typeof requested === 'object' ? requested : {};
  const defaults = mappedAction?.type === 'waitAndObserve'
    ? DEFAULT_WAIT_AND_OBSERVE_SETTLE
    : DEFAULT_POST_ACTION_SETTLE;
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const pollMs = positive(source.pollMs, defaults.pollMs);
  const minWindowMs = positive(source.minWindowMs, defaults.minWindowMs);
  const maxWindowMs = Math.max(minWindowMs, positive(source.maxWindowMs, defaults.maxWindowMs));
  const stableSamples = Math.max(2, Math.round(positive(source.stableSamples, defaults.stableSamples)));
  const requireSemanticChange = mappedAction?.type === 'waitAndObserve';
  return { pollMs, minWindowMs, maxWindowMs, stableSamples, requireSemanticChange };
}

async function observeAfterAction(runtime, mappedAction, options = {}) {
  const policy = settlePolicy(options, mappedAction);
  const sleep = typeof options?.settleSleep === 'function'
    ? options.settleSleep
    : ms => new Promise(resolve => setTimeout(resolve, ms));

  let observation = await runtime.observe();
  if (!policy) {
    return {
      observation,
      metadata: { mode: 'immediate', samples: 1, waitedMs: 0, semanticChanged: false, deadlineReached: false }
    };
  }

  let signature = semanticObservationFingerprint(observation);
  let stableSamples = 1;
  let samples = 1;
  let waitedMs = 0;
  let semanticChanged = false;

  while (waitedMs < policy.maxWindowMs) {
    const waitMs = Math.min(policy.pollMs, policy.maxWindowMs - waitedMs);
    if (waitMs <= 0) break;
    await sleep(waitMs);
    waitedMs += waitMs;

    const next = await runtime.observe();
    const nextSignature = semanticObservationFingerprint(next);
    samples += 1;
    if (nextSignature === signature) {
      stableSamples += 1;
    } else {
      semanticChanged = true;
      stableSamples = 1;
      signature = nextSignature;
    }
    observation = next;

    const changeRequirementMet = !policy.requireSemanticChange || semanticChanged;
    if (waitedMs >= policy.minWindowMs && stableSamples >= policy.stableSamples && changeRequirementMet) {
      return {
        observation,
        metadata: {
          mode: 'settled', samples, waitedMs, semanticChanged,
          stableSamples, deadlineReached: false,
          policy
        }
      };
    }
  }

  return {
    observation,
    metadata: {
      mode: 'settled', samples, waitedMs, semanticChanged,
      stableSamples, deadlineReached: true,
      policy
    }
  };
}

async function decideOneAction(options, observation) {
  if (typeof options?.decide === 'function') {
    const decision = await options.decide(observation);
    if (!decision || typeof decision !== 'object') throw new Error('brain_decision_missing');
    if (decision.status && decision.status !== 'act') {
      return { terminal: true, decision };
    }
    const action = decision.action || decision.agentAction || null;
    if (!action) throw new Error('brain_action_missing');
    return { terminal: false, decision, action };
  }
  if (options?.agentAction) {
    return {
      terminal: false,
      decision: { status: 'act', source: 'provided-agent-action', action: options.agentAction },
      action: options.agentAction
    };
  }
  throw new Error('decide_or_agentAction_required');
}

async function runOneAction(options) {
  const runtime = options?.runtime;
  if (!runtime || typeof runtime.observe !== 'function' || typeof runtime.executePlan !== 'function') {
    throw new Error('runtime observe/executePlan required');
  }

  const before = await runtime.observe();
  if (!before?.observationId) throw new Error('observation_id_missing');

  const chosen = await decideOneAction(options, before);
  if (chosen.terminal) {
    return {
      bridgeVersion: BRIDGE_VERSION,
      beforeObservationId: before.observationId,
      afterObservationId: null,
      decision: chosen.decision,
      mappedAction: null,
      behavior: null,
      cdpPlan: null,
      browserAction: null,
      execution: null,
      targetAcquisition: null,
      before,
      after: null,
      beforeBrowserContext: null,
      afterBrowserContext: null,
      postActionObservation: null,
      invariant: {
        oneActionOnly: true,
        actionExecuted: false,
        reObservedAfterExecution: false,
        selectorUsedByStrategy: false,
        literalTrajectoryReplay: false
      }
    };
  }

  const mappedAction = mapAgentAction(chosen.action);
  const target = mappedAction.targetRef ? findTarget(before, mappedAction.targetRef) : null;
  if (mappedAction.targetRef && !target) throw new Error('target_ref_not_in_observation');

  const destinationRef = mappedAction.type === 'drag'
    ? String(mappedAction.args?.destinationRef || '').trim()
    : '';
  const destination = destinationRef ? findTarget(before, destinationRef) : null;
  if (destinationRef && !destination) throw new Error('destination_ref_not_in_observation');

  const behavior = sampledBehavior({
    baseline: options.baseline || null,
    mappedAction,
    target,
    rng: options.rng || Math.random
  });

  if (TAB_LIFECYCLE_ACTION_TYPES.has(mappedAction.type)) {
    if (typeof runtime.executeBrowserAction !== 'function') throw new Error('runtime executeBrowserAction required');
    if (typeof runtime.listTabs !== 'function') throw new Error('runtime listTabs required for browser-context observation');

    const beforeTabs = await runtime.listTabs({ mode: 'all' });
    const browserAction = buildBrowserAction(mappedAction);
    const execution = await runtime.executeBrowserAction({ action: browserAction });
    const afterTabs = await runtime.listTabs({ mode: 'all' });
    const semanticChanged = browserContextFingerprint(beforeTabs) !== browserContextFingerprint(afterTabs);

    return {
      bridgeVersion: BRIDGE_VERSION,
      beforeObservationId: before.observationId,
      afterObservationId: null,
      decision: chosen.decision,
      mappedAction,
      behavior,
      cdpPlan: null,
      browserAction,
      execution,
      targetAcquisition: null,
      before,
      after: null,
      beforeBrowserContext: { capturedAt: Date.now(), tabs: beforeTabs },
      afterBrowserContext: { capturedAt: Date.now(), tabs: afterTabs },
      postActionObservation: {
        mode: 'browser-context',
        samples: 1,
        waitedMs: 0,
        semanticChanged,
        deadlineReached: false
      },
      invariant: {
        oneActionOnly: true,
        actionExecuted: true,
        reObservedAfterExecution: true,
        reObservedSurface: 'browser-context',
        selectorUsedByStrategy: false,
        literalTrajectoryReplay: false
      }
    };
  }

  const acquired = mappedAction.type === 'drag'
    ? {
        used: false,
        observation: before,
        target,
        execution: null,
        observationIdBefore: before.observationId,
        observationIdAfter: before.observationId,
        originalTargetRef: target?.ref || null,
        resolvedTargetRef: target?.ref || null
      }
    : await acquireTargetIfNeeded(runtime, before, mappedAction, target, behavior, options);

  const actionObservation = acquired.observation || before;
  const actionTarget = acquired.target || target;
  const executionMappedAction = actionTarget && mappedAction.targetRef && actionTarget.ref !== mappedAction.targetRef
    ? { ...mappedAction, targetRef: actionTarget.ref }
    : mappedAction;
  const context = {
    pointerStart: pointerStartFor(actionObservation, options.previousPointer || actionObservation.agentPointer || before.agentPointer || null),
    viewportCenter: pointerStartFor(actionObservation, null),
    rng: options.rng || Math.random
  };
  const cdpPlan = executionMappedAction.type === 'drag'
    ? buildDragCdpPlan({ mappedAction: executionMappedAction, behavior, source: actionTarget, destination, context })
    : ['setChecked', 'selectOption'].includes(executionMappedAction.type)
      ? buildFormCdpPlan({ mappedAction: executionMappedAction, behavior, target: actionTarget, context })
      : ['setVolume', 'seek', 'changePlaybackRate'].includes(executionMappedAction.type)
        ? buildMediaCdpPlan({ mappedAction: executionMappedAction, behavior, target: actionTarget, context })
        : executionMappedAction.type === 'waitAndObserve'
          ? buildWaitAndObservePlan({ mappedAction: executionMappedAction, behavior })
          : buildCdpPlan({ mappedAction: executionMappedAction, behavior, target: actionTarget, context });

  const execution = await runtime.executePlan({
    observationId: actionObservation.observationId,
    plan: cdpPlan
  });

  const settled = await observeAfterAction(runtime, mappedAction, options);
  const after = settled.observation;

  return {
    bridgeVersion: BRIDGE_VERSION,
    beforeObservationId: before.observationId,
    afterObservationId: after?.observationId || null,
    decision: chosen.decision,
    mappedAction,
    behavior,
    cdpPlan,
    browserAction: null,
    execution,
    targetAcquisition: {
      used: acquired.used === true,
      observationIdBefore: acquired.observationIdBefore,
      observationIdAfter: acquired.observationIdAfter,
      originalTargetRef: acquired.originalTargetRef,
      resolvedTargetRef: acquired.resolvedTargetRef,
      execution: acquired.execution
    },
    before,
    after,
    beforeBrowserContext: null,
    afterBrowserContext: null,
    postActionObservation: settled.metadata,
    invariant: {
      oneActionOnly: true,
      actionExecuted: true,
      reObservedAfterExecution: !!after?.observationId,
      reObservedSurface: 'page',
      targetAcquisitionUsed: acquired.used === true,
      targetAcquisitionPlanCount: acquired.used === true ? 1 : 0,
      targetAcquisitionStayedWithinOneSemanticAction: true,
      selectorUsedByStrategy: false,
      literalTrajectoryReplay: false
    }
  };
}

module.exports = {
  BRIDGE_VERSION,
  BROWSER_ACTION_VERSION,
  TAB_LIFECYCLE_ACTION_TYPES,
  TARGET_ACQUISITION_ACTION_TYPES,
  DEFAULT_POST_ACTION_SETTLE,
  DEFAULT_WAIT_AND_OBSERVE_SETTLE,
  SETTLE_ACTION_TYPES,
  findTarget,
  pointerStartFor,
  normalizeIdentityText,
  targetCenterInViewport,
  targetNeedsAcquisition,
  sameSemanticTarget,
  findEquivalentTarget,
  acquireTargetIfNeeded,
  semanticObservationFingerprint,
  browserContextFingerprint,
  buildBrowserAction,
  settlePolicy,
  observeAfterAction,
  decideOneAction,
  runOneAction
};
