// Layout sniffer — вызывается через mcp__plugin_playwright_playwright__browser_evaluate как arrow function.
// Импортируется из SKILL.md напрямую; этот файл — file-relative mirror для удобства.

() => {
  const out = { overflow: [], position_outside_viewport: [], touch_targets_small: [], overlap_count: 0 };
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = Array.from(document.querySelectorAll('*'));
  const rects = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 && r.height === 0) continue;
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'hidden') {
      out.overflow.push({ tag: el.tagName.toLowerCase(), cls: String(el.className||'').slice(0,80), scroll: el.scrollWidth, client: el.clientWidth });
    }
    if ((cs.position === 'fixed' || cs.position === 'absolute') && (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh)) {
      out.position_outside_viewport.push({ tag: el.tagName.toLowerCase(), pos: cs.position });
    }
    if (el.matches('a, button, input, select, textarea, [role=button], [role=link]')) {
      if ((r.width < 44 || r.height < 44)) {
        out.touch_targets_small.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText||'').trim().slice(0,30) });
      }
    }
    rects.push({ el, r });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i+1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      if (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom) continue;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 5 && iy > 5) out.overlap_count++;
    }
  }
  return JSON.stringify({ vw, vh, ...out }, null, 2);
};
