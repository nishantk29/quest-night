// Checks every text/background colour pair of the Quest Night theme (WCAG 2 contrast).
// Usage: node scripts/contrast.mjs   (exits 1 if any text pair is under 4.5:1, or any large-text/icon pair under 3:1)
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const theme = css.slice(css.lastIndexOf('Quest Night theme'));
const block = (sel) => { const i = theme.indexOf(sel + '{'); const j = theme.indexOf('}', i); return Object.fromEntries([...theme.slice(i, j).matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]])); };
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const TEXT = [['candle', 'room'], ['candle', 'panel'], ['candle', 'panel-2'], ['smoke', 'room'], ['smoke', 'panel'], ['smoke', 'panel-2'], ['faint', 'room'],
  ['town', 'room'], ['town', 'panel'], ['mafia', 'room'], ['mafia', 'panel'], ['on-brass', 'brass'], ['accent', 'room'], ['warn', 'room'], ['warn', 'panel'],
  ['felt-muted', 'baize'], ['on-fill', 'reform-fill'], ['on-fill', 'cabal-fill'], ['room', 'candle']];
const FIXED = [['#DCE9FB', '#17305A', 'card ink on Loyal art'], ['#FFD6CF', '#3A0C14', 'card ink on Shadow art'], ['#B3262E', '#F2E6C8', 'red card index'], ['#0c1626', '#3e68a6', 'success seal icon (3:1)', 3], ['#F3EAD3', '#244677', 'felt names'], ['#BAC4D4', '#13213A', 'muted on panel']];
let bad = 0;
const base = block(':root');
for (const [name, t] of [['theme', base]]) {
  for (const [f, b] of TEXT) { if (!t[f] || !t[b]) continue; const r = ratio(t[f], t[b]); const ok = r >= 4.5; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${f.padEnd(11)} on ${b.padEnd(11)} ${r.toFixed(2)}`); }
}
for (const [f, b, what, min = 4.5] of FIXED) { const r = ratio(f, b); const ok = r >= min; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} fixed     ${what.padEnd(26)} ${r.toFixed(2)}`); }
console.log(bad ? `${bad} pairs below 4.5:1` : 'All text pairs pass 4.5:1 (WCAG AA).');
process.exit(bad ? 1 : 0);
