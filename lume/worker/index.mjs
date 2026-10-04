// SPDX-License-Identifier: MPL-2.0
// Single-owner installation. Each owner deploys a separate Worker/DO namespace.
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const MAX_BODY = 131072;
export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
const fail = (status, code) => { throw new HttpError(status, code); };
export const digest = async (text) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', encoder.encode(text))
)).map(x => x.toString(16).padStart(2, '0')).join('');
function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function response(data, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }});
}
async function json(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'json_required');
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) fail(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'body_required');
  let total = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BODY) { await reader.cancel(); fail(413, 'body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'invalid_json'); }
}
export function normalizeOperation(op) {
  if (!op || ['id','profile','entity'].some(k => typeof op[k] !== 'string' || !ID.test(op[k]))) fail(400, 'invalid_operation');
  if (!Array.isArray(op.parents) || op.parents.length > 64 ||
      op.parents.some(p => typeof p !== 'string' || !ID.test(p) || p === op.id) ||
      new Set(op.parents).size !== op.parents.length) fail(400, 'invalid_parents');
  const e = op.envelope;
  if (!e || e.v !== 1 || !/^[A-Za-z0-9_-]{16}$/.test(e.iv || '') ||
      typeof e.ct !== 'string' || e.ct.length < 22 || e.ct.length > 32768 ||
      !/^[A-Za-z0-9_-]+$/.test(e.ct)) fail(400, 'invalid_envelope');
  return { id: op.id, profile: op.profile, entity: op.entity,
    parents: [...op.parents].sort(), envelope: { v: 1, iv: e.iv, ct: e.ct } };
}

// Plain Durable Object class uses the SQLite-backed storage selected in Wrangler.
export class LumeVault {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec(`INSERT OR IGNORE INTO meta VALUES ('instance', ?)`, crypto.randomUUID());
    this.sql.exec(`CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS operations (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
      profile TEXT NOT NULL, entity TEXT NOT NULL, parents TEXT NOT NULL,
      envelope TEXT NOT NULL, device TEXT NOT NULL, fingerprint TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS heads (
      id TEXT PRIMARY KEY, profile TEXT NOT NULL, entity TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS heads_entity ON heads(profile,entity)`);
  }
  rows(query, ...args) { return Array.from(this.sql.exec(query, ...args)); }
  device(hash) {
    const d = this.rows('SELECT id FROM devices WHERE token_hash=? AND revoked=0', hash)[0];
    if (!d) fail(401, 'unauthorized');
    return d.id;
  }
  async fetch(request) {
    try { return await this.handle(request); }
    catch (error) {
      // Never log bodies, tokens, profile names, or ciphertext.
      return response({ error: error instanceof HttpError ? error.message : 'internal_error' },
        error instanceof HttpError ? error.status : 500);
    }
  }
  async handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) fail(403, 'cross_origin_denied');
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) fail(401, 'unauthorized');
    const hash = await digest(token);
    const adminRoute = url.pathname.startsWith('/api/v1/devices');
    if (adminRoute) {
      const admin = this.env.LUME_ADMIN_TOKEN;
      if (!admin || !TOKEN.test(admin)) fail(503, 'setup_required');
      if (!equal(hash, await digest(admin))) fail(401, 'unauthorized');
      if (url.pathname === '/api/v1/devices' && request.method === 'POST') {
        const input = await json(request);
        if (!input || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 ||
            !TOKEN.test(input.token || '')) fail(400, 'invalid_device');
        if (input.token === admin) fail(400, 'separate_device_token_required');
        const id = crypto.randomUUID(), tokenHash = await digest(input.token);
        return this.state.storage.transactionSync(() => {
          if (this.rows('SELECT COUNT(*) AS n FROM devices WHERE revoked=0')[0].n >= 64) fail(409, 'device_limit');
          if (this.rows('SELECT id FROM devices WHERE token_hash=?', tokenHash).length) fail(409, 'token_already_registered');
          this.sql.exec('INSERT INTO devices(id,label,token_hash,created) VALUES(?,?,?,?)', id, input.label.trim(), tokenHash, Date.now());
          return response({ id }, 201);
        });
      }
      if (url.pathname === '/api/v1/devices' && request.method === 'GET') {
        return response({ devices: this.rows('SELECT id,label,created,revoked FROM devices ORDER BY created') });
      }
      const id = url.pathname.match(/^\/api\/v1\/devices\/([a-zA-Z0-9_-]+)$/)?.[1];
      if (id && request.method === 'DELETE') {
        this.sql.exec('UPDATE devices SET revoked=1 WHERE id=?', id);
        return response({ revoked: true });
      }
      fail(404, 'not_found');
    }
    const device = this.device(hash);
    if (url.pathname === '/api/v1/changes' && request.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      const max = this.rows('SELECT COALESCE(MAX(seq),0) AS n FROM operations')[0].n;
      if (!Number.isSafeInteger(after) || after < 0) fail(400, 'invalid_cursor');
      if (after > max) fail(409, 'server_rewound');
      const rows = this.rows('SELECT seq,id,profile,entity,parents,envelope,device FROM operations WHERE seq>? ORDER BY seq LIMIT 257', after);
      const operations = rows.slice(0, 256).map(r => ({ ...r, parents: JSON.parse(r.parents), envelope: JSON.parse(r.envelope) }));
      return response({ instance: this.rows("SELECT value FROM meta WHERE key='instance'")[0].value,
        operations, cursor: operations.at(-1)?.seq ?? after, hasMore: rows.length > 256 });
    }
    if (url.pathname === '/api/v1/operations' && request.method === 'POST') {
      const input = await json(request);
      if (!input || !Array.isArray(input.operations) || !input.operations.length || input.operations.length > 32) fail(400, 'invalid_batch');
      const ops = input.operations.map(normalizeOperation);
      const hashes = await Promise.all(ops.map(op => digest(JSON.stringify(op))));
      return this.state.storage.transactionSync(() => {
        this.device(hash); // Revocation may have happened while reading the body.
        const acknowledgements = [];
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          const old = this.rows('SELECT seq,fingerprint,device FROM operations WHERE id=?', op.id)[0];
          if (old) {
            if (old.fingerprint !== hashes[i] || old.device !== device) fail(409, 'operation_id_reused');
            acknowledgements.push({ id: op.id, seq: old.seq }); continue;
          }
          for (const parent of op.parents) {
            const p = this.rows('SELECT profile,entity FROM operations WHERE id=?', parent)[0];
            if (!p || p.profile !== op.profile || p.entity !== op.entity) fail(409, 'unknown_or_foreign_parent');
          }
          this.sql.exec('INSERT INTO operations(id,profile,entity,parents,envelope,device,fingerprint) VALUES(?,?,?,?,?,?,?)',
            op.id, op.profile, op.entity, JSON.stringify(op.parents), JSON.stringify(op.envelope), device, hashes[i]);
          const seq = this.rows('SELECT seq FROM operations WHERE id=?', op.id)[0].seq;
          for (const parent of op.parents) this.sql.exec('DELETE FROM heads WHERE id=?', parent);
          this.sql.exec('INSERT INTO heads(id,profile,entity) VALUES(?,?,?)', op.id, op.profile, op.entity);
          acknowledgements.push({ id: op.id, seq });
        }
        return response({ acknowledgements });
      });
    }
    fail(404, 'not_found');
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return response({ name: 'Lume Sync', protocol: 1 });
    if (path.startsWith('/api/')) {
      return env.LUME_VAULT.get(env.LUME_VAULT.idFromName('owner-vault-v1')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
