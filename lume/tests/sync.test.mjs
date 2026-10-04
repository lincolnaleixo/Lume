// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LumeVault } from '../worker/index.mjs';
import { SyncClient, randomKey, importKey, seal, open, versions, emptyState } from '../web/core.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const state = { storage: {
    sql: { exec(query,...args) { const p=db.prepare(query); return p.columns().length ? p.all(...args) : (p.run(...args),[]); } },
    transactionSync(fn) { db.exec('BEGIN'); try { const r=fn(); db.exec('COMMIT'); return r; } catch(e) { db.exec('ROLLBACK'); throw e; } }
  }};
  const admin=randomKey(), token=randomKey(), vault=new LumeVault(state,{ LUME_ADMIN_TOKEN:admin });
  const request=(path, method='GET', body, t=token, headers={}) => vault.fetch(new Request(`https://lume.test${path}`, {
    method, headers:{ Authorization:`Bearer ${t}`, 'Content-Type':'application/json',...headers },
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  }));
  const register=async(t=token)=>{
    const r=await request('/api/v1/devices','POST',{label:'test device',token:t},admin);
    assert.equal(r.status,201); return (await r.json()).id;
  };
  return {db,state,vault,admin,token,request,register};
}
const opaque=(id='op1',parents=[],profile='p1',entity='field1')=>({id,profile,entity,parents,envelope:{v:1,iv:'a'.repeat(16),ct:'a'.repeat(32)}});
const push=(f,ops,t)=>f.request('/api/v1/operations','POST',{operations:ops},t);

