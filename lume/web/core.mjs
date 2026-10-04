// SPDX-License-Identifier: MPL-2.0
const te = new TextEncoder(), td = new TextDecoder();
export function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export function decode(text) {
  return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
}
export function randomKey() { return encode(crypto.getRandomValues(new Uint8Array(32))); }
export const context = (op) => JSON.stringify([1, op.id, op.profile, op.entity, [...op.parents].sort()]);
export async function importKey(raw) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw || '')) throw new Error('Invalid vault key');
  return crypto.subtle.importKey('raw', decode(raw), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(key, op, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:te.encode(context(op)) }, key, te.encode(JSON.stringify(value)));
  return { v:1, iv:encode(iv), ct:encode(ct) };
}
export async function open(key, op) {
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:decode(op.envelope.iv), additionalData:te.encode(context(op)) }, key, decode(op.envelope.ct));
  return JSON.parse(td.decode(plain));
}
export function emptyState() { return { v:1, instance:null, cursor:0, operations:[], pending:[] }; }
// Observed-remove multi-value register. Concurrent versions survive; no wall clocks.
export function versions(state, profile, entity) {
  const map = new Map();
  for (const op of [...state.operations,...state.pending]) {
    if (op.profile === profile && op.entity === entity) map.set(op.id, op);
  }
  const removed = new Set([...map.values()].flatMap(op => op.parents));
  return [...map.values()].filter(op => !removed.has(op.id)).sort((a,b) => a.id.localeCompare(b.id));
}
export function entities(state, profile) {
  return [...new Set([...state.operations,...state.pending].filter(op => op.profile === profile).map(op => op.entity))].sort();
}
export class SyncClient {
  constructor({ endpoint, token, key, load, save, fetcher = fetch }) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) throw new Error('HTTPS required');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the Worker origin only');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('Invalid device token');
    this.endpoint = url.origin; this.token = token; this.key = key;
    this.load = load; this.save = save; this.fetcher = fetcher; this.lock = Promise.resolve();
  }
  serial(action) {
    const next = this.lock.then(action); this.lock = next.catch(() => {}); return next;
  }
  async request(path, body) {
    const r = await this.fetcher(this.endpoint + path, { method: body ? 'POST':'GET', cache:'no-store',
      headers:{ 'Authorization':`Bearer ${this.token}`, ...(body ? {'Content-Type':'application/json'}:{}) },
      ...(body ? { body:JSON.stringify(body) }:{}) });
    const data = await r.json();
    if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return data;
  }
  write(profile, entity, value) {
    return this.serial(async () => {
      if (![profile,entity].every(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v))) throw new Error('Invalid record identifier');
      if (te.encode(JSON.stringify(value)).length > 22000) throw new Error('Record too large');
      const state = await this.load() || emptyState();
      const op = { id:crypto.randomUUID(), profile, entity, parents:versions(state,profile,entity).map(x => x.id) };
      if (op.parents.length > 64) throw new Error('Too many concurrent versions; explicit recovery required');
      op.envelope = await seal(this.key,op,value);
      state.pending.push(op); await this.save(state); // Persist before any network attempt.
      return op.id;
    });
  }
  sync() {
    return this.serial(async () => {
      const state = await this.load() || emptyState();
      const pull = async () => {
        let more;
        do {
          const page = await this.request(`/api/v1/changes?after=${state.cursor}`);
          if (state.instance && state.instance !== page.instance) throw new Error('server_instance_changed');
          if (!Number.isSafeInteger(page.cursor) || page.cursor < state.cursor ||
              (page.hasMore && page.cursor === state.cursor)) throw new Error('invalid_server_cursor');
          // Authenticate every envelope before advancing the durable cursor.
          for (const op of page.operations) await open(this.key, op);
          state.instance = page.instance;
          const seen = new Set(state.operations.map(x => x.id));
          for (const op of page.operations) if (!seen.has(op.id)) { state.operations.push(op); seen.add(op.id); }
          state.cursor = page.cursor;
          // Once present in the log, an operation survived even a lost POST response.
          state.pending = state.pending.filter(op => !seen.has(op.id));
          await this.save(state); more = page.hasMore;
        } while (more);
      };
      await pull();
      // Acknowledge only through a subsequent pull, never drop the outbox on POST.
      while (state.pending.length) {
        const before = state.pending.length;
        await this.request('/api/v1/operations', { operations: state.pending.slice(0, 4) });
        await pull();
        if (state.pending.length >= before) throw new Error('acknowledgement_not_visible');
      }
      return state;
    });
  }
  async read(profile, entity) {
    const state = await this.load() || emptyState();
    return Promise.all(versions(state,profile,entity).map(async op => ({ id:op.id, value:await open(this.key,op) })));
  }
}
