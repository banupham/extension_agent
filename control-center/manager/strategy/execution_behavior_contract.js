'use strict';

const BEHAVIOR_CONTRACT_VERSION = '0.1.0';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validateExecutionBehavior(value) {
  if (!isPlainObject(value)) throw new Error('execution behavior must be an object');
  const actionId = typeof value.actionId === 'string' && value.actionId.trim() ? value.actionId.trim() : null;
  const actionType = typeof value.actionType === 'string' && value.actionType.trim() ? value.actionType.trim() : null;
  if (!actionType) throw new Error('execution behavior requires actionType');

  return {
    behaviorVersion: BEHAVIOR_CONTRACT_VERSION,
    actionId,
    actionType,
    targetRef: typeof value.targetRef === 'string' ? value.targetRef : null,
    profile: typeof value.profile === 'string' ? value.profile : 'empirical-v0',
    pointer: isPlainObject(value.pointer) ? {
      profile: typeof value.pointer.profile === 'string' ? value.pointer.profile : 'empirical',
      targetAcquisition: typeof value.pointer.targetAcquisition === 'string' ? value.pointer.targetAcquisition : 'adaptive',
      dwellBeforeDownMs: finiteOrNull(value.pointer.dwellBeforeDownMs),
      holdMs: finiteOrNull(value.pointer.holdMs),
      trajectorySeed: value.pointer.trajectorySeed ?? null,
      constraints: isPlainObject(value.pointer.constraints) ? value.pointer.constraints : {}
    } : null,
    keyboard: isPlainObject(value.keyboard) ? {
      profile: typeof value.keyboard.profile === 'string' ? value.keyboard.profile : 'empirical',
      initialPauseMs: finiteOrNull(value.keyboard.initialPauseMs),
      burstProfile: typeof value.keyboard.burstProfile === 'string' ? value.keyboard.burstProfile : null,
      timingSeed: value.keyboard.timingSeed ?? null,
      constraints: isPlainObject(value.keyboard.constraints) ? value.keyboard.constraints : {}
    } : null,
    scroll: isPlainObject(value.scroll) ? {
      profile: typeof value.scroll.profile === 'string' ? value.scroll.profile : 'empirical',
      axis: value.scroll.axis === 'horizontal' ? 'horizontal' : 'vertical',
      burstProfile: typeof value.scroll.burstProfile === 'string' ? value.scroll.burstProfile : null,
      timingSeed: value.scroll.timingSeed ?? null,
      constraints: isPlainObject(value.scroll.constraints) ? value.scroll.constraints : {}
    } : null,
    timing: isPlainObject(value.timing) ? value.timing : { profile: 'empirical' },
    metadata: isPlainObject(value.metadata) ? value.metadata : {}
  };
}

function defaultBehaviorFor(mappedAction) {
  if (!mappedAction || typeof mappedAction.type !== 'string') throw new Error('mapped action required');
  const family = mappedAction.behaviorFamily || 'generic';
  const base = {
    actionType: mappedAction.type,
    targetRef: mappedAction.targetRef || null,
    profile: 'empirical-v0',
    timing: { profile: 'empirical' },
    metadata: { behaviorFamily: family }
  };

  if (String(family).startsWith('pointer-') || family === 'focus-acquisition' || family === 'form-control') {
    base.pointer = { profile: 'empirical', targetAcquisition: 'adaptive', constraints: {} };
  }
  if (String(family).startsWith('keyboard-')) {
    base.keyboard = { profile: 'empirical', burstProfile: 'context-conditioned', constraints: {} };
  }
  if (String(family).startsWith('scroll-')) {
    base.scroll = {
      profile: 'empirical',
      axis: family === 'scroll-horizontal' ? 'horizontal' : 'vertical',
      burstProfile: 'context-conditioned',
      constraints: {}
    };
  }
  return validateExecutionBehavior(base);
}

module.exports = {
  BEHAVIOR_CONTRACT_VERSION,
  validateExecutionBehavior,
  defaultBehaviorFor
};
