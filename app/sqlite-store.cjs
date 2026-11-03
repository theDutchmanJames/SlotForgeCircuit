// Runs only in the storage worker. Geometry stays portable JSON; library queries
// read small indexed summaries instead of reconstructing unrelated designs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),L=require('./legacy-disk-store.cjs'),CP=require('./custom-packs.js'),DL=require('./design-library.js'),I=require('./integration.js');
const FORMAT=1,APP=0x53464349,MAX_DATA=200*1024*1024,MAX_TRACKS=5000;
const uid=()=>crypto.randomUUID(),json=JSON.stringify,parse=JSON.parse;
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function summary(r){return{id:r.id,revision:r.revision,updatedAt:r.updatedAt,title:r.layout.title,designRevision:r.layout.design.revision,pieceCount:r.layout.pieces.length,laneCount:r.layout.track?.laneCount||0};}
function schema(db){db.exec(`PRAGMA application_id=${APP}; PRAGMA user_version=${FORMAT};
 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
 CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',updated TEXT NOT NULL DEFAULT '',summary TEXT,PRIMARY KEY(kind,id)) STRICT;
 CREATE INDEX design_order ON records(kind,updated DESC,id);
 CREATE TABLE previews(id TEXT PRIMARY KEY,revision TEXT NOT NULL,svg TEXT NOT NULL) STRICT;
 CREATE TABLE history(seq INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,changes TEXT NOT NULL) STRICT;
 INSERT INTO meta VALUES('bytes','0');
 CREATE TRIGGER bytes_insert AFTER INSERT ON records BEGIN UPDATE meta SET value=CAST(CAST(value AS INTEGER)+length(CAST(new.json AS BLOB)) AS TEXT) WHERE key='bytes'; END;
 CREATE TRIGGER bytes_update AFTER UPDATE OF json ON records BEGIN UPDATE meta SET value=CAST(CAST(value AS INTEGER)+length(CAST(new.json AS BLOB))-length(CAST(old.json AS BLOB)) AS TEXT) WHERE key='bytes'; END;
 CREATE TRIGGER bytes_delete AFTER DELETE ON records BEGIN UPDATE meta SET value=CAST(CAST(value AS INTEGER)-length(CAST(old.json AS BLOB)) AS TEXT) WHERE key='bytes'; END;`);}
