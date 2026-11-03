const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {DiskStore}=require('./disk-store.cjs'),{DiskStore:Legacy}=require('./legacy-disk-store.cjs'),{createStorageStartup}=require('./storage-startup.cjs'),{createHandler}=require('./serve.cjs'),I=require('./integration.js');
async function fixture(t,{invalid=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'circuit-visible-upgrade-'));let server;
 const legacy=new Legacy(dir);await legacy.init();if(invalid)await fs.writeFile(legacy.file,'broken JSON');else await legacy.putDesign(I.prepare(require('../integration/slotforge-timing/fixtures/01-closed-oval.slotforge.json')),null);
 const original=await fs.readFile(legacy.file),store=new DiskStore(dir),startup=createStorageStartup(store),options={store,startup,port:0};
 server=http.createServer(createHandler(path.resolve(__dirname,'..'),options));await new Promise(r=>server.listen(0,'127.0.0.1',r));options.port=server.address().port;const base='http://127.0.0.1:'+options.port;
 const session=await(await fetch(base+'/api/session',{headers:{'X-SlotForge-Client':'1'}})).json();
 const request=async(endpoint,method='GET',body)=>{const response=await fetch(base+'/api/'+endpoint,{method,headers:{'X-SlotForge-Token':session.token,Origin:base,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await startup.close();assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(),'circuit-visible-upgrade-')));await fs.rm(dir,{recursive:true,force:true});});
 return{dir,legacy,original,store,startup,options,session,request};
}
async function finish(startup){for(let i=0;i<100&&['waiting','running'].includes(startup.status().phase);i++)await new Promise(r=>setTimeout(r,20));return startup.status();}
test('Visible migration waits for startup request, blocks editing, runs once and retains originals',async t=>{
 const f=await fixture(t);assert.equal(f.session.startup.phase,'waiting');await assert.rejects(fs.stat(f.store.file),e=>e.code==='ENOENT');assert.equal((await f.request('current')).status,503);assert.equal((await f.request('current','PUT',{data:{}})).status,503);
 const starts=await Promise.all([f.request('storage-startup','POST',{}),f.request('storage-startup','POST',{})]);assert.ok(starts.every(x=>x.status===200));const result=await finish(f.startup);assert.equal(result.phase,'ready');assert.equal(result.result.tracks,1);assert.equal(result.result.migrated,true);assert.equal((await f.request('design-page')).data.total,1);assert.deepEqual(await fs.readFile(f.legacy.file),f.original);assert.equal(createStorageStartup(f.store),null);
 assert.equal((await f.request('storage-startup','POST',{acknowledge:true})).status,200);assert.equal(f.startup.acknowledged,true);
});
test('Failed visible migration keeps JSON, publishes no SQLite and blocks normal APIs',async t=>{
 const f=await fixture(t,{invalid:true});assert.equal((await f.request('storage-startup','POST',{acknowledge:true})).status,400);await f.request('storage-startup','POST',{});const result=await finish(f.startup);assert.equal(result.phase,'error');assert.ok(result.error);assert.equal((await f.request('current')).status,503);await assert.rejects(fs.stat(f.store.file),e=>e.code==='ENOENT');assert.deepEqual(await fs.readFile(f.legacy.file),f.original);
});
test('Stopping a pending visible migration drains conversion before terminating the worker',async t=>{
 const f=await fixture(t);f.startup.start();await f.startup.close();assert.equal(f.startup.status().phase,'ready');assert.equal(f.store.closed,true);assert.equal(f.store.pending.size,0);
});
