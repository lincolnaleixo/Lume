// SPDX-License-Identifier: MPL-2.0
import { SyncClient, importKey, emptyState, entities } from './core.mjs';
const $=id=>document.getElementById(id);
const database=new Promise((resolve,reject)=>{
  const r=indexedDB.open('lume-private-v1',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('private');
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});
async function storage(mode,key,value){
  const db=await database;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('private',mode==='get'?'readonly':'readwrite');
    const store=tx.objectStore('private');
    const r=mode==='get'?store.get(key):mode==='delete'?store.delete(key):store.put(value,key);
    let result;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage aborted'));
  });
}
let client,credentials,active=null,profiles=[],busy=false;
const status=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'error':'';};
const element=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const button=(text,action)=>{const el=element('button',text);el.type='button';el.onclick=()=>guard(action);return el;};
async function guard(action){try{await action();}catch(e){status(e.message||'Não foi possível completar esta ação.',true);}}
async function exclusive(action){
  if(!navigator.locks)throw new Error('Este console precisa de Web Locks para evitar perda de dados entre abas. Use um navegador atualizado.');
  return navigator.locks.request('lume-vault-write-v1',action);
}
async function connect(saved){
  if(saved.endpoint!==location.origin)throw new Error('Abra o console no endereço da instalação que gerou este pareamento.');
  credentials=saved;
  client=new SyncClient({...saved,load:()=>storage('get','state'),save:s=>storage('put','state',s)});
  $('pair').hidden=true;$('dashboard').hidden=false;
  for(const id of ['sync','export','forget'])$(id).hidden=false;
  await render();await synchronize();
}
async function synchronize(){
  if(!client||busy)return;busy=true;$('sync').disabled=true;
  try{
    await exclusive(()=>client.sync());
    status(`Sincronizado às ${new Date().toLocaleTimeString()}.`);await render();
  }catch(e){
    const state=await storage('get','state')||emptyState();
    status(`${e.message}. ${state.pending.length} alteração(ões) permanecem salvas neste dispositivo.`,true);
  }finally{busy=false;$('sync').disabled=false;}
}
async function write(profile,entity,value){
  await exclusive(()=>client.write(profile,entity,value));
  status('Salvo localmente.');await render();await synchronize();
}
async function render(){
  const state=await storage('get','state')||emptyState();profiles=[];
  for(const id of entities(state,'catalog')){
    const versions=await client.read('catalog',id);
    const visible=versions.find(v=>!v.value.deleted);
    if(visible)profiles.push({id,name:String(visible.value.name||'Sem nome'),versions});
  }
  profiles.sort((a,b)=>a.name.localeCompare(b.name));
  const grid=$('profiles');grid.replaceChildren();
  const query=$('search').value.normalize('NFKC').toLocaleLowerCase();
  for(const profile of profiles.filter(p=>p.name.normalize('NFKC').toLocaleLowerCase().includes(query))){
    const card=element('article',undefined,'card');
    card.append(element('div',profile.name.slice(0,1).toLocaleUpperCase(),'avatar'),element('h2',profile.name));
    card.append(element('p',profile.versions.length>1?`${profile.versions.length} versões preservadas`:'Perfil no seu cofre','muted'));
    card.append(button('Preferências',async()=>{active=profile.id;await renderEditor();$('editor').scrollIntoView({behavior:'smooth',block:'start'});}));
    if(profile.versions.length>1){
      const box=element('div',undefined,'conflict');box.append(element('p','Alterações concorrentes no perfil. Escolha a versão para resolver:'));
      for(const v of profile.versions)box.append(button(v.value.deleted?'Arquivado':String(v.value.name),()=>write('catalog',profile.id,v.value)));
      card.append(box);
    }
    grid.append(card);
  }
  if(!profiles.length)grid.append(element('p','Crie seu primeiro perfil acima.','muted'));
  await renderEditor();
}
async function renderEditor(){
  const profile=profiles.find(p=>p.id===active);$('editor').hidden=!profile;if(!profile)return;
  $('profile-title').textContent=profile.name;$('settings').replaceChildren();
  const state=await storage('get','state')||emptyState();
  for(const key of entities(state,profile.id)){
    const values=await client.read(profile.id,key);
    const row=element('div',undefined,values.length>1?'setting conflict':'setting');
    row.append(element('strong',key));
    if(values.length>1)row.append(element('p','Edições simultâneas. Nenhuma versão foi descartada.'));
    for(const v of values){
      row.append(element('pre',JSON.stringify(v.value,null,2)));
      if(values.length>1)row.append(button('Usar esta versão',()=>write(profile.id,key,v.value)));
    }
    $('settings').append(row);
  }
}
$('pair-file').onchange=()=>guard(async()=>{
  const file=$('pair-file').files[0];if(!file)return;if(file.size>8192)throw new Error('Arquivo de pareamento inválido.');
  const config=JSON.parse(await file.text());
  if(config.v!==1||config.endpoint!==location.origin||typeof config.deviceId!=='string')throw new Error('Pareamento de outra instalação. Abra o endereço correto.');
  const key=await importKey(config.vaultKey);
  const saved={endpoint:config.endpoint,token:config.token,deviceId:config.deviceId,key};
  // Validate before persisting. The raw vault key is never stored in IndexedDB.
  new SyncClient({...saved,load:async()=>emptyState(),save:async()=>{}});
  await storage('put','credentials',saved);await navigator.storage?.persist?.();
  $('pair-file').value='';await connect(saved);
});
$('create').onsubmit=e=>{e.preventDefault();guard(async()=>{
  const name=$('name').value.trim().normalize('NFKC');if(!name||name.length>60)throw new Error('Escolha um nome de até 60 caracteres.');
  if(profiles.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('Já existe um perfil com esse nome.');
  const id=crypto.randomUUID();await write('catalog',id,{name,deleted:false});$('name').value='';active=id;await render();
});};
$('preference').onsubmit=e=>{e.preventDefault();guard(async()=>{if(!active)return;await write(active,$('pref-key').value,{value:$('pref-value').value});$('pref-value').value='';});};
$('delete-profile').onclick=()=>guard(async()=>{
  const p=profiles.find(p=>p.id===active);if(p&&confirm(`Arquivar o perfil ${p.name}? O histórico cifrado será preservado.`)){await write('catalog',p.id,{name:p.name,deleted:true});active=null;await render();}
});
$('search').oninput=()=>guard(render);$('sync').onclick=synchronize;
$('export').onclick=()=>guard(async()=>{
  const state=await storage('get','state')||emptyState();
  const blob=new Blob([JSON.stringify({format:'lume-encrypted-log-v1',endpoint:credentials.endpoint,state})],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=`vault-backup-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  status('Backup cifrado exportado. A chave de recuperação precisa ser guardada separadamente.');
});
$('forget').onclick=()=>guard(async()=>{
  const state=await storage('get','state')||emptyState();
  if(state.pending.length)throw new Error('Sincronize ou exporte as alterações pendentes antes de desconectar.');
  if(!confirm('Apagar o pareamento e o cache deste navegador? Isso não revoga o dispositivo no servidor.'))return;
  await exclusive(async()=>{await storage('delete','credentials');await storage('delete','state');});location.reload();
});
window.addEventListener('online',synchronize);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)synchronize();});
setInterval(()=>{if(!document.hidden)synchronize();},20000);
guard(async()=>{const saved=await storage('get','credentials');if(saved)await connect(saved);});
