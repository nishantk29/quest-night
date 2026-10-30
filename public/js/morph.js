// Patch a live element to match new markup instead of replacing it (table jank fix, 2026-10-29).
// Replacing #app.innerHTML on every room update rebuilt the whole page: every node restyled and laid out again,
// images and SVGs re-created, CSS entrance animations replayed, and inner scroll boxes jumped. morph() keeps every
// node that is still there and only touches what changed: changed text, changed attributes, added or removed nodes.
// Matching: an element with an id or data-mk (morph key) is matched by that key among its siblings; anything else by position,
// tag name and node type. Form fields keep what the user is typing (the focused field's value is never overwritten).
// Same result as innerHTML for the markup (same nodes, attributes and text); only the work to get there differs.

const keyOf = (n) => (n.nodeType === 1 ? n.id || n.getAttribute('data-mk') || null : null);

function syncAttrs(a, b) {
  const old = a.attributes; const nu = b.attributes;
  for (let i = old.length - 1; i >= 0; i--) {
    const at = old[i];
    if (at.namespaceURI ? !b.hasAttributeNS(at.namespaceURI, at.localName) : !b.hasAttribute(at.name)) {
      if (at.namespaceURI) a.removeAttributeNS(at.namespaceURI, at.localName); else a.removeAttribute(at.name);
    }
  }
  for (let i = 0; i < nu.length; i++) {
    const at = nu[i];
    if (at.namespaceURI) { if (a.getAttributeNS(at.namespaceURI, at.localName) !== at.value) a.setAttributeNS(at.namespaceURI, at.name, at.value); }
    else if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  }
}

function syncField(a, b) {
  const focused = a.ownerDocument.activeElement === a;
  if (a.nodeName === 'INPUT') {
    if (a.type === 'checkbox' || a.type === 'radio') { const c = b.hasAttribute('checked'); if (a.checked !== c) a.checked = c; }
    else if (!focused) { const v = b.getAttribute('value') ?? ''; if (a.value !== v) a.value = v; }
  } else if (a.nodeName === 'TEXTAREA') { if (!focused && a.value !== b.value) a.value = b.value; }
  else if (a.nodeName === 'OPTION') { const s = b.hasAttribute('selected'); if (a.selected !== s) a.selected = s; }
}

const FIELDS = 'input,textarea,select';
function patch(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  // An unchanged subtree (most of the page on a live update: the board art, every SVG icon) is skipped with one native
  // compare instead of walking it in JS. Not when it holds a form field: a field's live value is not in the markup.
  if (a.isEqualNode && a.isEqualNode(b) && !a.matches(FIELDS) && !a.querySelector(FIELDS)) return;
  syncAttrs(a, b);
  if (a.nodeName === 'TEXTAREA') { syncField(a, b); return; }
  patchChildren(a, b);
  if (a.nodeName === 'INPUT' || a.nodeName === 'OPTION') syncField(a, b);
  else if (a.nodeName === 'SELECT') { const i = [...b.options].findIndex((o) => o.hasAttribute('selected')); if (i >= 0 && a.selectedIndex !== i && a.ownerDocument.activeElement !== a) a.selectedIndex = i; }
}

const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);

function patchChildren(from, to) {
  let keyed = null; // built only when a child has a key (most lists have none)
  for (let c = from.firstChild; c; c = c.nextSibling) { const k = keyOf(c); if (k) { keyed ??= new Map(); if (!keyed.has(k)) keyed.set(k, c); } }
  let cur = from.firstChild; let next = to.firstChild;
  while (next) {
    const after = next.nextSibling; const k = keyOf(next);
    let match = null;
    if (k) { const c = keyed?.get(k); if (c && c.nodeName === next.nodeName && c.parentNode === from) match = c; }
    else if (cur && sameKind(cur, next)) match = cur;
    if (match) {
      if (k) keyed?.delete(k);
      if (match === cur) cur = cur.nextSibling; else from.insertBefore(match, cur);
      patch(match, next);
    } else {
      from.insertBefore(next, cur); // a new node: moved in straight from the parsed markup
    }
    next = after;
  }
  while (cur) { const n = cur.nextSibling; from.removeChild(cur); cur = n; }
}

/** Make `root`'s children match `html` (the same DOM innerHTML would give, built by patching). */
export function morph(root, html) {
  const tpl = root.ownerDocument.createElement('template');
  tpl.innerHTML = html;
  patchChildren(root, tpl.content);
}
/** The same patch from already-built nodes (`fresh` is a parent whose children are the new content; they get moved in). */
export const morphChildren = patchChildren;
