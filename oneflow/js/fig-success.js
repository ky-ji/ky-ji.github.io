// Results figure: success rates of Native (one pass and N passes) and of OneFlow / OneFlow+ (one
// pass), one small bar panel per model and benchmark. Every value is read from the static result
// tables, so the tables stay the single source of truth; nothing here is typed in twice. The parallel
// samplers and one-step baselines are listed in the tables only.
(function () {
  const root = document.getElementById('fig-success');
  if (!root) return;
  const body = root.querySelector('.chart-body');

  // One group per result table: which columns to draw and how to name them.
  const GROUPS = [
    { title: 'World action models', sub: 'RoboTwin50', table: '#panel-wam table',
      cols: { 'Average ↑': 'average of clean and randomized' } },
    { title: 'Vision–language–action models', sub: 'SimplerEnv', table: '#panel-vla table',
      cols: { 'WidowX ↑': 'WidowX', 'Google VM ↑': 'Google Robot, Visual Matching', 'Google VA ↑': 'Google Robot, Variant Aggregation' } },
    { title: 'Flow-matching policies', sub: 'RoboMimic', table: '#panel-fm table', model: 'FM Policy',
      cols: { 'State avg. ↑': 'state observations, five-task average', 'RGB avg. ↑': 'RGB observations, five-task average' } },
  ];
  const SERIES = {
    native1: { name: 'Native', key: 'k-native1', color: 'var(--series-native-1)' },
    native: { name: 'Native', key: 'k-native', color: 'var(--series-native)' },
    ours: { name: 'OneFlow', key: 'k-ours', color: 'var(--series-ours)', ours: true },
    plus: { name: 'OneFlow+', key: 'k-plus', color: 'var(--series-plus)', ours: true },
  };
  const ORDER = ['native1', 'native', 'ours', 'plus'];
  const seriesOf = (method, n) => method === 'OneFlow+' ? 'plus' : method === 'OneFlow' ? 'ours'
    : method === 'Native' ? (n === 1 ? 'native1' : 'native') : null;
  const passes = n => `${n} ${n === 1 ? 'pass' : 'passes'}`;
  const make = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  // Read one table into panels: one per (model, drawn column), each with the four series.
  function read(group) {
    const table = document.querySelector(group.table);
    if (!table) return [];
    const head = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const at = name => head.indexOf(name);
    const models = [...table.tBodies].map(tb => {
      const rows = {};
      for (const tr of tb.rows) {
        if (tr.classList.contains('group')) continue;
        const cells = [...tr.cells].map(c => c.textContent.trim());
        const key = seriesOf(cells[0], Number(cells[at('N')]));
        if (key) rows[key] = cells;
      }
      return { name: tb.querySelector('tr.group th')?.textContent.trim() || group.model, rows };
    });
    const panels = [];
    // Columns outside, models inside: with two panels per row, each model keeps its own column.
    for (const [col, label] of Object.entries(group.cols)) {
      for (const model of models) {
        // RoboMimic reports the passes per observation modality: "NFE (State)" and "NFE (RGB)".
        const nfe = at('NFE') >= 0 ? at('NFE') : at(`NFE (${col.split(' ')[0]})`);
        const bars = ORDER.filter(k => model.rows[k]).map(k => ({
          key: k, value: Number(model.rows[k][at(col)]), shown: model.rows[k][at(col)],
          n: Number(model.rows[k][at('N')]), nfe: Number(model.rows[k][nfe]),
        }));
        if (at(col) >= 0 && bars.length) panels.push({ model: model.name, label, bars });
      }
    }
    return panels;
  }

  // One tooltip for the whole figure.
  const tip = document.body.appendChild(make('div', 'chart-tip'));
  tip.setAttribute('role', 'status');
  function showTip(row, html) {
    tip.innerHTML = html;
    const r = row.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - h - 8 < 64 ? r.bottom + 8 : r.top - h - 8}px`;
    tip.classList.add('on');
  }
  const hideTip = () => tip.classList.remove('on');
  addEventListener('scroll', hideTip, { passive: true });

  let index = 0;
  for (const group of GROUPS) {
    const panels = read(group);
    if (!panels.length) continue;
    const g = body.appendChild(make('section', 'chart-group'));
    g.appendChild(make('h4', 'chart-group-title', `${group.title}<small>${group.sub}</small>`));
    const grid = g.appendChild(make('div', 'chart-panels'));
    for (const p of panels) {
      const panel = grid.appendChild(make('div', 'chart-panel'));
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', `${p.model}, ${p.label}`);
      panel.appendChild(make('p', 'chart-panel-title', `${p.model} <span>· ${p.label}</span>`));
      for (const b of p.bars) {
        const s = SERIES[b.key];
        const row = panel.appendChild(make('div', `bar-row${s.ours ? ' is-ours' : ''}`,
          `<span class="bar-name">${s.name}<small>${passes(b.nfe)}</small></span>
           <span class="bar-track"><i class="bar-fill" style="width:${b.value}%;background:${s.color};transition-delay:${(index % 4) * 60}ms"></i></span>
           <span class="bar-value">${b.shown}</span>`));
        index++;
        row.tabIndex = 0;
        row.setAttribute('role', 'img');
        row.setAttribute('aria-label', `${s.name}, ${passes(b.nfe)} per replanning step: ${b.shown}% success`);
        const html = `<b><i class="${s.key}"></i>${s.name} · ${passes(b.nfe)}</b>
          <strong>${b.shown}%</strong> <span>${p.model}, ${p.label}</span>
          <span><span class="m">N</span> = ${b.n}, ${passes(b.nfe)} per replanning step</span>`;
        row.addEventListener('pointerenter', () => showTip(row, html));
        row.addEventListener('pointerleave', hideTip);
        row.addEventListener('focus', () => showTip(row, html));
        row.addEventListener('blur', hideTip);
      }
    }
    // One axis per column of panels, under the group.
    const axes = g.appendChild(make('div', 'chart-panels chart-axes'));
    for (let i = 0; i < Math.min(2, panels.length); i++) {
      axes.appendChild(make('div', 'chart-axis', `<span></span><div aria-hidden="true">${[0, 25, 50, 75, 100].map(v => `<span>${v}</span>`).join('')}</div><span></span>`));
    }
  }

  // The bars grow once, when the figure is reached.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || /fig-[a-z]+=/.test(location.hash);
  if (still) { root.classList.add('in'); return; }
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    root.classList.add('in');
    io.disconnect();
  }, { threshold: 0.15 });
  io.observe(root);
})();
