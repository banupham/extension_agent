const WebSocket = require('ws');

const WS_URL = process.env.AGENT_WS || 'ws://127.0.0.1:3000';
const TARGET_AGENT_ID = process.env.TARGET_AGENT_ID || '';
const RUN_EVENT_PREFIX = '@@RUN_EVENT@@';

function emitRunEvent(payload) {
  try { console.log(RUN_EVENT_PREFIX + JSON.stringify(payload)); } catch (_) {}
}

function resolveValue(value, fallback) {
  if (value == null) return fallback;
  return typeof value === 'function' ? value() : value;
}

function resolveNumber(value, fallback = 0) {
  const n = Number(resolveValue(value, fallback));
  return Number.isFinite(n) ? n : Number(fallback);
}

function resolveDelay(value, fallback = 0) {
  const base = resolveNumber(value, fallback);
  const scaleRaw = Number(process.env.DELAY_SCALE || 1);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const jitterRaw = Number(process.env.DELAY_JITTER_PCT || 0);
  const jitterPct = Number.isFinite(jitterRaw) ? Math.max(0, Math.min(80, jitterRaw)) : 0;
  let result = base * scale;
  if (jitterPct > 0) {
    const span = result * jitterPct / 100;
    result += (Math.random() * 2 - 1) * span;
  }
  return Math.max(0, Math.round(result));
}

function asStep(item, defaultDelay = 300) {
  const delay = resolveDelay(item.delay, defaultDelay);
  const data = item.data || {};
  return { action: item.action, data, delay };
}

