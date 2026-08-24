// V3.9 deterministic recorded-click implementation.
// This function is integrated into background.js in the packaged V3.9 build.

async function clickRecorded(tabId, data = {}) {
  try {
    const selectors = Array.isArray(data.selectors) ? data.selectors.filter(Boolean) : [];
    const texts = Array.isArray(data.texts) ? data.texts.map(String).filter(Boolean) : [];
    const rx = Math.max(0, Math.min(1, Number(data.point && data.point.rx)));
    const ry = Math.max(0, Math.min(1, Number(data.point && data.point.ry)));
    const pointX = Number.isFinite(rx) ? rx : 0.5;
    const pointY = Number.isFinite(ry) ? ry : 0.5;

    const [located] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selectorList, textList, relX, relY) => {
        const usable = (el) => {
          if (!el) return false;
          const s = getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        };

        const make = (el, matchedBy, matchedValue) => {
          const r = el.getBoundingClientRect();
          return {
            matchedBy,
            matchedValue,
            rect: {
              left: r.left, top: r.top, right: r.right, bottom: r.bottom,
              width: r.width, height: r.height
            },
            x: r.left + r.width * relX,
            y: r.top + r.height * relY,
            viewport: { width: innerWidth, height: innerHeight },
            scroll: { x: scrollX, y: scrollY },
            tag: el.tagName,
            text: (el.innerText || el.textContent || el.value || '').trim().slice(0, 160)
          };
        };

        for (const sel of selectorList) {
          try {
            for (const el of document.querySelectorAll(sel)) {
              if (usable(el)) return make(el, 'selector', sel);
            }
          } catch (_) {}
        }

        if (textList.length) {
          const candidates = Array.from(document.querySelectorAll(
            'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"], summary, label'
          ));
          for (const wanted of textList) {
            const needle = wanted.toLowerCase();
            for (const el of candidates) {
              if (!usable(el)) continue;
              const label = (
                el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || ''
              ).trim();
              if (label.toLowerCase().includes(needle)) return make(el, 'text', wanted);
            }
          }
        }

        return null;
      },
      args: [selectors, texts, pointX, pointY]
    });

    let target = located && located.result;

    if (target) {
      const r = target.rect;
      let dy = 0;
      if (r.top < 0) dy = r.top;
      else if (r.bottom > target.viewport.height) dy = r.bottom - target.viewport.height;

      if (Math.abs(dy) >= 1) {
        const targetY = Math.max(0, Number(target.scroll.y || 0) + dy);
        const scrolled = await smoothScrollTo(tabId, Number(target.scroll.x || 0), targetY);
        if (!scrolled || scrolled.ok === false) {
          return { ok: false, error: 'Recorded-click scroll failed', target, scrollResult: scrolled };
        }

        await sleep(80);

        const [relocated] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (selectorList, textList, relX, relY) => {
            const usable = (el) => {
              if (!el) return false;
              const s = getComputedStyle(el);
              if (s.display === 'none' || s.visibility === 'hidden') return false;
              const r = el.getBoundingClientRect();
              return r.width > 1 && r.height > 1 &&
                r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
            };
            const make = (el, matchedBy, matchedValue) => {
              const r = el.getBoundingClientRect();
              return {
                matchedBy, matchedValue,
                x: r.left + r.width * relX,
                y: r.top + r.height * relY,
                rect: { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height },
                viewport: { width: innerWidth, height: innerHeight },
                scroll: { x: scrollX, y: scrollY },
                tag: el.tagName,
                text: (el.innerText || el.textContent || el.value || '').trim().slice(0, 160)
              };
            };
            for (const sel of selectorList) {
              try {
                for (const el of document.querySelectorAll(sel)) if (usable(el)) return make(el, 'selector', sel);
              } catch (_) {}
            }
            const candidates = Array.from(document.querySelectorAll(
              'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"], summary, label'
            ));
            for (const wanted of textList) {
              const needle = String(wanted).toLowerCase();
              for (const el of candidates) {
                if (!usable(el)) continue;
                const label = (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
                if (label.toLowerCase().includes(needle)) return make(el, 'text', wanted);
              }
            }
            return null;
          },
          args: [selectors, texts, pointX, pointY]
        });
        target = relocated && relocated.result;
      }
    }

    if (!target && data.fallback) {
      const fb = data.fallback;
      const [viewport] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ width: innerWidth, height: innerHeight })
      });
      const vp = viewport && viewport.result;
      const rw = Number(fb.viewportWidth || 0);
      const rh = Number(fb.viewportHeight || 0);
      const compatible = vp && rw > 0 && rh > 0 &&
        Math.abs(vp.width - rw) <= Math.max(12, rw * 0.05) &&
        Math.abs(vp.height - rh) <= Math.max(12, rh * 0.05);

      if (compatible) {
        target = {
          matchedBy: 'viewport-fallback',
          matchedValue: null,
          x: Number(fb.clientX),
          y: Number(fb.clientY),
          viewport: vp
        };
      }
    }

    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      return { ok: false, error: 'Recorded click target not found', selectors, texts };
    }

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: target.x, y: target.y
      });
      mousePositionByTab.set(tabId, { x: target.x, y: target.y });

      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1
      });
    });

    return {
      ok: true,
      clicked: true,
      deterministic: true,
      point: { rx: pointX, ry: pointY },
      target
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
