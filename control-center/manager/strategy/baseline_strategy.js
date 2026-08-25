'use strict';

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function findSearchInput(observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return elements.find(el => {
    const role = normalizeText(el.role);
    const label = normalizeText(el.label || el.ariaLabel || el.name || el.placeholder);
    const tag = normalizeText(el.tag);
    return !!el.visible && el.enabled !== false && el.editable !== false && (
      role === 'searchbox' ||
      role === 'combobox' ||
      label.includes('search') ||
      (['input', 'textarea'].includes(tag) && label.includes('search'))
    );
  }) || null;
}

function resultSignalsMatch(task, observation) {
  const query = normalizeText(task?.args?.query);
  const signals = observation?.pageSignals || {};
  if (signals.taskSucceeded === true) return true;
  if (signals.searchResultsVisible === true && (!query || normalizeText(signals.query).includes(query))) return true;
  return false;
}

function createBaselineStrategy() {
  return {
    name: 'baseline',
    version: '0.1.1',

    async decide({ task, observation, history = [] }) {
      if (resultSignalsMatch(task, observation)) {
        return {
          status: 'done',
          confidence: 0.95,
          reasonCode: 'goal_signal_matched',
          expectedOutcome: { taskSucceeded: true }
        };
      }

      if (task.type === 'web_search') {
        const searchInput = findSearchInput(observation);
        if (!searchInput) {
          return {
            status: 'blocked',
            confidence: 0.4,
            reasonCode: 'search_input_not_found',
            recovery: { suggested: 'reobserve_or_navigate' }
          };
        }

        const previousActions = history.map(x => x?.decision?.action?.action).filter(Boolean);
        const focusedAlready = previousActions.includes('focusSelector');
        const typedAlready = previousActions.includes('type');
        const submittedAlready = history.some(x => x?.decision?.action?.action === 'pressKey' && x?.decision?.action?.key === 'Enter');
        const selector = searchInput.selector || searchInput.selectors?.[0] || null;

        if (!focusedAlready) {
          return {
            status: 'act',
            action: { action: 'focusSelector', selector },
            targetRef: searchInput.id || null,
            confidence: 0.85,
            reasonCode: 'focus_search_input',
            expectedOutcome: { focusedElementRef: searchInput.id || null }
          };
        }

        if (!typedAlready) {
          return {
            status: 'act',
            action: { action: 'type', text: String(task.args?.query || '') },
            targetRef: searchInput.id || null,
            confidence: 0.9,
            reasonCode: 'type_search_query',
            expectedOutcome: { fieldContainsTaskArg: 'query' }
          };
        }

        if (!submittedAlready) {
          return {
            status: 'act',
            action: { action: 'pressKey', key: 'Enter' },
            confidence: 0.8,
            reasonCode: 'submit_search',
            expectedOutcome: { navigationOrResults: true }
          };
        }

        return {
          status: 'blocked',
          confidence: 0.35,
          reasonCode: 'awaiting_goal_signal',
          recovery: { suggested: 'reobserve' }
        };
      }

      return {
        status: 'blocked',
        confidence: 0.2,
        reasonCode: 'baseline_has_no_rule',
        recovery: { suggested: 'provider_upgrade_required' }
      };
    }
  };
}

module.exports = { createBaselineStrategy };
