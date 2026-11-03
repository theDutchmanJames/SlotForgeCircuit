const test=require('node:test'),assert=require('node:assert/strict'),F=require('./core.js'),R=F.Routed,I=require('./integration.js'),X=require('./track-exports.js'),CAD=require('./cad-export.js'),CP=require('./custom-packs.js'),C=require('./routed-checks.js');
const profile=R.settings({laneCount:4,laneSpacingMm:100,innerClearanceMm:150,outerClearanceMm:200,minRadiusMm:100});
function bend(r){const k=.5522847498307936;return[[0,0],[r*k,0],[r,r*(1-k)],[r,r]];}
const shape=r=>({type:'routed-spline',controlPointsMm:bend(r)});
const make=(r=120,extra={})=>F.validateDefinition(R.definition(profile,{...shape(r),foldOverride:true,...extra},'routed:fold','Fold planning example'));
const raw=d=>({format:'slotforge.layout',version:1,title:'Fold planning',definitions:[d],pieces:[F.pose(d)]});
function finite(value){if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finite);}
test('Fold override draws wood, conductor and slot folds without weakening normal validation',()=>{
 for(const r of[340,155,120]){
  assert.throws(()=>R.definition(profile,shape(r)),/fold|pinch/);
  const d=make(r);assert.equal(d.parameters.foldOverride,true);assert.equal(d.geometry.planningOnly,true);assert.equal(d.geometry.lanePaths.length,4);finite(d);
  assert.deepEqual(F.validateDefinition(JSON.parse(JSON.stringify(d))),d);assert.match(R.draw(d),/stroke-dasharray/);
  const strict=structuredClone(d);delete strict.parameters.foldOverride;assert.throws(()=>F.validateDefinition(strict),/fold|pinch/);
 }
 const d=make(800);delete d.parameters.foldOverride;assert.equal(F.validateDefinition(d).parameters.foldOverride,undefined);
});
test('Override supports variable spacing but does not accept malformed dimensions or metadata',()=>{
 const d=make(120,{squeeze:{version:3,mode:'spread',shape:'apex',spacingMm:120,anchorLane:4}});finite(d);assert.equal(d.geometry.planningOnly,true);
 for(const foldOverride of[false,'yes',{},1,null])assert.throws(()=>make(120,{foldOverride}),/override/);
 assert.throws(()=>make(120,{controlPointsMm:[[0,0],[NaN,0],[100,20],[100,100]]}),/finite/);
 assert.throws(()=>R.definition(profile,{type:'straight',lengthMm:500,foldOverride:true}),/override/);
});
test('Planning pieces retain magnetic ends and pack edits, but cannot provide racing routes or CAD',()=>{
 const d=make(),defs={[d.id]:d},p=F.pose(d),q=F.join(F.pose(d),d,0,F.ports(p,defs)[1]);assert.equal(F.connections([p,q],defs).open.length,2);
 assert.equal(F.routes([p,q],defs).closed,false);assert.deepEqual(F.routes([p,q],defs).routes,[]);assert.match(F.routes([p,q],defs).reason,/Planning-only/);
 const out=I.prepare(raw(d));assert.equal(out.integration.contractVersion,'1.0.0-draft.13');assert.equal(out.compatibility.liveTracker,'unavailable');assert.equal(out.track.laneCount,null);assert.deepEqual(out.track.lanes,[]);assert.ok(out.compatibility.issues.some(i=>i.code==='fold-override'));
 assert.deepEqual(I.prepare(out),out);assert.equal(I.importLayout(out).definitions[d.id].parameters.foldOverride,true);
 const saved=CP.addRouted(CP.empty(),d,{packId:'new',packName:'Planning pieces'}),pack=CP.exportPack(saved.pack);assert.equal(CP.importPack(pack,CP.empty()).pieces[0].parameters.foldOverride,true);assert.equal(R.shapeOf(d.parameters).foldOverride,true);
 assert.throws(()=>CAD.build(raw(d)),/planning-only fold overrides/);assert.ok(C.checks([p],defs).some(i=>i.code==='fold-override'));
});
test('PDF/CSV source keeps picture and quantity while excluding overridden lengths and material estimates',()=>{
 const d=make(),model=X.build(raw(d));assert.equal(model.inventory[0].count,1);assert.equal(model.summary.planning,1);assert.equal(model.summary.length,0);assert.equal(X.pieceLength(d),null);assert.equal(model.routed.planningSections,1);assert.equal(model.routed.slotMm,0);assert.equal(model.routed.sectionAreaMm2,0);assert.match(X.csv(model),/planning-only fold override/);
 assert.ok(I.picture(raw(d)).svg.includes('stroke-dasharray'));const straight=R.definition(profile,{type:'straight',lengthMm:500},'routed:straight'),mixed={...raw(d),definitions:[d,straight],pieces:[F.pose(d),F.pose(straight)]};assert.equal(X.build(mixed).summary.length,500);assert.equal(X.build(mixed).routed.slotMm,2000);
});
