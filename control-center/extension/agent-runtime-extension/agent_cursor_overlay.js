'use strict';

(() => {
  const SCOPE = 'AGENT_CURSOR_DEBUG_V01';
  const HOST_TAG = 'agent-runtime-debug-cursor';
  let host = null;
  let cursor = null;
  let label = null;
  let lastEvent = null;

  function ensureOverlay() {
    if (host?.isConnected && cursor) return true;
    const root = document.documentElement || document.body;
    if (!root) return false;

    host = document.querySelector(HOST_TAG);
    if (host) host.remove();
    host = document.createElement(HOST_TAG);
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100vw',
      'height:100vh',
      'overflow:visible',
      'pointer-events:none',
      'z-index:2147483647'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; pointer-events: none !important; }
        #cursor {
          position: fixed;
          left: 0;
          top: 0;
          width: 28px;
          height: 34px;
          pointer-events: none;
          transform: translate3d(-100px,-100px,0);
          transform-origin: 3px 3px;
          will-change: transform;
          display: none;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,.45));
        }
        #arrow {
          position: absolute;
          left: 0;
          top: 0;
          width: 20px;
          height: 26px;
        }
        #ring {
          position: absolute;
          left: -7px;
          top: -7px;
          width: 22px;
          height: 22px;
          border: 2px solid rgba(255,80,80,.95);
          border-radius: 50%;
          opacity: 0;
          transform: scale(.55);
          transition: opacity 70ms linear, transform 70ms linear;
        }
        #cursor[data-state="down"] #ring {
          opacity: 1;
          transform: scale(1);
        }
        #label {
          position: absolute;
          left: 15px;
          top: 20px;
          padding: 2px 5px;
          border-radius: 4px;
          background: rgba(20,20,20,.84);
          color: #fff;
          font: 10px/1.2 system-ui, sans-serif;
          letter-spacing: .04em;
          white-space: nowrap;
          user-select: none;
        }
      </style>
      <div id="cursor" data-state="move">
        <svg id="arrow" viewBox="0 0 20 26" aria-hidden="true">
          <path d="M2 1 L2 20 L7.2 15.6 L11 24 L15 22.2 L11.2 14.1 L18 13.8 Z" fill="#ffffff" stroke="#151515" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <div id="ring"></div>
        <div id="label">AGENT</div>
      </div>`;

    cursor = shadow.getElementById('cursor');
    label = shadow.getElementById('label');
    root.appendChild(host);
    return true;
  }

  function applyPointerEvent(event) {
    if (!event || !ensureOverlay()) return;
    const x = Number(event.x), y = Number(event.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    cursor.style.display = 'block';
    cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
    if (event.type === 'mousePressed') cursor.dataset.state = 'down';
    else if (event.type === 'mouseReleased') cursor.dataset.state = 'up';
    else if (cursor.dataset.state !== 'down') cursor.dataset.state = 'move';

    lastEvent = event.type;
    if (label) label.textContent = event.type === 'mousePressed' ? 'AGENT · DOWN' : event.type === 'mouseReleased' ? 'AGENT · UP' : 'AGENT';
    if (event.type === 'mouseReleased') {
      setTimeout(() => {
        if (cursor && lastEvent === 'mouseReleased') {
          cursor.dataset.state = 'move';
          if (label) label.textContent = 'AGENT';
        }
      }, 140);
    }
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.scope !== SCOPE || message?.type !== 'POINTER_EVENT') return false;
    applyPointerEvent(message.event);
    return false;
  });
})();