function connect(file){if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())fail('SQLite file is not a regular file. Original retained.',500);const db=new DatabaseSync(file);try{db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');if(db.prepare('PRAGMA application_id').get().application_id!==APP||db.prepare('PRAGMA user_version').get().user_version!==FORMAT)fail('Unsupported or damaged Circuit database. Original retained.',500);const head=db.prepare("SELECT value FROM meta WHERE key='workspace'").get();if(!head)fail('Incomplete Circuit database. Original retained.',500);const value=parse(head.value);if(value.format!=='slotforge.disk-workspace'||value.version!==1||typeof value.revision!=='string')fail('Invalid workspace metadata. Original retained.',500);const count=meta(db,'bytes');if(!Number.isSafeInteger(count)||count<0)fail('Invalid workspace size metadata. Original retained.',500);return db;}catch(e){db.close();throw e;}}
function record(db,kind,id=''){const row=db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id);return row?parse(row.json):null;}
function meta(db,key){const row=db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?parse(row.value):null;}
function setMeta(db,key,value){db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json(value));}
function write(db,kind,id,value,changes){const old=db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id)?.json??null,text=value===null?null:json(value);if(old===text)return false;if(changes)changes.push({kind,id,before:old});if(text===null)db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);else{const s=kind==='design'?summary(value):null;db.prepare('INSERT INTO records(kind,id,json,title,updated,summary) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,title=excluded.title,updated=excluded.updated,summary=excluded.summary').run(kind,id,text,s?.title.toLowerCase()||'',s?.updatedAt||'',s?json(s):null);}if(kind==='design')db.prepare('DELETE FROM previews WHERE id=?').run(id);return true;}
function assemblePacks(get){const head=get('packs');if(!head)return null;const {order,...rest}=head;return{...rest,data:{...head.data,packs:order.map(id=>{const p=get('pack',id);if(!p)fail('Missing track pack. Original retained.',500);const {pieceOrder,...body}=p;return{...body,pieces:pieceOrder.map(key=>{const piece=get('piece',key);if(!piece)fail('Missing custom piece. Original retained.',500);return piece;})};})}};}
function getPacks(db){return assemblePacks((kind,id='')=>record(db,kind,id));}
function writePacks(db,r,changes){const keep={pack:new Set(),piece:new Set()};if(r){for(const p of r.data.packs){keep.pack.add(p.id);const {pieces,...body}=p;write(db,'pack',p.id,{...body,pieceOrder:pieces.map(d=>d.id)},changes);for(const d of pieces){keep.piece.add(d.id);write(db,'piece',d.id,d,changes);}}const {packs,...data}=r.data;write(db,'packs','',{...r,data,order:packs.map(p=>p.id)},changes);}else write(db,'packs','',null,changes);for(const kind of ['pack','piece'])for(const row of db.prepare('SELECT id FROM records WHERE kind=?').all(kind))if(!keep[kind].has(row.id))write(db,kind,row.id,null,changes);}
function read(db){return{...meta(db,'workspace'),current:record(db,'current'),packs:getPacks(db),designs:db.prepare("SELECT json FROM records WHERE kind='design' ORDER BY rowid").all().map(r=>parse(r.json)),trash:record(db,'trash')||[]};}
function seed(db,state){const {current,packs,designs,trash,...head}=state;setMeta(db,'workspace',head);write(db,'current','',current);writePacks(db,packs);for(const r of designs)write(db,'design',r.id,r);write(db,'trash','',trash);}
function same(a,b){return I.canonical(a)===I.canonical(b);}
const legacyChecks=new Map();
function legacyStamp(directory){const file=path.join(directory,'workspace.json');if(!fs.existsSync(file))return null;const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>L.MAX)fail('The preserved JSON workspace is invalid. Original retained.',500);return{size:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,ino:s.ino};}
function legacyDigest(directory){return crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,'workspace.json'))).digest('hex');}
function ensureLegacyDigest(db,directory){
 if(db.prepare("SELECT 1 FROM meta WHERE key='legacyDigest'").get())return;
 // Compatibility with the first, unreleased SQLite implementation: only bless
 // an original file whose old stamp still matches. Never approve changed data.
 const old=meta(db,'legacyStamp'),now=legacyStamp(directory);
 if(old&&(!now||old.size!==now.size||old.mtime!==now.mtime))fail('The preserved JSON needs verification before this database can be upgraded. Original retained.',500);
 if(!old&&now)fail('An older Circuit copy created a JSON workspace. Keep both copies for recovery.',409);
 setMeta(db,'legacyDigest',now?legacyDigest(directory):null);
}
function guardLegacy(db,directory){
 const expected=meta(db,'legacyDigest'),stamp=legacyStamp(directory);
 // SQLite is self-contained. Removing an old recovery copy does not erase or
 // invalidate the live data; a new/changed JSON copy still needs investigation.
 if(!stamp){legacyChecks.delete(directory);return;}
 const cached=legacyChecks.get(directory);if(cached?.digest===expected&&same(cached.stamp,stamp))return;
 if(!expected||legacyDigest(directory)!==expected)fail('The preserved JSON workspace changed after migration, possibly from an older Circuit copy. Stop both copies and keep the data folder for recovery. SQLite was not overwritten.',409);
 legacyChecks.set(directory,{stamp,digest:expected});while(legacyChecks.size>16)legacyChecks.delete(legacyChecks.keys().next().value);
}

