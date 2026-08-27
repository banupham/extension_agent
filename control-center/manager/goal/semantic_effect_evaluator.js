'use strict';

const SEMANTIC_EFFECT_VERSION = '0.1.0';
const EFFECT_STATUSES = new Set(['execution_failed', 'no_effect', 'effect_observed']);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function elementIdentity(element) {
  if (!element || typeof element !== 'object') return null;
  const label = normalizeText(element.label);
  const tag = normalizeText(element.tag);
  const role = normalizeText(element.role);
  if (!label && !tag && !role) return null;
  return `${tag}|${role}|${label}`;
}

function elementState(element) {
  if (!element || typeof element !== 'object') return null;
  return {
    visible: element.visible !== false,
    enabled: element.enabled !== false,
    editable: element.editable === true,
    checked: typeof element.checked === 'boolean' ? element.checked : null,
    selectedValue: element.selectedValue == null ? null : String(element.selectedValue),
    selectedIndex: Number.isInteger(Number(element.selectedIndex)) ? Number(element.selectedIndex) : null,
    rangeValue: Number.isFinite(Number(element.rangeValue)) ? Number(element.rangeValue) : null
  };
}

function samePrimitive(a, b) {
  return a === b;
}

function elementStateChangeCodes(before, after, prefix = 'target') {
  if (!before || !after) return [];
  const a = elementState(before);
  const b = elementState(after);
  const fields = [
    ['visible', 'visible'],
    ['enabled', 'enabled'],
    ['editable', 'editable'],
    ['checked', 'checked'],
    ['selectedValue', 'selected_value'],
    ['selectedIndex', 'selected_index'],
    ['rangeValue', 'range_value']
  ];
  return fields
    .filter(([field]) => !samePrimitive(a[field], b[field]))
    .map(([, code]) => `${prefix}_${code}_changed`);
}

function elementsFor(observation) {
  return Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
}

function findTargetBefore(action, before) {
  const ref = typeof action?.targetRef === 'string' ? action.targetRef : null;
  if (!ref) return null;
  return elementsFor(before).find(element => element?.ref === ref) || null;
}

function findSemanticMatches(observation, target) {
  const identity = elementIdentity(target);
  if (!identity) return [];
  return elementsFor(observation).filter(element => elementIdentity(element) === identity);
}

function focusedIdentity(observation) {
  const ref = typeof observation?.focusedRef === 'string' ? observation.focusedRef : null;
  if (!ref) return null;
  return elementIdentity(elementsFor(observation).find(element => element?.ref === ref) || null);
}

function multiset(items) {
  const out = new Map();
  for (const item of items) out.set(item, (out.get(item) || 0) + 1);
  return out;
}

function semanticElementDelta(before, after) {
  const beforeIds = elementsFor(before).map(elementIdentity).filter(Boolean);
  const afterIds = elementsFor(after).map(elementIdentity).filter(Boolean);
  const a = multiset(beforeIds);
  const b = multiset(afterIds);
  let added = 0;
  let removed = 0;
  for (const [key, count] of b) added += Math.max(0, count - (a.get(key) || 0));
  for (const [key, count] of a) removed += Math.max(0, count - (b.get(key) || 0));
  return { added, removed };
}

function tabSignature(tab) {
  if (!tab || typeof tab !== 'object') return '';
  return JSON.stringify({
    title: String(tab.title || ''),
    url: String(tab.url || ''),
    active: tab.active === true
  });
}

function browserContextChanged(beforeBrowserContext, afterBrowserContext) {
  const before = Array.isArray(beforeBrowserContext?.tabs) ? beforeBrowserContext.tabs : [];
  const after = Array.isArray(afterBrowserContext?.tabs) ? afterBrowserContext.tabs : [];
  const a = before.map(tabSignature).sort();
  const b = after.map(tabSignature).sort();
  return JSON.stringify(a) !== JSON.stringify(b);
}

function evaluateActionEffect(input = {}) {
  const execution = input.execution || null;
  const executionOk = execution?.ok === true;
  if (!executionOk) {
    return {
      semanticEffectVersion: SEMANTIC_EFFECT_VERSION,
      status: 'execution_failed',
      confidence: 1,
      codes: ['execution_failed'],
      targetIdentityAvailable: false,
      semanticChangeCount: 0
    };
  }

  const before = input.before || null;
  const after = input.after || null;
  const action = input.action || null;
  const codes = [];
  let strongEvidence = 0;

  if (before && after) {
    if (String(before.url || '') !== String(after.url || '')) {
      codes.push('page_url_changed');
      strongEvidence += 1;
    }
    if (String(before.title || '') !== String(after.title || '')) {
      codes.push('page_title_changed');
      strongEvidence += 1;
    }

    const beforeScrollX = Number(before?.scroll?.x || 0);
    const beforeScrollY = Number(before?.scroll?.y || 0);
    const afterScrollX = Number(after?.scroll?.x || 0);
    const afterScrollY = Number(after?.scroll?.y || 0);
    if (beforeScrollX !== afterScrollX || beforeScrollY !== afterScrollY) codes.push('scroll_changed');

    if (focusedIdentity(before) !== focusedIdentity(after)) codes.push('focus_changed');

    const targetBefore = findTargetBefore(action, before);
    if (targetBefore) {
      const matches = findSemanticMatches(after, targetBefore);
      if (!matches.length) {
        codes.push('target_disappeared');
        strongEvidence += 1;
      } else {
        const targetCodes = matches.flatMap(match => elementStateChangeCodes(targetBefore, match));
        for (const code of [...new Set(targetCodes)]) {
          codes.push(code);
          strongEvidence += 1;
        }
      }
    }

    const elementDelta = semanticElementDelta(before, after);
    if (elementDelta.added > 0) codes.push('elements_added');
    if (elementDelta.removed > 0) codes.push('elements_removed');
  }

  if (browserContextChanged(input.beforeBrowserContext, input.afterBrowserContext)) {
    codes.push('browser_context_changed');
    strongEvidence += 1;
  }

  const uniqueCodes = [...new Set(codes)];
  const status = uniqueCodes.length ? 'effect_observed' : 'no_effect';
  const confidence = status === 'no_effect' ? 0.9 : (strongEvidence > 0 ? 0.95 : 0.65);

  return {
    semanticEffectVersion: SEMANTIC_EFFECT_VERSION,
    status,
    confidence,
    codes: uniqueCodes,
    targetIdentityAvailable: !!findTargetBefore(action, before),
    semanticChangeCount: uniqueCodes.length
  };
}

module.exports = {
  SEMANTIC_EFFECT_VERSION,
  EFFECT_STATUSES,
  normalizeText,
  elementIdentity,
  elementState,
  elementStateChangeCodes,
  semanticElementDelta,
  browserContextChanged,
  evaluateActionEffect
};
