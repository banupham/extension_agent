'use strict';

const TAB_LIFECYCLE_PROVIDER_VERSION = '0.1.1';
const TAB_ACTION_TYPES = new Set(['switchTab', 'openNewTab', 'closeTab']);
const TAB_MATCH_KEYS = new Set(['title', 'titleIncludes', 'url', 'urlIncludes']);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function stripQuotes(value) {
  return normalizeText(value).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

function normalizeHttpUrl(value) {
  const raw = stripQuotes(value);
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : /^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)
      ? `https://${raw}`
      : null;
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch (_) {
    return null;
  }
}

function normalizeTabMatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!TAB_MATCH_KEYS.has(key)) continue;
    const text = stripQuotes(raw);
    if (text) out[key] = text;
  }
  return Object.keys(out).length ? out : null;
}

function tabMatchFromTarget(value) {
  const target = stripQuotes(value)
    .replace(/^(?:có\s+tên|tên|chứa|called|named)\s+/iu, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  if (!target) return null;
  const url = normalizeHttpUrl(target);
  if (url) return { urlIncludes: url.replace(/\/$/, '') };
  return { titleIncludes: target };
}

function tabIntentFromArgs(task = {}) {
  const args = task?.args && typeof task.args === 'object' ? task.args : {};
  const actionType = String(args.tabAction || args.actionType || '').trim();
  if (!TAB_ACTION_TYPES.has(actionType)) return null;
  if (actionType === 'openNewTab') {
    const url = normalizeHttpUrl(args.url);
    return url
      ? { actionType, url, source: 'task-args' }
      : { actionType, error: 'tab_open_url_required', source: 'task-args' };
  }
  const match = normalizeTabMatch(args.tabMatch || args.match) || tabMatchFromTarget(args.tabTitle || args.tabUrl || '');
  return match
    ? { actionType, match, source: 'task-args' }
    : { actionType, error: 'tab_target_required', source: 'task-args' };
}

function extractTabIntent(task = {}) {
  const fromArgs = tabIntentFromArgs(task);
  if (fromArgs) return fromArgs;

  const instruction = normalizeText(task?.instruction);
  if (!instruction) return null;

  const open = /(?:^|\b)(?:mở|tạo|open|create)\s+(?:một\s+|a\s+)?(?:tab|thẻ)\s+mới(?:\s+(?:tới|đến|vào|at|to))?\s*(.*)$/iu.exec(instruction);
  if (open) {
    const explicit = normalizeHttpUrl(task?.args?.url) || normalizeHttpUrl(open[1]);
    return explicit
      ? { actionType: 'openNewTab', url: explicit, source: 'instruction' }
      : { actionType: 'openNewTab', error: 'tab_open_url_required', source: 'instruction' };
  }

  const close = /(?:^|\b)(?:đóng|tắt|close)\s+(?:tab|thẻ)\s+(.+)$/iu.exec(instruction);
  if (close) {
    const match = tabMatchFromTarget(close[1]);
    return match
      ? { actionType: 'closeTab', match, source: 'instruction' }
      : { actionType: 'closeTab', error: 'tab_target_required', source: 'instruction' };
  }

  const switched = /(?:^|\b)(?:chuyển|đổi|qua|switch|change)\s+(?:(?:sang|qua|to)\s+)?(?:tab|thẻ)\s+(.+)$/iu.exec(instruction);
  if (switched) {
    const match = tabMatchFromTarget(switched[1]);
    return match
      ? { actionType: 'switchTab', match, source: 'instruction' }
      : { actionType: 'switchTab', error: 'tab_target_required', source: 'instruction' };
  }

  return null;
}

function tabMatches(tab, match) {
  if (!tab || !match) return false;
  if (match.title != null && normalizeText(tab.title) !== normalizeText(match.title)) return false;
  if (match.titleIncludes != null && !normalizeLower(tab.title).includes(normalizeLower(match.titleIncludes))) return false;
  if (match.url != null && String(tab.url || '') !== String(match.url)) return false;
  if (match.urlIncludes != null && !normalizeLower(tab.url).includes(normalizeLower(match.urlIncludes))) return false;
  return true;
}

function matchingTabs(browserContext, match) {
  const tabs = Array.isArray(browserContext?.tabs) ? browserContext.tabs : [];
  return tabs.filter(tab => tabMatches(tab, match));
}

function createTabLifecycleProvider(fallbackProvider) {
  if (!fallbackProvider || typeof fallbackProvider.decide !== 'function') {
    throw new Error('tab_lifecycle_fallback_provider_required');
  }

  return {
    name: `tab-lifecycle+${fallbackProvider.name || 'provider'}`,
    version: TAB_LIFECYCLE_PROVIDER_VERSION,
    async decide(context = {}) {
      const intent = extractTabIntent(context.task || {});
      if (!intent) return fallbackProvider.decide(context);

      if (intent.error) {
        return {
          status: 'blocked',
          confidence: 0.98,
          reasonCode: intent.error,
          metadata: { decisionSource: 'tab-lifecycle-provider', tabAction: intent.actionType }
        };
      }

      if (intent.actionType === 'openNewTab') {
        return {
          status: 'act',
          confidence: 0.99,
          reasonCode: 'explicit_open_new_tab',
          action: {
            type: 'openNewTab',
            args: { url: intent.url },
            intent: normalizeText(context.task?.instruction)
          },
          expectedOutcome: { browserTabCreated: true },
          metadata: { decisionSource: 'tab-lifecycle-provider', semanticTargeting: true }
        };
      }

      const inventoryAvailable = Array.isArray(context.browserContext?.tabs) && context.browserContext.tabs.length > 0;
      if (inventoryAvailable) {
        const matches = matchingTabs(context.browserContext, intent.match);
        if (matches.length === 0) {
          return {
            status: 'blocked',
            confidence: 0.97,
            reasonCode: 'tab_semantic_target_not_found',
            recovery: { suggested: 'reobserve_browser_context' },
            metadata: { decisionSource: 'tab-lifecycle-provider', tabAction: intent.actionType, match: intent.match }
          };
        }
        if (matches.length > 1) {
          return {
            status: 'blocked',
            confidence: 0.97,
            reasonCode: 'tab_semantic_target_ambiguous',
            recovery: { suggested: 'request_more_specific_tab_target' },
            metadata: { decisionSource: 'tab-lifecycle-provider', tabAction: intent.actionType, match: intent.match, matchCount: matches.length }
          };
        }
        if (intent.actionType === 'switchTab' && matches[0].active === true) {
          return {
            status: 'done',
            confidence: 0.99,
            reasonCode: 'tab_already_active',
            expectedOutcome: { taskSucceeded: true },
            metadata: { decisionSource: 'tab-lifecycle-provider', semanticTargeting: true }
          };
        }
      }

      return {
        status: 'act',
        confidence: 0.99,
        reasonCode: intent.actionType === 'switchTab' ? 'explicit_switch_tab' : 'explicit_close_tab',
        action: {
          type: intent.actionType,
          args: { match: intent.match },
          intent: normalizeText(context.task?.instruction)
        },
        expectedOutcome: intent.actionType === 'switchTab'
          ? { browserTabActive: true }
          : { browserTabExists: false },
        metadata: { decisionSource: 'tab-lifecycle-provider', semanticTargeting: true }
      };
    }
  };
}

module.exports = {
  TAB_LIFECYCLE_PROVIDER_VERSION,
  TAB_ACTION_TYPES,
  TAB_MATCH_KEYS,
  normalizeText,
  normalizeHttpUrl,
  normalizeTabMatch,
  tabMatchFromTarget,
  tabIntentFromArgs,
  extractTabIntent,
  tabMatches,
  matchingTabs,
  createTabLifecycleProvider
};
