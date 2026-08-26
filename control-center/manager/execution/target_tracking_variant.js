'use strict';

const TARGET_TRACKING_MODES = new Set(['fixed', 'follow-live']);

function normalizeTargetTracking(value, fallback = 'fixed') {
  const mode = String(value || fallback).trim().toLowerCase();
  if (!TARGET_TRACKING_MODES.has(mode)) throw new Error(`unsupported_target_tracking:${mode || '<empty>'}`);
  return mode;
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
      targetTracking,
      experimentalTargetTracking: targetTracking === 'follow-live'
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
  normalizeTargetTracking,
  withTargetTrackingBehavior,
  trackingTargetDescriptor,
  withTargetTrackingPlan
};
