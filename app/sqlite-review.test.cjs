const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{DatabaseSync}=require('node:sqlite');
const {DiskStore}=require('./disk-store.cjs'),Legacy=require('./legacy-disk-store.cjs').DiskStore,I=require('./integration.js'),DL=require('./design-library.js');
const {spawnSync}=require('node:child_process');
const raw=()=>I.prepare(require('../integration/slotforge-timing/fixtures/01-closed-oval.slotforge.json'));
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'circuit-sqlite-review-')),stores=[];t.after(async()=>{for(const s of stores)await s.close();assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'circuit-sqlite-review-')));await fs.rm(root,{recursive:true,force:true});});return{root,open:async(name='data')=>{const s=new DiskStore(path.join(root,name));stores.push(s);await s.init();return s;}};}
test('A library summary supplies the same safe editor baseline as a full design',async t=>{const {open}=await setup(t),s=await open(),saved=await s.putDesign(raw(),null),summary=(await s.summaries())[0];assert.deepEqual(DL.source(summary),DL.source(saved));});
test('Copied migration recovery JSON with different timestamps does not lock a valid SQLite workspace',async t=>{
 const {root,open}=await setup(t),old=await new Legacy(path.join(root,'data')).init(),r=await old.putCurrent(raw(),null),s=await open();await s.putCurrent({...raw(),title:'Latest SQLite work'},r.revision);await s.close();await fs.cp(path.join(root,'data'),path.join(root,'copy'),{recursive:true});const oldDate=new Date(2020,0,1);await fs.utimes(path.join(root,'copy','workspace.json'),oldDate,oldDate);const copy=await open('copy');assert.equal((await copy.current()).data.title,'Latest SQLite work');
});
test('Legacy JSON appearing after a new SQLite workspace is detected before a save',async t=>{
 const {root,open}=await setup(t),s=await open(),saved=await s.putCurrent(raw(),null);await fs.writeFile(path.join(root,'data','workspace.json'),JSON.stringify({title:'An older app wrote here'}));await assert.rejects(s.putCurrent({...raw(),title:'Unsafe parallel save'},saved.revision),/older|JSON/i);
});
test('Deleting near the quota frees space instead of being blocked by the trash snapshot',async t=>{
 const {open}=await setup(t),s=await open(),saved=await s.putDesign(raw(),null),db=new DatabaseSync(s.file);db.prepare("UPDATE meta SET value=? WHERE key='bytes'").run(String(200*1024*1024));db.close();await s.remove(saved.id,saved.revision);assert.equal((await s.page()).total,0);assert.equal((await s.previousBundle()).designs[0].title,saved.layout.title);
});
test('Closing storage rejects new work and drains work already submitted',async t=>{
 const {open}=await setup(t),s=await open(),pending=s.putCurrent(raw(),null),closing=s.close();await assert.rejects(s.current(),/clos/i);await pending;await closing;assert.equal(s.pending.size,0);
});
test('Previous-save export works with SQLite writes forbidden and leaves current data unchanged',async t=>{
 const {open}=await setup(t),s=await open(),first=await s.putCurrent(raw(),null);await s.putCurrent({...raw(),title:'New current'},first.revision);
 const script="const sqlite=require('node:sqlite'),Base=sqlite.DatabaseSync;sqlite.DatabaseSync=class extends Base{constructor(...args){super(...args);this.exec('PRAGMA query_only=ON');}};require(process.argv[1]).run(process.argv[2],'previousBundle',[]).then(x=>console.log(JSON.stringify(x)),e=>{console.error(e.message);process.exitCode=1});";
 const result=spawnSync(process.execPath,['-e',script,path.join(__dirname,'sqlite-store.cjs'),s.directory],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).current.title,first.data.title);assert.equal((await s.current()).data.title,'New current');
});
test('Changing source JSON during migration cannot publish a stale snapshot as current',async t=>{
 const {root,open}=await setup(t),dir=path.join(root,'data'),old=await new Legacy(dir).init();await old.putCurrent(raw(),null);
 const script="const fs=require('node:fs'),L=require(process.argv[1]),read=L.DiskStore.prototype.read;L.DiskStore.prototype.read=async function(){const state=await read.call(this);fs.writeFileSync(this.file,JSON.stringify({...state,revision:'changed-while-migrating'}));return state;};require(process.argv[2]).run(process.argv[3],'init',[]).then(()=>process.exit(2),e=>{console.log(e.message);process.exit(7)});";
 const result=spawnSync(process.execPath,['-e',script,path.join(__dirname,'legacy-disk-store.cjs'),path.join(__dirname,'sqlite-store.cjs'),dir],{encoding:'utf8'});assert.equal(result.status,7);assert.match(result.stdout,/changed during migration/);await assert.rejects(fs.stat(path.join(dir,'workspace.sqlite')),e=>e.code==='ENOENT');assert.equal((await(await open()).read()).revision,'changed-while-migrating');
});
test('Missing quota metadata fails closed instead of allowing unbounded saves',async t=>{
 const {open}=await setup(t),s=await open(),db=new DatabaseSync(s.file);db.exec("DELETE FROM meta WHERE key='bytes'");db.close();await assert.rejects(s.putCurrent(raw(),null),/size metadata/);await assert.rejects(open(),/size metadata/);
});
test('SQLite stays usable without an optional migration-time JSON recovery copy',async t=>{
 const {root,open}=await setup(t),old=await new Legacy(path.join(root,'data')).init();await old.putCurrent(raw(),null);const s=await open();await fs.unlink(old.file);assert.equal((await s.current()).data.title,raw().title);assert.equal((await(await open()).current()).data.title,raw().title);
});
