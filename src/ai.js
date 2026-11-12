// Optional language-model helpers, server side only (Worker + the existing Room Durable Object class).
// Shared file: the source of truth is a shared helper kit; each Game Night repo keeps an identical copy in
// src/ai.js (test/ai.test.js checks the version line). Rules this file enforces:
//  - Never throws to a caller and never blocks a game step: every failure, timeout or budget stop returns null, and the
//    caller shows its normal text. Game reducers (public/js) never import this file.
//  - A daily neuron budget with a durable counter, kept in a reserved instance of the existing Room class (no new
//    class, no migration). A room code is 6 letters, so these reserved names can never be a room.
//  - Output passes a code filter (length, banned phrases, forbidden terms) before anyone sees it.
//  - Only AI_MODE 'on' may call the model. 'dark', 'off', unset or anything else: no model call, no neurons reserved,
//    no budget or cache read (house rule: no AI that could cost money goes live without the maintainer's OK).
export const AI_VERSION = 2;
export const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
// Neurons per million tokens, from https://developers.cloudflare.com/workers-ai/platform/pricing/ (read 2026-10-29).
export const RATES = { '@cf/google/gemma-4-26b-a4b-it': { in: 9091, out: 27273 } };
export const TIMEOUT_MS = 2500;
// The account gets 10,000 free neurons a day (00:00 UTC reset). All workers together stay under 8,000:
// Mafia 2,000 + Odd, Quest, Gilded 1,500 each = 6,500, leaving 1,500 for the hub and Brass Wallet.
export const ACCOUNT_GUARD = 8000;
export const CAPS = { mafia: 2000, odd: 1500, quest: 1500, gilded: 1500, hub: 750, brass: 750 };
export const BUDGET_NAME = '__ai_budget__';
export const CACHE_NAME = '__ai_cache__';
export const CACHE_MAX = 500;
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const estTokens = (s) => Math.ceil(String(s || '').length / 4);
export function neuronsFor(model, inTok, outTok) {
  const r = RATES[model]; if (!r) return Infinity;
  return (inTok * r.in + outTok * r.out) / 1e6;
}
/** True only when AI_MODE is exactly 'on'. Every other value ('dark', 'off', unset) means no model call. */
export const aiOn = (env) => env?.AI_MODE === 'on';
/** Daily cap for this site and mode. Only 'on' has a budget. */
export function capFor(site, mode) {
  return mode === 'on' ? CAPS[site] ?? 0 : 0;
}

