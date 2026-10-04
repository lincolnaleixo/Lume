#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { randomKey } from '../web/core.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), local=join(root,'.local');
const wrangler='wrangler@4.147.0';
const configPath=join(local,'wrangler.json');
const command=process.argv[2] || 'help';
const cli=createInterface({input:process.stdin,output:process.stdout});
const ask=async(q, fallback='')=>(await cli.question(`${q}${fallback?` [${fallback}]`:''}: `)).trim()||fallback;
async function exists(p){try{await access(p);return true;}catch{return false;}}
async function save(name,data){const p=join(local,name);await writeFile(p,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await chmod(p,0o600);return p;}
function run(args,input){
  const r=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--yes',wrangler,...args],{
    cwd:root,stdio:input===undefined?'inherit':['pipe','inherit','inherit'],input,env:process.env
  });
  if(r.error)throw r.error;if(r.status!==0)throw new Error(`Wrangler exited ${r.status}`);
}
const recovery=async()=>JSON.parse(await readFile(join(local,'owner-recovery.json'),'utf8'));
async function api(owner,path,method='GET',body){
  const r=await fetch(owner.endpoint+path,{method,headers:{Authorization:`Bearer ${owner.adminToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data;
}
try{
  await mkdir(local,{recursive:true,mode:0o700});await chmod(local,0o700);
  if(command==='init'){
    if(await exists(join(local,'owner-recovery.json')))throw new Error('Already initialized. Keep the existing recovery file; do not regenerate the vault key.');
    const name=await ask('Unique Worker name in YOUR Cloudflare account','lume-sync');
    if(!/^[a-z][a-z0-9-]{2,50}$/.test(name))throw new Error('Use 3-51 lowercase letters, digits and hyphens.');
    const config=JSON.parse(await readFile(join(root,'wrangler.json'),'utf8'));
    delete config.$schema;config.name=name;config.main='../worker/index.mjs';config.assets.directory='../web';
    const account=await ask('Cloudflare account ID (optional; Wrangler can select it)');
    if(account){if(!/^[a-f0-9]{32}$/i.test(account))throw new Error('Invalid Cloudflare account ID');config.account_id=account;}
    await save('wrangler.json',config);
    await save('owner-recovery.json',{v:1,name,adminToken:randomKey(),vaultKey:randomKey(),endpoint:null});
    console.log('Created .local/owner-recovery.json. Back it up securely. It is NOT safe to publish.');
    console.log('Next: npm run setup -- deploy');
  }else if(command==='deploy'){
    const owner=await recovery();
    run(['login']);run(['deploy','--config',configPath]);
    // The Worker denies device provisioning until this secret is set.
    run(['secret','put','LUME_ADMIN_TOKEN','--config',configPath],owner.adminToken+'\n');
    const endpoint=await ask('Worker HTTPS origin printed by Wrangler',owner.endpoint||'');
    const url=new URL(endpoint);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Enter only the HTTPS origin');
    owner.endpoint=url.origin;
    await writeFile(join(local,'owner-recovery.json'),JSON.stringify(owner,null,2)+'\n',{mode:0o600});
    console.log('Deployed to your account. Next: npm run setup -- pair');
  }else if(command==='pair'){
    const owner=await recovery();if(!owner.endpoint)throw new Error('Deploy first.');
    const label=await ask('Device name','My device');const token=randomKey();
    const {id}=await api(owner,'/api/v1/devices','POST',{label,token});
    const path=await save(`pairing-${id}.json`,{v:1,endpoint:owner.endpoint,deviceId:id,token,vaultKey:owner.vaultKey});
    console.log(`Pairing file: ${path}\nOpen ${owner.endpoint} on this device and import the file once.`);
    console.log('Transfer privately, then delete transfer copies. Never attach it to an issue or commit it.');
  }else if(command==='devices'){
    const owner=await recovery();console.table((await api(owner,'/api/v1/devices')).devices);
  }else if(command==='revoke'){
    const owner=await recovery(),id=process.argv[3];if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id||''))throw new Error('Supply device ID from the devices command');
    await api(owner,`/api/v1/devices/${id}`,'DELETE');console.log('Device API access revoked. This cannot erase data it already downloaded.');
  }else if(command==='dev'){
    const owner=await recovery();
    await writeFile(join(local,'.dev.vars'),`LUME_ADMIN_TOKEN=${owner.adminToken}\n`,{mode:0o600});
    run(['dev','--config',configPath]);
  }else console.log('Commands: init, deploy, pair, devices, revoke DEVICE_ID, dev. No Cloudflare credentials are committed.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{cli.close();}
