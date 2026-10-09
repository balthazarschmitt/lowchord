// Declarative control panels. A panel is a list of control definitions bound to get/set.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} root
 * @param {Array<object>} defs
 * @param {{get:(k:string)=>any, set:(k:string,v:any)=>void}} io
 * @returns {() => void} refresh function
 */
export function buildPanel(root, defs, io) {
  root.textContent = '';
  const updaters = [];
  for (const d of defs) {
    if (d.when && !d.when()) continue;
    if (d.type === 'heading') {
      root.append(el('h3', 'ph', d.label));
      continue;
    }
    if (d.type === 'note') {
      const p = el('p', 'pnote', typeof d.label === 'function' ? d.label() : d.label);
      if (typeof d.label === 'function') updaters.push(() => (p.textContent = d.label()));
      root.append(p);
      continue;
    }
    if (d.type === 'custom') {
      const box = el('div', 'pcustom');
      root.append(box);
      const r = () => d.render(box);
      r();
      updaters.push(r);
      continue;
    }
    const row = el('div', 'prow ' + (d.type || ''));
    if (d.label && d.type !== 'button') row.append(el('label', 'plabel', d.label));
    root.append(row);

    if (d.type === 'range') {
      const wrap = el('div', 'prange');
      const input = el('input');
      input.type = 'range';
      const log = d.scale === 'log';
      input.min = log ? 0 : d.min;
      input.max = log ? 1000 : d.max;
      input.step = log ? 1 : d.step || 0.01;
      const val = el('span', 'pval');
      const toUi = (v) => (log ? (1000 * Math.log(v / d.min)) / Math.log(d.max / d.min) : v);
      const fromUi = (u) => (log ? d.min * Math.pow(d.max / d.min, u / 1000) : u);
      const fmt = d.fmt || ((v) => (Math.abs(v) >= 100 ? Math.round(v) : (+v).toFixed(2)));
      input.addEventListener('input', () => {
        const v = fromUi(parseFloat(input.value));
        io.set(d.key, v);
        val.textContent = fmt(v);
      });
      wrap.append(input, val);
      row.append(wrap);
      updaters.push(() => {
        const v = io.get(d.key);
        input.value = toUi(v);
        val.textContent = fmt(v);
      });
    } else if (d.type === 'select') {
      const sel = el('select');
      const opts = typeof d.options === 'function' ? d.options() : d.options;
      for (const [v, label] of opts) {
        const o = el('option', null, label);
        o.value = String(v);
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        const raw = sel.value;
        const isNum = opts.some(([v]) => typeof v === 'number');
        io.set(d.key, isNum ? Number(raw) : raw);
      });
      row.append(sel);
      updaters.push(() => (sel.value = String(io.get(d.key))));
    } else if (d.type === 'seg') {
      const seg = el('div', 'pseg' + (d.grid ? ' grid' : ''));
      const opts = typeof d.options === 'function' ? d.options() : d.options;
      const btns = opts.map(([v, label]) => {
        const b = el('button', null, label);
        b.type = 'button';
        b.addEventListener('click', () => {
          io.set(d.key, v);
          refresh();
        });
        seg.append(b);
        return [v, b];
      });
      row.append(seg);
      updaters.push(() => {
        const cur = io.get(d.key);
        for (const [v, b] of btns) b.classList.toggle('sel', v === cur);
      });
    } else if (d.type === 'toggle') {
      const b = el('button', 'ptoggle');
      b.type = 'button';
      b.addEventListener('click', async () => {
        await io.set(d.key, !io.get(d.key));
        refresh();
      });
      row.append(b);
      updaters.push(() => {
        const on = !!io.get(d.key);
        b.classList.toggle('sel', on);
        b.textContent = on ? 'ON' : 'OFF';
      });
    } else if (d.type === 'button') {
      const b = el('button', 'pbtn ' + (d.cls || ''), typeof d.label === 'function' ? d.label() : d.label);
      b.type = 'button';
      const handler = async (e) => {
        await d.action(e);
        refresh();
      };
      if (d.hold) {
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); d.action(true); b.classList.add('sel'); });
        const up = () => { if (b.classList.contains('sel')) { d.action(false); b.classList.remove('sel'); } };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('pointerleave', up);
      } else b.addEventListener('click', handler);
      row.append(b);
      if (typeof d.label === 'function') updaters.push(() => (b.textContent = d.label()));
    }
  }
  function refresh() {
    for (const u of updaters) u();
  }
  refresh();
  return refresh;
}
