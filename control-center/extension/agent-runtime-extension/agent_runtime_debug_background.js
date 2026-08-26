'use strict';

importScripts('agent_cursor_mirror.js');

try {
  const status = AgentCursorMirror.install(chrome);
  if (!status.installed) console.warn('[agent-runtime] cursor mirror inactive:', status.installError || 'unknown');
} catch (error) {
  console.warn('[agent-runtime] cursor mirror install failed:', String(error?.message || error));
}

importScripts('background.js');
