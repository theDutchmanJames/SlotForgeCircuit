const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Timing folder warns about a removed timing piece and recovers when undo restores it',()=>{
 const source=fs.readFileSync(require.resolve('./app.js'),'utf8'),code=source.slice(source.indexOf('function updateTimingControls(){'),source.indexOf('function editTiming(')),fields=new Map(),el=id=>{if(!fields.has(id))fields.set(id,{textContent:'',classList:{toggle(name,on){this[name]=on;}},replaceChildren(){}});return fields.get(id);};
 const piece={id:'start'},ref={pieceId:'start',fraction:.5},state={items:[piece],defs:{},integrationState:{startFinish:ref,direction:1},network:{routes:[]},$:el,defOf:()=>({name:'Start straight',geometry:{lanePaths:[{}]}}),I:{compatibility:()=>({issues:[]})},document:{body:{dataset:{section:'builder'}}}};
 vm.createContext(state);vm.runInContext(code,state);
 state.updateTimingControls();assert.equal(el('timing-badge').textContent,'Set');
 state.items=[];state.updateTimingControls();assert.equal(el('timing-badge').textContent,'Choose piece');assert.equal(el('timing-badge').classList['has-issues'],true);assert.equal(el('timing-position').disabled,true);assert.equal(state.integrationState.startFinish,ref);
 state.items=[piece];state.updateTimingControls();assert.equal(el('timing-badge').textContent,'Set');assert.equal(el('timing-badge').classList['has-issues'],false);assert.equal(el('timing-position').disabled,false);
 state.integrationState.startFinish=null;state.updateTimingControls();assert.equal(el('timing-badge').textContent,'Not set');assert.equal(el('timing-badge').classList['has-issues'],false);
});
