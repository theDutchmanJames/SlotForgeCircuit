const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
const oneLine=name=>source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]+','m'))[0];
function node(){return{value:'',textContent:'',disabled:false,reset(){},close(){},querySelectorAll(){return[];}};}
function nodes(){const all=new Map();return id=>{if(!all.has(id))all.set(id,node());return all.get(id);};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function exportContext(request){
 const buttons=[{hasAttribute:()=>false},{hasAttribute:()=>true}],messages=[],downloads=[],get=nodes();
 const context={exportChoice:'saved:a',exportSourceGeneration:1,exportTrackAvailable:true,exportCadAvailable:true,document:{querySelectorAll:()=>buttons},$:get,XM:{resolveSource:()=>request},DL:{get(){}},layout(){},say:(...args)=>messages.push(args),downloadTrack:raw=>downloads.push(raw)};
 context.showExportTrack=model=>{context.exportTrackAvailable=!!model.pieces.length;};
 const a=source.indexOf('async function exportSelectedTrack('),b=source.indexOf('\nfunction routeSection()',a);
 vm.runInNewContext(oneLine('exportButtons')+'\n'+source.slice(a,b),context);
 return{context,buttons,messages,downloads,get};
}

test('Deleting a selected library track keeps export disabled after a failed download',async()=>{
 const t=exportContext(Promise.reject(Error('Saved track is unavailable')));
 await t.context.exportSelectedTrack('slotforge');assert.ok(t.buttons.every(b=>b.disabled));assert.equal(t.downloads.length,0);assert.match(t.get('export-source-error').textContent,/unavailable/);
});
test('An empty track cannot become exportable when an export action finishes',async()=>{
 const t=exportContext(Promise.resolve({pieces:[],layout:{}}));await t.context.exportSelectedTrack('slotforge');assert.ok(t.buttons.every(b=>b.disabled));assert.equal(t.downloads.length,0);
});
test('A delayed download cannot act on a newer selection even after selecting the same track again',async()=>{
 const pending=deferred(),t=exportContext(pending.promise),done=t.context.exportSelectedTrack('slotforge');
 t.context.exportChoice='saved:b';t.context.exportSourceGeneration=2;t.context.exportChoice='saved:a';t.context.exportSourceGeneration=3;t.buttons.forEach(b=>b.disabled=true);
 pending.resolve({pieces:[{}],layout:{title:'Stale snapshot'}});await done;
 assert.equal(t.downloads.length,0);assert.ok(t.buttons.every(b=>b.disabled));assert.equal(t.messages.length,0);
});
test('Stale export failures do not overwrite the newer selection status',async()=>{
 const pending=deferred(),t=exportContext(pending.promise),done=t.context.exportSelectedTrack('slotforge');
 t.context.exportSourceGeneration++;t.get('export-source-error').textContent='New selection status';pending.reject(Error('Old request failed'));await done;
 assert.equal(t.get('export-source-error').textContent,'New selection status');assert.equal(t.messages.length,0);
});
test('Pack download refuses a file larger than the import byte limit',()=>{
 const downloads=[],messages=[],pack={id:'custom',name:'Artwork pack'},out={pieces:[{referenceImage:'€'.repeat(1800000)}]};
 const context={allPacks:()=>[pack],CP:{exportPack:()=>out},TextEncoder,download:(...args)=>downloads.push(args),say:(...args)=>messages.push(args)};
 vm.runInNewContext(oneLine('downloadPack'),context);context.downloadPack('custom');assert.equal(downloads.length,0);assert.match(messages[0][0],/5 MiB import limit/);
 out.pieces[0].referenceImage='small';context.downloadPack('custom');assert.equal(downloads.length,1);assert.equal(JSON.parse(downloads[0][1]).pieces.length,1);
});
test('Failed pack persistence retains imported pieces for recovery without reporting success',async()=>{
 const pending=deferred(),get=nodes(),messages=[],pack={id:'custom-pack-imported',name:'Shared pack',pieces:[{id:'custom:imported'}]},context={CP:{importPack:()=>pack},customLibrary:{packs:[]},defs:{},document:{body:{dataset:{section:'export'}}},$:get,persistCustom:()=>pending.promise,catalogue(){},updateExportNote(){},say:(...args)=>messages.push(args)};
 vm.runInNewContext(oneLine('importPack'),context);const done=context.importPack({format:'slotforge.custom-pack'});
 assert.equal(messages.length,0);assert.equal(context.customLibrary.packs[0],pack);assert.equal(get('export-pack-select').value,pack.id);
 messages.push(['Track packs were not saved',true]);pending.resolve(false);await done;assert.equal(messages.length,1);assert.equal(context.defs['custom:imported'],pack.pieces[0]);
});
test('A layout passed to pack import is rejected before changing the pack library',async()=>{
 let mutated=false;const context={CP:{importPack(){mutated=true;}}};vm.runInNewContext(oneLine('importPack'),context);
 await assert.rejects(context.importPack({format:'slotforge.layout'}),/Import track JSON/);assert.equal(mutated,false);
});
test('Creating a pack does not overwrite a persistence error with a success message',async()=>{
 const get=nodes(),messages=[],context={$:get,customLibrary:{packs:[]},CP:{name:v=>v},F:{uid:()=> 'new'},location:{},routeSection(){},persistCustom:async()=>{messages.push(['Disk save failed',true]);return false;},say:(...args)=>messages.push(args)};
 get('new-pack-name').value='New collection';vm.runInNewContext(source.match(/^\$\('new-pack-form'\)\.onsubmit=.*$/m)[0],context);
 await get('new-pack-form').onsubmit({preventDefault(){}});assert.equal(messages.length,1);assert.equal(context.customLibrary.packs.length,1);assert.equal(context.location.hash,'custom');
});
