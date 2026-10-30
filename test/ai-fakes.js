// Test fakes for the AI helpers: an in-memory Room namespace (reserved instances run handleAiInternal) and a fake model.
import { handleAiInternal, BUDGET_NAME, CACHE_NAME } from '../src/ai.js';

export class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(k) { return this.m.delete(k); }
}
export function fakeEnv({ mode = 'dark', ai, now, hangBudget = false } = {}) {
  const stores = new Map(); const touched = [];
  const ROOM = {
    idFromName: (n) => { touched.push(n); if (n !== BUDGET_NAME && n !== CACHE_NAME) throw new Error(`AI code touched room ${n}`); return n; },
    get: (id) => ({ fetch: async (url, init) => {
      if (hangBudget) return new Promise(() => {});
      if (!stores.has(id)) stores.set(id, new MemStorage());
      return handleAiInternal(stores.get(id), new Request(url, init), now ? now() : Date.now());
    } }),
  };
  return { env: { AI_MODE: mode, ROOM, AI: ai }, stores, touched };
}
export function fakeAI(reply = 'Fine answer.', usage = { prompt_tokens: 600, completion_tokens: 40 }) {
  const calls = [];
  return { calls, run: async (model, input) => { calls.push({ model, input }); return typeof reply === 'function' ? reply(input) : { choices: [{ message: { content: reply } }], usage }; } };
}