async function init(directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.lstatSync(directory).isSymbolicLink())fail('The data directory must not be a symbolic link.',500);
 const file=path.join(directory,'workspace.sqlite'),marker=path.join(directory,'sqlite-storage.json'),legacy=new L.DiskStore(directory),release=await legacy.lock();
 try{
  if(fs.existsSync(file)){const db=connect(file);try{db.exec('BEGIN IMMEDIATE');ensureLegacyDigest(db,directory);guardLegacy(db,directory);db.exec('COMMIT');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')fail('SQLite integrity check failed. Original retained.',500);}finally{db.close();}}
  else{
   if(fs.existsSync(marker))fail('The SQLite workspace is missing. Restore a backup; the older JSON was not reopened.',500);
   const sourceDigest=legacyStamp(directory)?legacyDigest(directory):null;
   const state=await legacy.read(); // validates every legacy layout and pack before publication
   const temp=path.join(directory,'.sqlite-migration-'+uid()+'.tmp');let db;
   try{db=new DatabaseSync(temp);fs.chmodSync(temp,0o600);db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');schema(db);seed(db,state);setMeta(db,'legacyStamp',legacyStamp(directory));setMeta(db,'legacyDigest',sourceDigest);if(!same(read(db),state))fail('Migration verification failed. Original JSON retained.',500);db.exec('COMMIT');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('Migration integrity check failed.',500);db.close();db=null;
    const verified=connect(temp);try{if(!same(read(verified),state))fail('Committed migration verification failed. Original JSON retained.',500);}finally{verified.close();}
    if(sourceDigest!==(legacyStamp(directory)?legacyDigest(directory):null))fail('The JSON workspace changed during migration. Original retained; retry after stopping other copies.',409);
    // Exclusive publication: never replace another process's database.
    fs.linkSync(temp,file);fs.unlinkSync(temp);try{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch{}
   }finally{if(db)db.close();if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  fs.writeFileSync(marker,json({format:'slotforge.sqlite-storage',version:FORMAT})+'\n',{mode:0o600});
  fs.writeFileSync(path.join(directory,'ABOUT-YOUR-DATA.txt'),'SlotForge Circuit data\nworkspace.sqlite is the active database. Stop Circuit before copying the data folder.\nUse Storage > Download workspace backup for a portable JSON backup while running.\nThe database keeps the last 20 changed-record transactions for recovery.\nworkspace.json and backups/ are unchanged migration-time recovery copies, NOT current backups.\nDo not delete SQLite or run an older app against this folder to roll back.\n',{mode:0o600});
 }finally{await release();}
}
function check(r,expected){if((r?.revision||null)!==(expected??null))fail('This file changed in another window. Reload before saving, or export your current work as JSON.',409);}
function trimTrash(db,changes){
 const bytes=Number(meta(db,'bytes'));if(bytes<=MAX_DATA)return;
 const old=record(db,'trash')||[];let count=0,freed=0;
 while(count<old.length&&bytes-freed>MAX_DATA){freed+=Buffer.byteLength(json(old[count]))+(old.length-count>1?1:0);count++;}
 if(count)write(db,'trash','',old.slice(count),changes);
}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const changes=[],before=meta(db,'workspace'),value=fn(changes);if(changes.length){trimTrash(db,changes);if(Number(meta(db,'bytes'))>MAX_DATA)fail('The workspace exceeds 200 MiB. Export or remove unused library entries.');setMeta(db,'workspace',{...before,revision:uid()});db.prepare('INSERT INTO history(created,changes) VALUES(?,?)').run(new Date().toISOString(),json({workspace:before,rows:changes}));db.exec('DELETE FROM history WHERE seq NOT IN (SELECT seq FROM history ORDER BY seq DESC LIMIT 20)');while(db.prepare('SELECT coalesce(sum(length(CAST(changes AS BLOB))),0) AS size FROM history').get().size>50*1024*1024)db.exec('DELETE FROM history WHERE seq=(SELECT min(seq) FROM history)');}db.exec('COMMIT');return value;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}}
function transfer(s){if(s.current)L.cleanLayout(s.current.data);if(s.packs)CP.read(s.packs.data);for(const r of s.designs)L.cleanLayout(r.layout);return{format:'slotforge.workspace-transfer',version:1,createdAt:new Date().toISOString(),current:s.current?.data||null,customLibrary:s.packs?.data||CP.serialize(CP.empty()),designs:s.designs.map(r=>r.layout)};}
function options(o={}){const offset=Number(o.offset??0),limit=Number(o.limit??24),query=String(o.query??'');if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100||query.length>100)fail('Invalid library page.');return{offset,limit,query};}
async function run(directory,method,args){if(method==='init'){await init(directory);return true;}const db=connect(path.join(directory,'workspace.sqlite')),reading=['read','current','packs','list','summaries','page','get','exportBundle','previousBundle','history'].includes(method);try{
 if(reading)db.exec('BEGIN');
 guardLegacy(db,directory);
 if(method==='read')return read(db);
 if(method==='current'){const r=record(db,'current');if(r){L.cleanLayout(r.data);DL.validateSource(r.librarySource,r.data.design.id);}return r;}
 if(method==='packs'){const r=getPacks(db);if(r)CP.read(r.data);return r;}
 if(method==='list')return db.prepare("SELECT json FROM records WHERE kind='design' ORDER BY updated DESC,id").all().map(r=>parse(r.json));
 if(method==='summaries')return db.prepare("SELECT summary FROM records WHERE kind='design' ORDER BY updated DESC,id").all().map(r=>parse(r.summary));
 if(method==='page'){const {offset,limit,query}=options(args[0]),match='%'+query.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%',where="kind='design' AND title LIKE ? ESCAPE '\\'";return{items:db.prepare('SELECT summary FROM records WHERE '+where+' ORDER BY updated DESC,id LIMIT ? OFFSET ?').all(match,limit,offset).map(r=>parse(r.summary)),total:db.prepare('SELECT count(*) AS n FROM records WHERE '+where).get(match).n,offset,limit};}
 if(method==='get'||method==='preview'){const r=record(db,'design',args[0]);if(!r)fail('This track is no longer in the library.',404);if(method==='get'){L.cleanLayout(r.layout);return r;}const cached=db.prepare('SELECT svg FROM previews WHERE id=? AND revision=?').get(r.id,r.revision);if(cached)return{svg:cached.svg,revision:r.revision};const clean=L.cleanLayout(r.layout),svg=clean.pieces.length?I.picture(clean,{maxDimension:600}).svg:'';if(Buffer.byteLength(svg)<=2*1024*1024){db.prepare('INSERT INTO previews VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,svg=excluded.svg').run(r.id,r.revision,svg);db.exec('DELETE FROM previews WHERE rowid NOT IN (SELECT rowid FROM previews ORDER BY rowid DESC LIMIT 128)');while(db.prepare('SELECT coalesce(sum(length(CAST(svg AS BLOB))),0) n FROM previews').get().n>32*1024*1024)db.exec('DELETE FROM previews WHERE rowid=(SELECT min(rowid) FROM previews)');}return{svg,revision:r.revision};}
 if(method==='exportBundle')return transfer(read(db));
 if(method==='previousBundle'){
  const h=db.prepare('SELECT changes FROM history ORDER BY seq DESC LIMIT 1').get();if(!h)fail('No previous save is available.');
  const change=parse(h.changes),rows=new Map(db.prepare('SELECT kind,id,json FROM records ORDER BY rowid').all().map(r=>[json([r.kind,r.id]),r.json]));
  for(const row of [...change.rows].reverse()){const key=json([row.kind,row.id]);if(row.before===null)rows.delete(key);else rows.set(key,row.before);}
  const get=(kind,id='')=>{const value=rows.get(json([kind,id]));return value===undefined?null:parse(value);};
  return transfer({...change.workspace,current:get('current'),packs:assemblePacks(get),designs:[...rows].filter(([key])=>parse(key)[0]==='design').map(([,value])=>parse(value)),trash:get('trash')||[]});
 }
 if(method==='history')return db.prepare('SELECT seq,created FROM history ORDER BY seq DESC').all();
 if(method==='putCurrent'){const data=L.cleanLayout(args[0]),source=DL.validateSource(args[2],data.design.id);return transaction(db,c=>{const old=record(db,'current');if(old&&same(old.data,data)&&same(old.librarySource||null,source))return old;check(old,args[1]);const r={revision:uid(),updatedAt:new Date().toISOString(),data,...(source?{librarySource:source}:{})};write(db,'current','',r,c);return r;});}
 if(method==='putPacks'){const data=CP.serialize(CP.read(args[0]));return transaction(db,c=>{const old=getPacks(db);if(old&&same(old.data,data))return old;check(old,args[1]);const r={revision:uid(),updatedAt:new Date().toISOString(),data};writePacks(db,r,c);return r;});}
 if(method==='putDesign'){const layout=L.cleanLayout(args[0]),id=layout.design.id;return transaction(db,c=>{const old=record(db,'design',id);check(old,args[1]);if(!old&&db.prepare("SELECT count(*) n FROM records WHERE kind='design'").get().n>=MAX_TRACKS)fail('The Track Library supports 5,000 saved tracks.');const r={id,revision:uid(),updatedAt:new Date().toISOString(),layout};write(db,'design',id,r,c);return r;});}
 if(method==='remove')return transaction(db,c=>{const r=record(db,'design',args[0]);if(!r)fail('This track is no longer in the library.',404);check(r,args[1]);write(db,'trash','',[...(record(db,'trash')||[]),{...r,deletedAt:new Date().toISOString()}].slice(-20),c);write(db,'design',r.id,null,c);return{removed:true};});
 if(method==='importBundle'){
  const raw=args[0];if(raw?.format!=='slotforge.workspace-transfer'||raw.version!==1||!Array.isArray(raw.designs)||raw.designs.length>MAX_TRACKS)fail('Choose a SlotForge workspace-transfer JSON file.');const layouts=raw.designs.map(L.cleanLayout),current=raw.current?L.cleanLayout(raw.current):null,packs=CP.read(raw.customLibrary);
  return transaction(db,c=>{let added=0,skipped=0,packCount=0;const existing=db.prepare("SELECT json FROM records WHERE kind='design'").all().map(r=>parse(r.json)),signatures=new Set(existing.map(r=>r.importSignature||L.layoutSignature(r.layout))),ids=new Set(existing.map(r=>r.id));for(const layout of [...layouts,...(current?[current]:[])]){const signature=L.layoutSignature(layout);if(signatures.has(signature)){skipped++;continue;}if(ids.size>=MAX_TRACKS)fail('Import would exceed 5,000 saved tracks. No changes were written.');const value=ids.has(layout.design.id)?DL.prepare(layout,layout.title.slice(0,89)+' (imported)',true):layout;write(db,'design',value.design.id,{id:value.design.id,revision:uid(),updatedAt:new Date().toISOString(),layout:value,importSignature:signature},c);ids.add(value.design.id);signatures.add(signature);added++;}const target=CP.read(getPacks(db)?.data);for(const p of packs.packs){const pack=CP.exportPack(p);if(target.packs.some(t=>L.packSignature(CP.exportPack(t))===L.packSignature(pack)))continue;target.packs.push({...CP.importPack(pack,target),inLibrary:p.inLibrary});packCount++;}if(packCount)writePacks(db,{revision:uid(),updatedAt:new Date().toISOString(),data:CP.serialize(target)},c);return{tracksAdded:added,tracksSkipped:skipped,packsAdded:packCount};});
 }
 fail('Unknown storage operation.');
 }catch(e){if(e.code?.startsWith('ERR_SQLITE')||/database.*(malformed|encrypted)|not a database/i.test(e.message))fail('Cannot read or write the SQLite workspace. Original retained; restore a verified backup. '+e.message,500);throw e;}finally{if(reading)try{db.exec('ROLLBACK');}catch{}db.close();}}
module.exports={run,MAX_DATA,MAX_TRACKS};