test('authentication is required, including profile discovery',async()=>{
  const f=fixture(); assert.equal((await f.request('/api/v1/changes')).status,401);
});
test('missing deployment secret fails closed',async()=>{
  const f=fixture(); f.vault.env={}; assert.equal((await f.request('/api/v1/devices','GET',undefined,f.admin)).status,503);
});
test('device provisioning never returns token hashes',async()=>{
  const f=fixture(); await f.register(); const r=await f.request('/api/v1/devices','GET',undefined,f.admin);
  const body=await r.json(); assert.equal(body.devices.length,1); assert.equal(body.devices[0].token_hash,undefined);
});
test('admin token cannot be reused as a device token',async()=>{
  const f=fixture(); assert.equal((await f.request('/api/v1/devices','POST',{label:'bad',token:f.admin},f.admin)).status,400);
});
test('revoked devices cannot read or write',async()=>{
  const f=fixture(); const id=await f.register(); await f.request(`/api/v1/devices/${id}`,'DELETE',undefined,f.admin);
  assert.equal((await f.request('/api/v1/changes')).status,401); assert.equal((await push(f,[opaque()])).status,401);
});
test('cross-origin requests are rejected',async()=>{
  const f=fixture(); await f.register(); assert.equal((await f.request('/api/v1/changes','GET',undefined,f.token,{Origin:'https://other.test'})).status,403);
});
test('operation retries are idempotent',async()=>{
  const f=fixture(); await f.register(); await push(f,[opaque()]); await push(f,[opaque()]);
  const b=await (await f.request('/api/v1/changes')).json(); assert.equal(b.operations.length,1); assert.equal(b.cursor,1);
});
test('same id with changed contents is rejected',async()=>{
  const f=fixture(); await f.register(); await push(f,[opaque()]);
  assert.equal((await push(f,[opaque('op1',[],'p2')])).status,409);
});
test('duplicate ids across devices are rejected',async()=>{
  const f=fixture(); await f.register(); const token=randomKey(); await f.register(token);
  await push(f,[opaque()]); assert.equal((await push(f,[opaque()],token)).status,409);
});
test('invalid parent rolls back the entire batch',async()=>{
  const f=fixture(); await f.register(); assert.equal((await push(f,[opaque(),opaque('op2',['missing'])])).status,409);
  assert.equal((await (await f.request('/api/v1/changes')).json()).cursor,0);
});
test('parents cannot cross profiles',async()=>{
  const f=fixture(); await f.register(); await push(f,[opaque()]);
  assert.equal((await push(f,[opaque('op2',['op1'],'p2')])).status,409);
});
test('concurrent same-field edits both survive',async()=>{
  const f=fixture(); await f.register(); await push(f,[opaque('a'),opaque('b')]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM heads').get().n,2);
  await push(f,[opaque('c',['a','b'])]); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM heads').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM operations').get().n,3);
});
test('independent settings merge without collisions',async()=>{
  const f=fixture(); await f.register(); await push(f,[opaque('a',[],'p1','theme'),opaque('b',[],'p1','search')]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM heads').get().n,2);
});
test('malformed envelope and self-parent fail validation',async()=>{
  const f=fixture(); await f.register(); const bad=opaque(); bad.envelope.iv='x';
  assert.equal((await push(f,[bad])).status,400); assert.equal((await push(f,[opaque('a',['a'])])).status,400);
});
test('oversized body is rejected',async()=>{
  const f=fixture(); await f.register(); assert.equal((await push(f,[{padding:'x'.repeat(140000)}])).status,413);
});
test('invalid or rewound cursors are rejected',async()=>{
  const f=fixture(); await f.register(); assert.equal((await f.request('/api/v1/changes?after=-1')).status,400);
  assert.equal((await f.request('/api/v1/changes?after=10')).status,409);
});
test('AES-GCM roundtrip, wrong key and context substitution',async()=>{
  const key=await importKey(randomKey()), op={id:'a',profile:'p',entity:'e',parents:[]};
  op.envelope=await seal(key,op,{value:'Private'}); assert.deepEqual(await open(key,op),{value:'Private'});
  await assert.rejects(open(await importKey(randomKey()),op)); await assert.rejects(open(key,{...op,profile:'other'}));
});
test('causal reducer converges under permutations and duplicate delivery',()=>{
  const a=opaque('a'), b=opaque('b'), c=opaque('c',['a','b']);
  for(const operations of [[a,b,c],[c,a,b],[b,c,a,a]]) {
    assert.deepEqual(versions({...emptyState(),operations},'p1','field1').map(x=>x.id),['c']);
  }
});
test('delete/edit conflict remains recoverable',()=>{
  const state={...emptyState(),operations:[opaque('original'),opaque('delete',['original']),opaque('edit',['original'])]};
  assert.equal(versions(state,'p1','field1').length,2);
});
test('client saves offline writes and syncs them after a restart',async()=>{
  const f=fixture(); await f.register(); let store=emptyState(); const key=await importKey(randomKey());
  const config={endpoint:'https://lume.test',token:f.token,key,load:async()=>structuredClone(store),save:async(s)=>{store=structuredClone(s);},fetcher:(url,init)=>f.vault.fetch(new Request(url,init))};
  const c=new SyncClient(config); await c.write('p','theme',{value:'dark'}); assert.equal(store.pending.length,1);
  const resumed=new SyncClient(config); await resumed.sync(); assert.equal(store.pending.length,0);
  assert.deepEqual((await resumed.read('p','theme'))[0].value,{value:'dark'});
});
test('a lost POST response does not lose the operation',async()=>{
  const f=fixture(); await f.register(); let store=emptyState(), once=true; const key=await importKey(randomKey());
  const c=new SyncClient({endpoint:'https://lume.test',token:f.token,key,load:async()=>structuredClone(store),save:async(s)=>{store=structuredClone(s);},
    fetcher:async(url,init)=>{const r=await f.vault.fetch(new Request(url,init)); if(init.method==='POST'&&once){once=false; throw new Error('network');} return r;}});
  await c.write('p','theme',{value:'dark'}); await assert.rejects(c.sync()); assert.equal(store.pending.length,1);
  await c.sync(); assert.equal(store.pending.length,0); assert.equal(store.operations.length,1);
});
test('tampered ciphertext does not advance client cursor',async()=>{
  const f=fixture(); await f.register(); await push(f,[opaque()]); let store=emptyState();
  const c=new SyncClient({endpoint:'https://lume.test',token:f.token,key:await importKey(randomKey()),load:async()=>structuredClone(store),save:async(s)=>{store=structuredClone(s);},fetcher:(url,init)=>f.vault.fetch(new Request(url,init))});
  await assert.rejects(c.sync()); assert.equal(store.cursor,0);
});