function runCheck(config) {
  const TARGET_URL = config.url;
  const LOAD_WAIT_MS = Number(process.env.WAIT_MS || config.loadWaitMs || 8000);
  const commandId = `check-${config.name}-${Date.now()}`;
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`✅ Connected: ${WS_URL}`);
    console.log(`🌐 Opening ${TARGET_URL}`);
    ws.send(JSON.stringify({ type: 'register', role: 'web', agentId: TARGET_AGENT_ID || undefined }));

    setTimeout(() => {
      const steps = [
        { action: 'openUrl', data: { url: TARGET_URL, newTab: true }, delay: 100 },
        { action: 'waitForSelector', data: { selector: 'body', timeoutMs: 15000 }, delay: LOAD_WAIT_MS },
        { action: 'getPageInfo', data: {}, delay: 200 }
      ];

      const skippedInteractions = [];
      const SUPPORTED_INTERACTIONS = new Set([
        'click', 'moveMouse', 'clickSelector', 'clickFirstMatch', 'clickRecorded', 'doubleClickSelector',
        'hoverSelector', 'dragAndDrop', 'type', 'replaceText', 'clearInput',
        'pressKey', 'keyCombo', 'scroll', 'scrollTo', 'scrollBy', 'focusSelector', 'selectOption',
        'setChecked', 'wait', 'waitForSelector', 'waitForUrl', 'openUrl',
        'reload', 'goBack', 'goForward', 'getPageInfo', 'getElementText',
        'getElementPosition', 'getActiveTab'
      ]);

      for (const item of (config.interactions || [])) {
        if (!item || !SUPPORTED_INTERACTIONS.has(item.action)) {
          skippedInteractions.push(item && item.action ? item.action : '(missing action)');
          continue;
        }

        let data = {};
        switch (item.action) {
          case 'click':
            data = {
              x: resolveNumber(item.x, 0),
              y: resolveNumber(item.y, 0),
              offset: resolveNumber(item.offset, 4)
            };
            break;
          case 'moveMouse':
            data = {
              fromX: item.fromX == null ? undefined : resolveNumber(item.fromX, 0),
              fromY: item.fromY == null ? undefined : resolveNumber(item.fromY, 0),
              toX: resolveNumber(item.toX ?? item.x, 0),
              toY: resolveNumber(item.toY ?? item.y, 0),
              steps: item.steps == null ? undefined : resolveNumber(item.steps, 0)
            };
            break;
          case 'clickSelector':
          case 'doubleClickSelector':
          case 'hoverSelector':
          case 'focusSelector':
          case 'clearInput':
            data = { selector: item.selector || null };
            break;
          case 'clickFirstMatch':
            data = {
              selectors: item.selectors || [],
              texts: item.texts || [],
              offset: resolveNumber(item.offset, 4)
            };
            break;
          case 'clickRecorded':
            data = {
              selectors: item.selectors || [],
              texts: item.texts || [],
              point: {
                rx: resolveNumber(item.point && item.point.rx, 0.5),
                ry: resolveNumber(item.point && item.point.ry, 0.5)
              },
              fallback: {
                clientX: resolveNumber(item.fallback && item.fallback.clientX, 0),
                clientY: resolveNumber(item.fallback && item.fallback.clientY, 0),
                viewportWidth: resolveNumber(item.fallback && item.fallback.viewportWidth, 0),
                viewportHeight: resolveNumber(item.fallback && item.fallback.viewportHeight, 0)
              }
            };
            break;
          case 'dragAndDrop':
            data = {
              sourceSelector: item.sourceSelector,
              targetSelector: item.targetSelector
            };
            break;
          case 'type':
            data = { text: String(item.text ?? '') };
            break;
          case 'replaceText':
            data = {
              selector: item.selector || null,
              text: String(item.text ?? '')
            };
            break;
          case 'pressKey':
            data = { key: String(item.key || 'Enter') };
            break;
          case 'keyCombo':
            data = { keys: Array.isArray(item.keys) ? item.keys : String(item.combo || '').split('+').map(x => x.trim()).filter(Boolean) };
            break;
          case 'scroll':
          case 'scrollTo':
          case 'scrollBy':
            data = {
              x: resolveNumber(item.x, 0),
              y: resolveNumber(item.y, 0)
            };
            break;
          case 'selectOption':
            data = {
              selector: item.selector,
              value: item.value == null ? null : String(item.value),
              text: item.text == null ? null : String(item.text),
              index: Number.isInteger(item.index) ? item.index : null
            };
            break;
          case 'setChecked':
            data = {
              selector: item.selector,
              checked: !!item.checked
            };
            break;
          case 'wait':
            data = { ms: resolveNumber(item.ms, 0) };
            break;
          case 'waitForSelector':
            data = {
              selector: item.selector,
              timeoutMs: Number(item.timeoutMs || 10000)
            };
            break;
          case 'waitForUrl':
            data = {
              contains: item.contains ?? null,
              equals: item.equals ?? null,
              regex: item.regex ?? null,
              timeoutMs: Number(item.timeoutMs || 10000)
            };
            break;
          case 'openUrl':
            data = {
              url: String(item.url || ''),
              newTab: !!item.newTab
            };
            break;
          case 'reload':
          case 'goBack':
          case 'goForward':
          case 'getPageInfo':
          case 'getActiveTab':
            data = {};
            break;
          case 'getElementText':
          case 'getElementPosition':
            data = { selector: item.selector || (item.data && item.data.selector) || 'body' };
            break;
        }

        steps.push({
          action: item.action,
          data,
          delay: resolveDelay(item.delay, item.action === 'wait' ? 0 : 300)
        });
      }

      if (skippedInteractions.length) {
        console.warn('⚠️ Unsupported interactions kept out of sequence:', skippedInteractions.join(', '));
      }
      if (process.env.TRACE_PLAN === '1') {
        console.log('\n=== RESOLVED STEP PLAN ===');
        console.log(JSON.stringify(steps, null, 2));
      }

      steps.push(
        { action: 'getPageInfo', data: {}, delay: resolveDelay(config.resultWaitMs, 3000) },
        { action: 'getElementText', data: { selector: config.resultSelector || 'body' }, delay: 300 },
        { action: 'detach', data: {}, delay: 100 }
      );

      emitRunEvent({ type: 'plan', commandId, scenario: config.name, totalSteps: steps.length });

      ws.send(JSON.stringify({
        type: 'command',
        commandId,
        agentId: TARGET_AGENT_ID || undefined,
        payload: {
          action: 'sequence',
          tabId: null,
          data: { steps }
        }
      }));
    }, 400);
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'status') {
      if (msg.commandId === commandId && msg.progress) {
        emitRunEvent({ type: 'progress', commandId, ...msg.progress });
      } else {
        console.log('ℹ️', msg.message || msg);
      }
      return;
    }

    if (msg.type === 'error') {
      emitRunEvent({ type: 'transport_error', commandId, error: msg.message || 'Server error' });
      console.error('❌ Server:', msg.message || msg);
      return;
    }

    if (msg.type === 'result' && msg.commandId === commandId) {
      const result = msg.result;
      emitRunEvent({
        type: 'summary',
        commandId,
        ok: !!(result && result.ok),
        failedStep: result && result.failedStep,
        error: result && result.error ? String(result.error) : null,
        totalResults: result && Array.isArray(result.results) ? result.results.length : 0
      });

      console.log('\n=== SUMMARY ===');
      console.log(JSON.stringify({
        ok: result && result.ok,
        failedStep: result && result.failedStep,
        tabId: result && result.tabId,
        error: result && result.error
      }, null, 2));

      if (result && Array.isArray(result.results)) {
        const trace = result.results.filter(x =>
          ['clickFirstMatch', 'clickRecorded', 'clickSelector', 'doubleClickSelector', 'hoverSelector', 'dragAndDrop', 'type', 'replaceText', 'clearInput', 'pressKey', 'keyCombo', 'scroll', 'scrollTo', 'scrollBy', 'selectOption', 'setChecked', 'waitForSelector', 'waitForUrl', 'openUrl', 'reload', 'goBack', 'goForward'].includes(x.action)
        );

        console.log('\n=== INTERACTION TRACE ===');
        for (const row of trace) {
          console.log(JSON.stringify({
            step: row.step,
            action: row.action,
            tabId: row.tabId,
            delayMs: row.delayMs,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            durationMs: row.durationMs,
            result: row.result
          }, null, 2));
        }

        const lastText = [...result.results].reverse().find(x => x.action === 'getElementText');
        if (lastText) {
          console.log('\n=== PAGE RESULT TEXT ===');
          const value = lastText.result;
          const printable =
            typeof value === 'string'
              ? value
              : (value && typeof value.text === 'string' ? value.text : JSON.stringify(value, null, 2));
          console.log(String(printable).slice(0, Number(process.env.BODY_LIMIT || 16000)));
        }
      }

      ws.close();
    }
  });

  ws.on('error', err => { emitRunEvent({ type: 'transport_error', commandId, error: err.message }); console.error('❌ WebSocket:', err.message); });
  ws.on('close', () => console.log('🔌 Disconnected'));
}

module.exports = { runCheck };
