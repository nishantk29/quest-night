// Checks every text/background colour pair of the Quest Night theme (WCAG 2 contrast).
// Usage: node scripts/contrast.mjs   (exits 1 if any text pair is under 4.5:1, or any large-text/icon pair under 3:1)
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const theme = css.slice(css.lastIndexOf('Quest Night theme'));
const block = (sel) => { const i = theme.indexOf(sel + '{'); const j = theme.indexOf('}', i); return Object.fromEntries([...theme.slice(i, j).matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]])); };
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const TEXT = [['candle', 'room'], ['candle', 'panel'], ['candle', 'panel-2'], ['smoke', 'room'], ['smoke', 'panel'], ['smoke', 'panel-2'], ['faint', 'room'], ['faint', 'panel'], ['faint', 'panel-2'],
  ['town', 'room'], ['town', 'panel'], ['mafia', 'room'], ['mafia', 'panel'], ['on-brass', 'brass'], ['accent', 'room'], ['warn', 'room'], ['warn', 'panel'],
  ['felt-muted', 'baize'], ['on-fill', 'reform-fill'], ['on-fill', 'cabal-fill'], ['room', 'candle']];
const FIXED = [['#FFFFFF', '#17317E', 'white on navy card'], ['#FFFFFF', '#2A2A86', 'white on indigo card'], ['#FFFFFF', '#4A2582', 'white on plum card'], ['#CFD8F6', '#4A2582', 'muted on plum card'], ['#CFD8F6', '#2A2A86', 'muted on indigo card'], ['#B4C0EA', '#4A2582', 'faint on plum card'], ['#B4C0EA', '#10256A', 'faint on inner chip'], ['#0E1F5C', '#FFD25A', 'navy on gold card'], ['#FFFFFF', '#2F6BD6', 'white on blue block'], ['#FFFFFF', '#B3131F', 'white on red block'], ['#B9B9C6', '#26262E', 'disabled pill'], ['#FFD25A', '#0E1F5C', 'gold on navy seal'], ['#1B1B3A', '#FFF4E6', 'note ink on parchment'], ['#8A1018', '#FFF4E6', 'note icon on parchment'], ['#FFFFFF', '#2F6BD6', 'card ink on Loyal art'], ['#FFFFFF', '#6E0A12', 'card ink on Evil art'], ['#B3262E', '#F2E6C8', 'red card index'], ['#FFFFFF', '#1F3F9A', 'white on baize lit'], ['#FFFFFF', '#0B1A55', 'white on inset field'], ['#CFD8F6', '#26262E', 'muted on chip']];
let bad = 0;
const base = block(':root');
for (const [name, t] of [['theme', base]]) {
  for (const [f, b] of TEXT) { if (!t[f] || !t[b]) continue; const r = ratio(t[f], t[b]); const ok = r >= 4.5; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${f.padEnd(11)} on ${b.padEnd(11)} ${r.toFixed(2)}`); }
}
for (const [f, b, what, min = 4.5] of FIXED) { const r = ratio(f, b); const ok = r >= min; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} fixed     ${what.padEnd(26)} ${r.toFixed(2)}`); }
console.log(bad ? `${bad} pairs below 4.5:1` : 'All text pairs pass 4.5:1 (WCAG AA).');
process.exit(bad ? 1 : 0);
