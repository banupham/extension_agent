'use strict';

const TARGET_TRACKING_MODES = new Set(['fixed', 'follow-live']);
const FOLLOW_LIVE_ACTION_TYPES = new Set(['click', 'hover', 'hoverAndObserve']);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeTargetTracking(value, fallback = 'fixed') {
  const mode = String(value || fallback).trim().toLowerCase();
  if (!TARGET_TRACKING_MODES.has(mode)) throw new Error(`unsupported_target_tracking:${mode || '<empty>'}`);
  return mode;
}

function targetIdentity(target) {
  return {
    tag: normalizeText(target?.tag),
    role: normalizeText(target?.role),
    label: normalizeText(target?.label)
  };
}

function sameTargetIdentity(a, b) {
  const left = targetIdentity(a);
  const right = targetIdentity(b);
  return left.tag === right.tag && left.role === right.role && left.label === right.label;
}

function canFollowLiveTarget(mappedAction, target, observation) {
  if (!FOLLOW_LIVE_ACTION_TYPES.has(String(mappedAction?.type || ''))) return false;
  if (!target?.ref || !target?.rect) return false;
  if (Number(target?.frameDepth || 0) !== 0) return false;
  if (!normalizeText(target?.label)) return false;

  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const matches = elements.filter(element =>
    element?.visible !== false &&
    element?.enabled !== false &&
    Number(element?.frameDepth || 0) === 0 &&
    sameTargetIdentity(element, target)
  );
  return matches.length === 1;
}

function resolveTargetTrackingMode({ mappedAction, target, observation, requested = 'auto' } = {}) {
  const mode = String(requested || 'auto').trim().toLowerCase();
  if (mode === 'fixed') return 'fixed';
  if (mode === 'follow-live') {
    if (!canFollowLiveTarget(mappedAction, target, observation)) {
      throw new Error('follow_live_target_not_trackable');
    }
    return 'follow-live';
  }
  if (mode !== 'auto') throw new Error(`unsupported_target_tracking:${mode || '<empty>'}`);
  return canFollowLiveTarget(mappedAction, target, observation) ? 'follow-live' : 'fixed';
}

function withTargetTrackingBehavior(behavior, mode = 'fixed') {
  if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) throw new Error('behavior_required');
  const targetTracking = normalizeTargetTracking(mode);
  if (!behavior.pointer || typeof behavior.pointer !== 'object' || Array.isArray(behavior.pointer)) {
    throw new Error('pointer_behavior_required_for_target_tracking');
  }
  return {
    ...behavior,
    pointer: {
      ...behavior.pointer,
      targetTracking
    },
    metadata: {
      ...(behavior.metadata && typeof behavior.metadata === 'object' ? behavior.metadata : {}),
      targetTracking
    }
  };
}

function trackingTargetDescriptor(target) {
  if (!target || typeof target !== 'object') throw new Error('tracking_target_required');
  if (!target.ref) throw new Error('tracking_target_ref_required');
  if (!target.rect) throw new Error('tracking_target_rect_required');
  return {
    ref: String(target.ref),
    tag: target.tag == null ? null : String(target.tag),
    role: target.role == null ? null : String(target.role),
    label: target.label == null ? '' : String(target.label),
    frameDepth: Number.isInteger(Number(target.frameDepth)) ? Number(target.frameDepth) : 0,
    rect: {
      x: Number(target.rect.x),
      y: Number(target.rect.y),
      width: Number(target.rect.width),
      height: Number(target.rect.height)
    }
  };
}

function withTargetTrackingPlan(plan, behavior, target) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('cdp_plan_required');
  const targetTracking = normalizeTargetTracking(behavior?.pointer?.targetTracking || 'fixed');
  if (targetTracking === 'fixed') return plan;
  return {
    ...plan,
    targetTracking,
    trackingTarget: trackingTargetDescriptor(target)
  };
}

module.exports = {
  TARGET_TRACKING_MODES,
  FOLLOW_LIVE_ACTION_TYPES,
  normalizeText,
  normalizeTargetTracking,
  targetIdentity,
  sameTargetIdentity,
  canFollowLiveTarget,
  resolveTargetTrackingMode,
  withTargetTrackingBehavior,
  trackingTargetDescriptor,
  withTargetTrackingPlan
};
