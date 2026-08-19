// axe-core WCAG 2.1 AA — вызывается через mcp__plugin_playwright_playwright__browser_evaluate как arrow function.
// Инжектит axe-core через CDN jsdelivr (4.10.2 — последняя с wcag2aa rules).

async () => {
  if (!window.axe) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const r = await window.axe.run(document, { runOnly: ['wcag2a','wcag2aa'] });
  return JSON.stringify(r.violations.map(v => ({
    id: v.id, impact: v.impact, count: v.nodes.length,
    elements: v.nodes.slice(0,3).map(n => n.target.join(' ')),
    help: v.help, helpUrl: v.helpUrl
  })), null, 2);
};
