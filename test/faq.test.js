import test from 'node:test';
import assert from 'node:assert/strict';
import { wireFaqSearch } from '../public/js/table_ui.js';

test('FAQ search: clearing the box closes the answers the search opened, but not ones the reader opened', () => {
  const mk = (text, open = false) => ({ textContent: text, open, hidden: false, dataset: {} });
  const tie = mk('How is a tie broken?'); const cards = mk('Which cards?', true); const other = mk('Timer');
  const qs = [tie, cards, other];
  const group = { hidden: false, querySelectorAll: () => qs };
  const none = { hidden: true }; let handler;
  const root = { addEventListener: (_, f) => { handler = f; }, querySelectorAll: (s) => (s === '.faq-q' ? qs : [group]), querySelector: () => none };
  wireFaqSearch(root);
  const type = (value) => handler({ target: { dataset: { faq: 'search' }, value } });
  type('tie');
  assert.equal(tie.open, true); assert.equal(other.hidden, true); assert.equal(none.hidden, true);
  type('zzz'); assert.equal(none.hidden, false);
  type('');
  assert.equal(tie.open, false, 'search-opened answer collapses again');
  assert.equal(cards.open, true, 'reader-opened answer stays open');
  assert.equal(other.hidden, false); assert.equal(none.hidden, true);
});
