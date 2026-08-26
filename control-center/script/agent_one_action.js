'use strict';

const fs = require('fs');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function discoverRuntimeAgent(healthBase = 'http://127.0.0.1:3000') {
  const response = await fetch(`${healthBase}/agents`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`broker_agents_http_${response.status}`);
  const body = await response.json();
  const agents = Array.isArray(body?.agents) ? body.agents : [];
  const runtimes = agents.filter(agent => agent?.meta?.product === 'agent-runtime');
  if (runtimes.length === 1) return runtimes[0].agentId;
  if (!runtimes.length) throw new Error('no_agent_runtime_connected');
  throw new Error(`multiple_agent_runtimes_connected:${runtimes.map(x => x.agentId).join(',')}`);
}

function loadBaseline(file) {
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scopeFromArgs(args, defaultMode = 'all') {
  const mode = String(args['tabs-scope'] || args['observe-tabs'] || defaultMode);
  const scope = { mode };
  if (args.host) scope.hostname = String(args.host);
  if (args['url-includes']) scope.urlIncludes = String(args['url-includes']);
  if (args['title-includes']) scope.titleIncludes = String(args['title-includes']);
  if (args['max-tabs']) scope.maxTabs = Number(args['max-tabs']);
  return scope;
}

function explicitTabId(value) {
  if (value == null || value === true) return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function tabHostname(tab) {
  try { return normalizeText(new URL(String(tab?.url || '')).hostname); }
  catch (_) { return ''; }
}

function tabMatchesKeyword(tab, keyword) {
  const wanted = normalizeText(keyword);
  if (!wanted) return false;
  const title = normalizeText(tab?.title);
  const url = normalizeText(tab?.url);
  const host = tabHostname(tab);
  return title.includes(wanted) || host.includes(wanted) || url.includes(wanted);
}

function chooseTabByKeyword(tabs, keyword) {
  const candidates = (Array.isArray(tabs) ? tabs : []).filter(tab => tabMatchesKeyword(tab, keyword));
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error(`tab_keyword_not_found:${keyword}`);

  const active = candidates.filter(tab => tab?.active === true);
  if (active.length === 1) return active[0];

  throw new Error(`ambiguous_tab_keyword:${keyword}:${candidates.map(tab => `${tab.tabId}:${tab.title || tab.url || ''}`).join('|')}`);
}

async function resolveCommandTabId(runtime, args) {
  const selector = args.tab ?? args.on ?? null;
  const exactId = explicitTabId(selector);
  if (exactId != null) return exactId;

  const keyword = selector != null && selector !== true ? String(selector).trim() : '';
  if (keyword && ['active', 'current'].includes(normalizeText(keyword))) return null;
  if (keyword) {
    const tabs = await runtime.listTabs({ mode: 'all' });
    return Number(chooseTabByKeyword(tabs, keyword).tabId);
  }

  if (args.host || args['url-includes'] || args['title-includes']) {
    const tabs = await runtime.listTabs({
      mode: 'matching',
      ...(args.host ? { hostname: String(args.host) } : {}),
      ...(args['url-includes'] ? { urlIncludes: String(args['url-includes']) } : {}),
      ...(args['title-includes'] ? { titleIncludes: String(args['title-includes']) } : {})
    });
    if (tabs.length === 1) return Number(tabs[0].tabId);
    if (!tabs.length) throw new Error('tab_filter_not_found');
    const active = tabs.filter(tab => tab?.active === true);
    if (active.length === 1) return Number(active[0].tabId);
    throw new Error(`ambiguous_tab_filter:${tabs.map(tab => `${tab.tabId}:${tab.title || tab.url || ''}`).join('|')}`);
  }

  return null;
}

function chooseTarget(observation, args) {
  const targets = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  if (args.ref) return targets.find(x => x.ref === args.ref) || null;
  if (!args.label) return null;
  const wanted = normalizeText(args.label);
  const exact = targets.filter(x => normalizeText(x.label) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`ambiguous_exact_label:${args.label}:${exact.map(x => x.ref).join(',')}`);
  const partial = targets.filter(x => normalizeText(x.label).includes(wanted));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`ambiguous_partial_label:${args.label}:${partial.map(x => `${x.ref}:${x.label}`).join('|')}`);
  return null;
}

function actionFromArgs(observation, args) {
  const type = String(args.type || '').trim();
  if (!type) throw new Error('--type is required');
  const target = chooseTarget(observation, args);
  const action = { type, args: {} };
  if (target) action.targetRef = target.ref;
  if (args.text != null) action.args.text = String(args.text);
  if (args.key != null) action.args.key = String(args.key);
  if (args.url != null) action.args.url = String(args.url);
  if (args.direction != null) action.args.direction = Number(args.direction);
  if (args.value != null) action.args.value = Number(args.value);
  return { action, selectedTarget: target };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const runtime = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    if (args.tabs) {
      const tabs = await runtime.listTabs(scopeFromArgs(args, 'all'));
      console.log(JSON.stringify({ agentId, tabs }, null, 2));
      return;
    }

    if (args['observe-tabs']) {
      const observations = await runtime.observeTabs(scopeFromArgs(args, String(args['observe-tabs'] || 'visible')));
      console.log(JSON.stringify({ agentId, observations }, null, 2));
      return;
    }

    const resolvedTabId = await resolveCommandTabId(runtime, args);

    if (args.observe) {
      const observation = await runtime.observe(resolvedTabId);
      console.log(JSON.stringify({ agentId, resolvedTabId: resolvedTabId ?? observation?.tabId ?? null, observation }, null, 2));
      return;
    }

    const baseline = loadBaseline(args.baseline);
    let selectedTarget = null;
    const result = await runOneAction({
      runtime: {
        observe: () => runtime.observe(resolvedTabId),
        executePlan: payload => runtime.executePlan({ ...payload, tabId: resolvedTabId })
      },
      baseline,
      decide: async observation => {
        const built = actionFromArgs(observation, args);
        selectedTarget = built.selectedTarget;
        return {
          status: 'act',
          source: 'native-one-action-harness',
          action: built.action
        };
      }
    });

    const compact = {
      agentId,
      tabId: resolvedTabId ?? result.before?.tabId ?? null,
      bridgeVersion: result.bridgeVersion,
      beforeObservationId: result.beforeObservationId,
      afterObservationId: result.afterObservationId,
      selectedTarget,
      action: result.mappedAction,
      behavior: result.behavior,
      cdpPlan: result.cdpPlan,
      execution: result.execution,
      invariant: result.invariant,
      beforePage: { url: result.before?.url || null, title: result.before?.title || null },
      afterPage: { url: result.after?.url || null, title: result.after?.title || null }
    };
    console.log(JSON.stringify(args.full ? result : compact, null, 2));
  } finally {
    runtime.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  normalizeText,
  scopeFromArgs,
  explicitTabId,
  tabMatchesKeyword,
  chooseTabByKeyword,
  resolveCommandTabId,
  chooseTarget,
  actionFromArgs,
  discoverRuntimeAgent
};
