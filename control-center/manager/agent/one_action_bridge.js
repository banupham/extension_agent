'use strict';

const { mapAgentAction } = require('../strategy/agent_action_contract.js');
const { sampledBehavior } = require('../behavior/empirical_policy.js');
const { buildCdpPlan } = require('../execution/cdp_plan.js');
const { buildDragCdpPlan } = require('../execution/drag_plan.js');
const { buildFormCdpPlan } = require('../execution/form_plan.js');
const { buildMediaCdpPlan } = require('../execution/media_plan.js');
const { buildWaitAndObservePlan } = require('../execution/wait_plan.js');

const BRIDGE_VERSION = '0.2.1';
const BROWSER_ACTION_VERSION = '0.1.0';
const TAB_LIFECYCLE_ACTION_TYPES = new Set(['switchTab', 'openNewTab', 'closeTab']);
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
  'click', 'doubleClick', 'hover', 'moveTo', 'drag', 'focus',
  'pressKey', 'keyCombo', 'typeText', 'setChecked', 'selectOption', 'waitAndObserve'
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

  const context = {
    pointerStart: pointerStartFor(before, options.previousPointer || before.agentPointer || null),
    viewportCenter: pointerStartFor(before, null),
    rng: options.rng || Math.random
  };
  const cdpPlan = mappedAction.type === 'drag'
    ? buildDragCdpPlan({ mappedAction, behavior, source: target, destination, context })
    : ['setChecked', 'selectOption'].includes(mappedAction.type)
      ? buildFormCdpPlan({ mappedAction, behavior, target, context })
      : ['setVolume', 'seek', 'changePlaybackRate'].includes(mappedAction.type)
        ? buildMediaCdpPlan({ mappedAction, behavior, target, context })
        : mappedAction.type === 'waitAndObserve'
          ? buildWaitAndObservePlan({ mappedAction, behavior })
          : buildCdpPlan({ mappedAction, behavior, target, context });

  const execution = await runtime.executePlan({
    observationId: before.observationId,
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
      selectorUsedByStrategy: false,
      literalTrajectoryReplay: false
    }
  };
}

module.exports = {
  BRIDGE_VERSION,
  BROWSER_ACTION_VERSION,
  TAB_LIFECYCLE_ACTION_TYPES,
  DEFAULT_POST_ACTION_SETTLE,
  DEFAULT_WAIT_AND_OBSERVE_SETTLE,
  SETTLE_ACTION_TYPES,
  findTarget,
  pointerStartFor,
  semanticObservationFingerprint,
  browserContextFingerprint,
  buildBrowserAction,
  settlePolicy,
  observeAfterAction,
  decideOneAction,
  runOneAction
};