// ---------- input cleaning ----------
/** A player-typed name, as it may appear in a prompt: letters, digits, space, ' and -, 20 characters. */
export function sanitizeName(s) {
  return String(s ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20).trim();
}
/** Free text from a player (a question, a theme): no control characters, no markup, one line, capped. */
export function cleanText(s, max = 200) {
  return String(s ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[<>`{}\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// ---------- output filter ----------
export const BANNED = ['as an ai', 'language model', 'certainly', 'absolutely', 'great question', 'i hope this helps', "let's dive", 'lets dive', 'dive in', 'delve',
  'tapestry', 'realm', 'embark', 'journey', 'unleash', 'elevate', 'seamless', 'testament', 'in a world where', 'little did they know', 'magic', 'magical',
  'happy to help', 'feel free', 'i think', "i'm ", 'i am ', ' ai ', 'chatbot', 'assistant'];
const EMOJI = /[\p{Extended_Pictographic}\u2728]/u;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Returns the cleaned text, or null when it must not be shown (the caller then shows its plain text).
 * opts: maxWords, forbid (terms that must never appear, matched as whole words, case-insensitive), maxExclaim.
 */
export function filterOutput(text, { maxWords = 60, forbid = [], maxExclaim = 0 } = {}) {
  if (typeof text !== 'string') return null;
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\*\*|__|^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["“]|["”]$/g, '').trim();
  if (!t) return null;
  if (/[\u2014\u2013]/.test(t)) t = t.replace(/\s*[\u2014\u2013]\s*/g, ', ');
  const low = ` ${t.toLowerCase().replace(/[’']/g, "'")} `;
  if (BANNED.some((b) => low.includes(b))) return null;
  if (EMOJI.test(t) || /#\w/.test(t) || /https?:\/\//i.test(t)) return null;
  if ((t.match(/!/g) || []).length > maxExclaim) return null;
  if (t.split(/\s+/).length > maxWords) return null;
  for (const f of forbid) { if (f && new RegExp(`(^|[^\\p{L}])${escRe(f.toLowerCase())}($|[^\\p{L}])`, 'u').test(t.toLowerCase())) return null; }
  return t;
}

// ---------- timeout ----------
export const TIMEOUT = Symbol('timeout');
export function withTimeout(p, ms = TIMEOUT_MS) {
  let id; const t = new Promise((r) => { id = setTimeout(() => r(TIMEOUT), ms); });
  return Promise.race([Promise.resolve(p).catch(() => TIMEOUT), t]).finally(() => clearTimeout(id));
}

// ---------- the durable budget and cache (inside reserved Room instances) ----------
/** Handle /ai-budget and /ai-cache inside Room.fetch. Returns a Response, or null for any other path. */
export async function handleAiInternal(storage, request, now = Date.now()) {
  const path = new URL(request.url).pathname;
  if (path !== '/ai-budget' && path !== '/ai-cache') return null;
  let body = {}; try { body = await request.json(); } catch { /* empty */ }
  const out = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  if (path === '/ai-budget') {
    const day = utcDay(now);
    let b = (await storage.get('aiBudget')) || { day, used: 0 };
    if (b.day !== day) b = { day, used: 0 };
    if (body.op === 'reserve') {
      const n = Math.max(0, +body.n || 0), cap = Math.max(0, +body.cap || 0);
      if (b.used + n > cap) return out({ ok: false, used: b.used, day });
      b.used += n; await storage.put('aiBudget', b); return out({ ok: true, used: b.used, day });
    }
    if (body.op === 'settle') { // refund the unused part of a reservation (never below what was really spent)
      if (body.day === day) { b.used = Math.max(0, b.used - Math.max(0, +body.reserved || 0) + Math.max(0, +body.actual || 0)); await storage.put('aiBudget', b); }
      return out({ ok: true, used: b.used, day });
    }
    return out({ ok: true, used: b.used, day });
  }
  const key = 'c:' + String(body.key || '').slice(0, 128);
  if (body.op === 'get') {
    const v = await storage.get(key);
    return out(v && now - v.at < CACHE_TTL_MS ? { hit: true, value: v.value } : { hit: false });
  }
  if (body.op === 'put') {
    await storage.put(key, { at: now, value: body.value });
    const idx = ((await storage.get('cIdx')) || []).filter((k) => k !== key); idx.push(key);
    while (idx.length > CACHE_MAX) await storage.delete(idx.shift());
    await storage.put('cIdx', idx);
    return out({ ok: true });
  }
  return out({ ok: false });
}

const internal = async (env, name, path, body) => {
  const stub = env.ROOM.get(env.ROOM.idFromName(name));
  const res = await stub.fetch(`https://room${path}`, { method: 'POST', body: JSON.stringify(body) });
  return res.json();
};
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function cacheGet(env, key) { try { const r = await withTimeout(internal(env, CACHE_NAME, '/ai-cache', { op: 'get', key }), 800); return r !== TIMEOUT && r?.hit ? r.value : null; } catch { return null; } }
export async function cachePut(env, key, value) { try { await withTimeout(internal(env, CACHE_NAME, '/ai-cache', { op: 'put', key, value }), 800); } catch { /* best effort */ } }

/**
 * One model call with every guard. Never throws. Returns { text, neurons, usage } or null.
 * opts: site, messages [{role, content}], maxTokens, filter (fn text -> text|null), now.
 */
export async function runText(env, { site, messages, maxTokens = 160, filter = (t) => filterOutput(t), now = Date.now(), timeoutMs = TIMEOUT_MS }) {
  try {
    if (!aiOn(env)) return null;
    const cap = capFor(site, env.AI_MODE);
    if (!env?.AI || !env?.ROOM || cap <= 0) return null;
    const inTok = estTokens(messages.map((m) => m.content).join('\n')) + 16 * messages.length;
    const reserved = Math.ceil(neuronsFor(AI_MODEL, inTok, maxTokens) * 1.25) + 1; // pessimistic, refunded on settle
    const r = await withTimeout(internal(env, BUDGET_NAME, '/ai-budget', { op: 'reserve', n: reserved, cap }), 800);
    if (r === TIMEOUT || !r?.ok) return null;
    const res = await withTimeout(env.AI.run(AI_MODEL, { messages, max_completion_tokens: maxTokens, temperature: 0.4, chat_template_kwargs: { enable_thinking: false } }), timeoutMs);
    const raw = res === TIMEOUT ? null : res;
    const u = raw?.usage || {};
    const actual = raw ? Math.ceil(Number.isFinite(u.neurons) ? u.neurons : neuronsFor(AI_MODEL, u.prompt_tokens ?? inTok, u.completion_tokens ?? maxTokens)) : reserved; // Workers AI reports usage.neurons // a timeout may still have been billed: keep the reservation
    internal(env, BUDGET_NAME, '/ai-budget', { op: 'settle', day: r.day, reserved, actual }).catch(() => {});
    const content = raw?.choices?.[0]?.message?.content ?? raw?.response ?? null;
    const text = filter(content);
    return text ? { text, neurons: actual, usage: u } : null;
  } catch { return null; }
}
