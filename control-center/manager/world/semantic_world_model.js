'use strict';

const SEMANTIC_WORLD_MODEL_VERSION = '0.1.0';

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function hostFor(url) {
  try {
    return normalizeLower(new URL(String(url || '')).hostname).replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function primitiveSignals(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) continue;
    out[String(key)] = value;
  }
  return out;
}

function sanitizeTabs(browserContext) {
  const tabs = Array.isArray(browserContext?.tabs) ? browserContext.tabs : [];
  return tabs.map(tab => ({
    title: normalizeText(tab?.title),
    url: normalizeText(tab?.url),
    host: hostFor(tab?.url),
    active: tab?.active === true
  }));
}

function buildSemanticWorldModel(input = {}) {
  const page = input.page || null;
  const browserContext = input.browserContext || null;
  const elements = Array.isArray(page?.interactiveElements) ? page.interactiveElements : [];
  const visibleElements = elements.filter(element => element?.visible !== false);
  const visibleLabels = unique(visibleElements.map(element => element?.label));
  const visibleRoles = unique(visibleElements.map(element => element?.role));
  const signals = primitiveSignals(page?.pageSignals);
  const tabs = sanitizeTabs(browserContext);
  const pageUrl = normalizeText(page?.url);
  const pageTitle = normalizeText(page?.title);
  const pageHost = hostFor(pageUrl);
  const signalText = Object.values(signals).map(value => String(value == null ? '' : value));

  return {
    semanticWorldModelVersion: SEMANTIC_WORLD_MODEL_VERSION,
    page: {
      url: pageUrl,
      title: pageTitle,
      host: pageHost
    },
    ui: {
      visibleLabels,
      visibleRoles
    },
    browser: {
      tabs
    },
    signals,
    semantic: {
      siteIdentity: unique([
        pageHost,
        pageTitle,
        ...tabs.flatMap(tab => [tab.host, tab.title])
      ]),
      contentText: unique([
        pageTitle,
        ...visibleLabels,
        ...signalText
      ])
    },
    privacy: {
      observationLocalRefsStored: false,
      rawCoordinatesStored: false,
      selectorsStored: false,
      tabIdsStored: false,
      privateReasoningStored: false
    }
  };
}

function semanticValues(model, key) {
  const world = model || buildSemanticWorldModel();
  if (key === 'page.url') return world.page?.url ? [world.page.url] : [];
  if (key === 'page.title') return world.page?.title ? [world.page.title] : [];
  if (key === 'page.host') return world.page?.host ? [world.page.host] : [];
  if (key === 'ui.visibleLabel') return Array.isArray(world.ui?.visibleLabels) ? world.ui.visibleLabels : [];
  if (key === 'ui.visibleRole') return Array.isArray(world.ui?.visibleRoles) ? world.ui.visibleRoles : [];
  if (key === 'browser.tabUrl') return (world.browser?.tabs || []).map(tab => tab.url).filter(Boolean);
  if (key === 'browser.tabTitle') return (world.browser?.tabs || []).map(tab => tab.title).filter(Boolean);
  if (key === 'browser.tabHost') return (world.browser?.tabs || []).map(tab => tab.host).filter(Boolean);
  if (key === 'site.identity') return Array.isArray(world.semantic?.siteIdentity) ? world.semantic.siteIdentity : [];
  if (key === 'content.semanticText') return Array.isArray(world.semantic?.contentText) ? world.semantic.contentText : [];
  if (String(key || '').startsWith('signal.')) {
    const signalKey = String(key).slice('signal.'.length);
    return Object.prototype.hasOwnProperty.call(world.signals || {}, signalKey) ? [world.signals[signalKey]] : [];
  }
  return [];
}

function primitiveEquals(actual, expected) {
  if (expected === null) return actual == null;
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected;
  return normalizeLower(actual) === normalizeLower(expected);
}

function semanticFactMatches(model, criterion = {}) {
  const values = semanticValues(model, criterion.key);
  const operator = String(criterion.operator || 'equals');
  if (operator === 'exists') return criterion.value === false ? values.length === 0 : values.length > 0;
  if (operator === 'equals') return values.some(value => primitiveEquals(value, criterion.value));
  if (operator === 'includes') {
    const expected = normalizeLower(criterion.value);
    if (!expected) return false;
    return values.some(value => normalizeLower(value).includes(expected));
  }
  return false;
}

module.exports = {
  SEMANTIC_WORLD_MODEL_VERSION,
  normalizeText,
  normalizeLower,
  unique,
  hostFor,
  primitiveSignals,
  sanitizeTabs,
  buildSemanticWorldModel,
  semanticValues,
  semanticFactMatches
};
