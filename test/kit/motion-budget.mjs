// Motion budget (design review, 2026-10-29): presses land in 100-150ms and are never scaled by --dur-scale;
// no animation or transition runs over 400ms (duration, and delay + duration where the delay is known).
// Static resolver: reads every stylesheet, <style> block and CSS-in-JS template under public/, resolves
// var()/calc()/min()/max() against the custom properties defined there, and checks every time value.
import fs from 'node:fs';
import path from 'node:path';

export const CAP = 400;
export const PRESS_MIN = 100;
export const PRESS_MAX = 150;

const SKIP_CTX = /prefers-reduced-motion:\s*reduce|data-fx="off"|html\.flat(?![\w-])|\.is-settled/;
const PROPS = /(?<![\w-])(animation|animation-duration|animation-delay|transition|transition-duration|transition-delay)\s*:([^;{}]*)/g;

export function listFiles(pub) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!/^(fonts|icons|print|art)$/.test(f)) walk(p); }
      else if (/\.(css|html|js)$/.test(f) && !/^(pwa-install\.js|sw\.js)$/.test(f) && !/manifest/.test(f)) out.push(p);
    }
  })(pub);
  return out;
}

export function cssSources(pub) {
  const out = [];
  for (const f of listFiles(pub)) {
    const s = fs.readFileSync(f, 'utf8');
    const rel = path.relative(pub, f);
    if (f.endsWith('.css')) out.push({ file: rel, css: s });
    else if (f.endsWith('.html')) for (const m of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push({ file: rel, css: m[1] });
    else for (const m of s.matchAll(/`[^`]*`/g)) if (/(animation|transition)[\w-]*\s*:/.test(m[0])) out.push({ file: rel, css: m[0].slice(1, -1), js: true });
  }
  return out.map((o) => ({ ...o, css: o.css.replace(/\/\*[\s\S]*?\*\//g, '') }));
}

// The selector/at-rule context enclosing position pos.
export function ctxAt(src, pos) {
  const stack = []; let pre = 0;
  for (let k = 0; k < pos; k++) {
    const c = src[k];
    if (c === '{') { stack.push(src.slice(pre, k)); pre = k + 1; } else if (c === '}') { stack.pop(); pre = k + 1; } else if (c === ';') pre = k + 1;
  }
  return stack.map((x) => x.trim()).join(' | ');
}

export function customProps(sources) {
  const map = new Map();
  for (const { css } of sources) {
    for (const m of css.matchAll(/(?<![\w-])(--[\w-]+)\s*:([^;{}]*)/g)) {
      if (SKIP_CTX.test(ctxAt(css, m.index))) continue;
      const v = m[2].trim();
      if (v.includes('${')) continue; // JS template value, checked at runtime
      if (!map.has(m[1])) map.set(m[1], new Set());
      map.get(m[1]).add(v.replace(/!important/, '').trim());
    }
  }
  return map;
}

export function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++; else if (c === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Every value a token can take (a custom property may be defined more than once): array of strings.
function expand(tok, props, depth = 0) {
  if (depth > 12) throw new Error(`var() loop in ${tok}`);
  const m = /var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\))*[^()]*))?\)/.exec(tok);
  if (!m) return [tok];
  const defs = props.get(m[1]);
  const choices = defs ? [...defs] : (m[2] !== undefined ? [m[2].trim()] : [null]);
  const out = [];
  for (const c of choices) {
    if (c === null) { out.push(null); continue; }
    for (const e of expand(tok.slice(0, m.index) + c + tok.slice(m.index + m[0].length), props, depth + 1)) out.push(e);
  }
  return out;
}

const TIME = /^(?:-?\d*\.?\d+(?:ms|s)|(?:calc|min|max)\(.*\))$/;
export function isTimeToken(tok, props) {
  if (/^var\(/.test(tok)) return expand(tok, props).some((e) => e !== null && /(?:\d)(?:ms|s)\b/.test(e) && !/cubic|steps|ease|linear/.test(e));
  return TIME.test(tok) && /\d(?:ms|s)\b/.test(tok);
}

// ms value(s) of a time token, or null when it depends on an undefined variable (per-element JS values).
export function evalTime(tok, props) {
  const vals = [];
  for (const e of expand(tok, props)) {
    if (e === null || /var\(/.test(e)) return null;
    let js = e.replace(/(-?\d*\.?\d+)(ms|s)\b/g, (_, n, u) => `(${u === 's' ? +n * 1000 : +n})`)
      .replace(/calc\(/g, '(').replace(/min\(/g, 'Math.min(').replace(/max\(/g, 'Math.max(');
    if (!/^[\d\s.+\-*/(),Mathinax]*$/.test(js)) return null;
    vals.push(Function(`return (${js})`)());
  }
  return vals.length ? Math.max(...vals) : null;
}

export function declarations(sources) {
  const out = [];
  for (const src of sources) {
    for (const m of src.css.matchAll(PROPS)) {
      const ctx = ctxAt(src.css, m.index);
      if (SKIP_CTX.test(ctx)) continue;
      out.push({ file: src.file, ctx, prop: m[1], value: m[2].replace(/!important/, '').trim(), js: !!src.js });
    }
  }
  return out;
}

// [{where, kind, ms}] for every duration/delay; ms === null when not statically known.
export function timings(sources) {
  const props = customProps(sources);
  const rows = [];
  for (const d of declarations(sources)) {
    if (d.value.includes('${')) { rows.push({ where: `${d.file} ${d.ctx} ${d.prop}`, kind: 'js', ms: null, value: d.value }); continue; }
    for (const layer of splitTop(d.value, ',')) {
      const times = splitTop(layer, ' ').filter((t) => isTimeToken(t, props));
      const kinds = d.prop.endsWith('-delay') ? times.map(() => 'delay') : d.prop.endsWith('-duration') ? times.map(() => 'duration') : ['duration', 'delay'];
      const ms = times.map((t) => evalTime(t, props));
      times.forEach((t, i) => rows.push({ where: `${d.file} ${d.ctx} {${d.prop}:${layer}}`, kind: kinds[i] || 'extra', ms: ms[i], value: t, end: kinds[i] === 'duration' && ms[i + 1] != null && ms[i] != null ? ms[i] + ms[i + 1] : null }));
    }
  }
  return { rows, props };
}

export function overBudget(pub) {
  const { rows } = timings(cssSources(pub));
  return rows.filter((r) => r.ms != null && (r.ms > CAP || (r.end != null && r.end > CAP)))
    .map((r) => `${r.where} -> ${r.kind} ${r.ms}ms${r.end != null ? ` (ends ${r.end}ms)` : ''}`);
}

// JS timings: dur(N) and the listed motion constants must stay within the cap.
export function jsOverBudget(pub, scale) {
  const bad = [];
  for (const f of listFiles(pub).filter((x) => x.endsWith('.js') || x.endsWith('.html'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bdur\(\s*(\d+(?:\.\d+)?)\s*\)/g)) if (+m[1] * scale > CAP) bad.push(`${path.relative(pub, f)}: ${m[0]} = ${+m[1] * scale}ms`);
    for (const m of s.matchAll(/\.animate\([^)]*?duration:\s*(\d+)/g)) if (+m[1] > CAP) bad.push(`${path.relative(pub, f)}: ${m[0]}`);
  }
  return bad;
}

// Press feedback: :root --f-press is a plain 100-150ms (not scaled), every :active transform is the
// press scale or none, and the press block applies --f-press to presses outside reduced motion.
export function pressProblems(sources, { rowSelectors = [] } = {}) {
  const props = customProps(sources);
  const bad = [];
  const press = props.get('--f-press');
  if (!press || press.size !== 1) bad.push(`--f-press must be defined once (got ${press ? [...press] : 'none'})`);
  else {
    const v = [...press][0];
    if (/dur-scale|var\(/.test(v)) bad.push(`--f-press is scaled: ${v}`);
    const ms = evalTime(v, props);
    if (ms == null || ms < PRESS_MIN || ms > PRESS_MAX) bad.push(`--f-press = ${v} (${ms}ms), want ${PRESS_MIN}-${PRESS_MAX}ms`);
  }
  const ps = props.get('--f-press-scale');
  if (!ps || [...ps].some((v) => +v !== 0.97)) bad.push(`--f-press-scale must be .97 (got ${ps ? [...ps] : 'none'})`);
  let pressRule = false;
  for (const { file, css } of sources) {
    for (const m of css.matchAll(/([^{}]*:active[^{}]*)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(); const body = m[2];
      const ctx = ctxAt(css, m.index);
      if (SKIP_CTX.test(ctx)) continue;
      const t = /(?<![\w-])transform\s*:([^;]*)/.exec(body);
      if (t && !/^\s*(none|(perspective\([^()]*\)\s*)?scale\(var\(--f-press-scale\)\)|scale\(\.97\))\s*(!important)?\s*$/.test(t[1])) bad.push(`${file}: ${sel} {transform:${t[1].trim()}}`);
      if (t && rowSelectors.some((r) => sel.split(',').some((s) => s.includes(r))) && !/none/.test(t[1])) bad.push(`${file}: list row ${sel} scales on press`);
      if (/transition-duration\s*:\s*var\(--f-press\)/.test(body)) pressRule = true;
      const td = /transition(?:-duration)?\s*:([^;]*)/.exec(body);
      if (td && /dur-scale/.test(td[1])) bad.push(`${file}: ${sel} press transition is scaled`);
    }
  }
  if (!pressRule) bad.push('no :active rule applies transition-duration:var(--f-press)');
  return bad;
}

// --- 2026-10-29 spec additions: no --dur-scale, play once (no loops), transform and opacity only ---
const COMPOSITOR = /^(transform|opacity|translate|scale|rotate|offset[\w-]*|animation-timing-function|visibility|display|overlay|--[\w-]+)$/;

// Every file under public/ and src/ (including sw.js and pwa-install.js) that still mentions --dur-scale.
export function durScaleUses(repo) {
  const bad = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!/^(fonts|icons|print|art|node_modules)$/.test(f)) walk(p); }
      else if (/\.(css|html|js|mjs)$/.test(f)) {
        const s = fs.readFileSync(p, 'utf8');
        for (const m of s.matchAll(/--dur-scale/g)) bad.push(`${path.relative(repo, p)}:${s.slice(0, m.index).split('\n').length}`);
      }
    }
  })(path.join(repo, 'public'));
  for (const sub of ['src']) {
    const d = path.join(repo, sub); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (/\.(js|mjs)$/.test(f)) { const s = fs.readFileSync(path.join(d, f), 'utf8'); if (s.includes('--dur-scale')) bad.push(`${sub}/${f}`); }
  }
  return bad;
}

// Any looping animation: CSS infinite / iteration-count above 1, or JS iterations above 1 / Infinity.
export function loops(sources, pub) {
  const bad = [];
  for (const { file, css } of sources) {
    for (const m of css.matchAll(/(?<![\w-])animation(-iteration-count)?\s*:([^;{}]*)/g)) {
      if (/\binfinite\b/.test(m[2])) bad.push(`${file}: animation${m[1] || ''}:${m[2].trim()}`);
      else if (m[1]) { const n = parseFloat(m[2]); if (!(n <= 1)) bad.push(`${file}: animation-iteration-count:${m[2].trim()}`); }
    }
  }
  for (const f of listFiles(pub).filter((x) => /\.(js|html)$/.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/iterations\s*:\s*([\w.]+)/g)) if (!(+m[1] <= 1)) bad.push(`${path.relative(pub, f)}: iterations: ${m[1]}`);
    for (const m of s.matchAll(/animationIterationCount\s*=\s*['"]?([\w.]+)/g)) if (!(+m[1] <= 1)) bad.push(`${path.relative(pub, f)}: animationIterationCount = ${m[1]}`);
  }
  return bad;
}

// Keyframes and transitions animate transform and opacity only (colour and shadow changes land instantly).
export function nonCompositor(sources) {
  const bad = [];
  for (const { file, css } of sources) {
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
      const props = [...new Set([...m[2].matchAll(/([\w-]+)\s*:/g)].map((x) => x[1]))].filter((p) => !COMPOSITOR.test(p));
      if (props.length) bad.push(`${file}: @keyframes ${m[1]} animates ${props.join(', ')}`);
    }
    for (const m of css.matchAll(/(?<![\w-])transition(-property)?\s*:([^;{}]*)/g)) {
      if (SKIP_CTX.test(ctxAt(css, m.index))) continue;
      for (const layer of splitTop(m[2], ',')) {
        const p = layer.trim().split(/\s+/)[0];
        if (!p || /^(none|all\b)/.test(p) && p !== 'all') continue;
        if (/^(-?\d|var\(|calc\(|\$\{)/.test(p) && !m[1]) continue;
        if (p === 'all' || (!COMPOSITOR.test(p) && !/^(none|var\(|\$\{)/.test(p))) bad.push(`${file}: transition${m[1] || ''}: ${layer.trim()}`);
      }
    }
  }
  return bad;
}
