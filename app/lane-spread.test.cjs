const test=require('node:test'),assert=require('node:assert/strict'),F=require('./core.js'),R=F.Routed,S=R.Spline,FF=F.FreeForm,I=require('./integration.js'),CAD=require('./cad-export.js'),CP=require('./custom-packs.js');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const profile=(n=4)=>R.settings({...R.defaults,laneCount:n,laneSpacingMm:100,innerClearanceMm:50,outerClearanceMm:75,constructionMode:'table'});
const spread=(shape='apex',anchorLane='centre')=>({version:3,mode:'spread',shape,spacingMm:140,anchorLane,...(shape==='hold'?{transitionMm:500}:{})});
function section(z=spread(),points=[[0,0],[300,0],[900,0],[1800,0]],s=profile()) {return F.validateDefinition(R.definition(s,{type:S.TYPE,controlPointsMm:points,squeeze:z},'routed:spread'));}
const raw=d=>({format:'slotforge.layout',version:1,title:'Lane Spread',definitions:[d],pieces:[{...F.pose(d),id:'spread'}]});
function freeform(side=1){const s=profile(),m=FF.configure(FF.append(FF.append(FF.empty(4),[200,500]),[2200,500]),4,2,side);m.nodes[0].squeeze={version:2,mode:'spread',spacingMm:140,domain:[0,1]};return{s,m,d:FF.definition(m,s)};}

test('Spread smoothly widens at the physical midpoint with unchanged joins and endpoint curvature',()=>{
 const d=section(),g=d.geometry,lanes=g.lanePaths.map(l=>l.segments[0]);let apex=false;
 for(let j=0;j<lanes[0].points.length;j++){const x=lanes[0].points[j][0],u=x/1800,w=64*u**3*(1-u)**3;for(let i=1;i<4;i++)near(F.dist(lanes[i-1].points[j],lanes[i].points[j]),100+40*w);if(Math.abs(x-900)<1e-6){apex=true;near(F.dist(lanes[0].points[j],lanes[1].points[j]),140);}}
 assert.ok(apex);for(const seg of lanes){near(seg.headingsDeg[0],0);near(seg.headingsDeg.at(-1),0);near(seg.curvaturesPerMm[0],0);near(seg.curvaturesPerMm.at(-1),0);assert.ok(seg.lengthMm>1800);}
});
test('Spread hold profile reaches a plateau and retains smooth endpoints',()=>{const d=section(spread('hold'));const [a,b]=d.geometry.lanePaths.map(l=>l.segments[0]);for(let j=0;j<a.points.length;j++){const x=a.points[j][0];if(x>=500&&x<=1300)near(F.dist(a.points[j],b.points[j]),140);}near(a.headingsDeg[0],0);near(a.headingsDeg.at(-1),0);});
test('Spread supports each lane as anchor on curved sections and both mirrored placements',()=>{
 const s=profile(),points=S.preset('bend',s);for(const anchor of[1,2,3,4]){const d=section(spread('apex',anchor),points,s),lane=d.geometry.lanePaths[anchor-1].segments[0];d.geometry.parametersT.forEach((t,j)=>near(F.dist(lane.points[j],S.offset(S.evaluate(points,t),-150+(anchor-1)*100)),0));for(const flip of[false,true]){const p={...F.pose(d),id:'p',flip},ports=F.ports(p,{[d.id]:d});for(let k=0;k<2;k++)for(let i=0;i<4;i++)near(F.dist(ports[k].lanes[i],F.point(k?d.geometry.lanePaths[i].end:d.geometry.lanePaths[i].start,p)),0);}}
});
test('Corner spread recommendation identifies the inner lane, while straights and S-bends remain centred',()=>{
 const s=profile(),c=R.flowingFromCurve(s,{type:'curve',slotRadiusMm:400,angleDeg:90}).shape.controlPointsMm;
 assert.equal(S.innerLane(c,4),1);
 assert.equal(S.innerLane(c.map(([x,y])=>[x,-y]),4),4);
 assert.equal(S.innerLane([[0,0],[300,0],[900,0],[1800,0]],4),null);
 assert.equal(S.innerLane(S.preset('s-bend',s),4),null);
 // A brief reversal close to the end is still an S-bend, not an outward-only corner.
 assert.equal(S.innerLane([[0,0],[100,0],[200,100],[300,199]],4),null);
});
test('Outward corner spread preserves the inner slot and both joins for either turn and mirrored placement',()=>{
 const s=profile(),original=R.flowingFromCurve(s,{type:'curve',slotRadiusMm:400,angleDeg:90}).shape.controlPointsMm;
 for(const sign of[1,-1]){
  const points=original.map(([x,y])=>[x,y*sign]),anchor=S.innerLane(points,4),d=section(spread('apex',anchor),points,s),base=F.validateDefinition(R.definition(s,{type:S.TYPE,controlPointsMm:points},'routed:base'));
  for(let j=0;j<d.geometry.parametersT.length;j++){
   const t=d.geometry.parametersT[j],q=S.evaluate(points,t),fixed=S.offset(q,-150+(anchor-1)*100);
   near(F.dist(d.geometry.lanePaths[anchor-1].segments[0].points[j],fixed),0);
   for(let i=0;i<4;i++){
    const moved=d.geometry.lanePaths[i].segments[0].points[j],plain=S.offset(q,-150+i*100),delta=(moved[0]-plain[0])*q.normal[0]+(moved[1]-plain[1])*q.normal[1];
    assert.ok(delta*sign>=-1e-7,'moving lanes must expand outward');
   }
  }
  assert.ok(d.geometry.lanePaths[anchor-1].segments[0].curvaturesPerMm.every(k=>k*sign<0));
  for(const flip of[false,true]){
   const pose={...F.pose(d),flip};for(let i=0;i<4;i++)for(const end of['start','end'])near(F.dist(F.point(d.geometry.lanePaths[i][end],pose),F.point(base.geometry.lanePaths[i][end],pose)),0);
  }
 }
});
test('Existing centre-anchored corner spreads keep their saved geometry on import',()=>{
 const s=profile(),points=R.flowingFromCurve(s,{type:'curve',slotRadiusMm:600,angleDeg:90}).shape.controlPointsMm,d=section(spread(),points,s),out=I.prepare(raw(d)),imported=I.importLayout(out);
 assert.equal(imported.definitions[d.id].parameters.squeeze.anchorLane,'centre');
 assert.deepEqual(imported.definitions[d.id].geometry.lanePaths,d.geometry.lanePaths);
});
test('Spread validates direction, bounds, shapes, metadata and unsafe geometry without loosening legacy squeeze rules',()=>{
 for(const update of[{version:4},{mode:'squeeze'},{shape:'unknown'},{spacingMm:100},{spacingMm:80},{spacingMm:301},{spacingMm:NaN},{anchorLane:5},{transitionMm:100},{unknown:true}])assert.throws(()=>section({...spread(),...update}));
 assert.throws(()=>section(spread(),undefined,profile(1)),/two lanes/);assert.throws(()=>section({...spread('hold'),transitionMm:901}),/half/);
 assert.throws(()=>section({...spread('hold'),transitionMm:10,spacingMm:300}),/fold|overlap|abrupt/);
 assert.throws(()=>section({version:2,shape:'apex',spacingMm:140,anchorLane:1}),/must not exceed/);
 assert.throws(()=>section({version:1,spacingMm:140,anchorLane:1,transitionMm:500}),/must not exceed/);
});
test('Conductor widths follow the spread slot normals and CAD uses the actual widened paths',()=>{
 const d=section(),p=d.parameters,g=d.geometry;for(let i=0;i<4;i++){const a=S.edgePoints(p,g,p.laneOffsetsMm[i]+2.6),b=S.edgePoints(p,g,p.laneOffsetsMm[i]+8.6);for(let j=0;j<a.length;j++)near(F.dist(a[j],b[j]),6);}
 const cad=CAD.build(raw(d),{slots:true,slotEdges:true,conductors:true});const slots=cad.paths.filter(p=>p.layer==='SLOT_CENTRES');assert.equal(slots.length,4);for(let i=0;i<4;i++)assert.deepEqual(slots[i].points,g.lanePaths[i].segments[0].points);assert.match(CAD.svg(raw(d)),/SLOT_CENTRES/);assert.match(CAD.dxf(raw(d)),/LWPOLYLINE/);
});
test('Spread survives saved packs, workspace library serialization and layout imports with an explicit new contract',()=>{
 const d=section(),saved=CP.addRouted(CP.empty(),d,{packId:'new',packName:'Spreads'}),pack=CP.exportPack(saved.pack);assert.deepEqual(CP.importPack(pack,CP.empty()).pieces[0].parameters.squeeze,d.parameters.squeeze);assert.deepEqual(CP.read(CP.serialize(saved.library)).packs.at(-1).pieces[0].geometry,d.geometry);
 const out=I.prepare(raw(d));assert.equal(out.integration.contractVersion,'1.0.0-draft.12');assert.equal(out.version,1);assert.deepEqual(I.importLayout(out).definitions[d.id].parameters.squeeze,d.parameters.squeeze);assert.deepEqual(I.prepare(out),out);
 const unused=raw(d);unused.pieces=[];assert.equal(I.prepare(unused).integration.contractVersion,I.SPREAD_CONTRACT);
});
test('FreeForm spread fixes the drawn lane on either generation side and reverses numbering without changing paths',()=>{for(const side of[1,-1]){const{s,m,d}=freeform(side);assert.equal(d.geometry.valid,true);const ls=d.geometry.lanePaths.map(l=>l.segments[0]);for(const p of ls[1].points)near(p[1],500);const mid=ls[1].points.findIndex(p=>Math.abs(p[0]-1200)<.001);for(let i=1;i<4;i++){near(F.dist(ls[i-1].points[0],ls[i].points[0]),100);near(F.dist(ls[i-1].points[mid],ls[i].points[mid]),140);near(F.dist(ls[i-1].points.at(-1),ls[i].points.at(-1)),100);}const reversed=FF.definition(FF.reverseNumbers(m),s);for(let i=0;i<4;i++){near(reversed.geometry.lanePaths[3-i].lengthMm,d.geometry.lanePaths[i].lengthMm);assert.equal(reversed.geometry.lanePaths[3-i].id,d.geometry.lanePaths[i].id);}const out=I.prepare(raw(d));assert.equal(out.integration.contractVersion,I.SPREAD_CONTRACT);assert.deepEqual(I.importLayout(out).definitions[d.id].parameters.freeform,m);}});
test('Splitting a FreeForm spread preserves its arc-length profile and lane lengths',()=>{const{s,m,d}=freeform(),split=FF.split(m,0,.35),after=FF.definition(split.model,s);assert.equal(after.geometry.valid,true);assert.equal(split.model.nodes[1].squeeze.mode,'spread');near(split.model.nodes[0].squeeze.domain[1],.35);near(split.model.nodes[1].squeeze.domain[0],.35);for(let i=0;i<4;i++)near(after.geometry.lanePaths[i].lengthMm,d.geometry.lanePaths[i].lengthMm,.025);});
test('FreeForm spread on a closed curved stretch preserves loop and slot identities',()=>{const s=profile(),m=FF.configure(FF.oval(s),4,2,1),base=FF.definition(m,s);m.nodes[0].squeeze={version:2,mode:'spread',spacingMm:120,domain:[0,1]};const d=FF.definition(m,s);assert.equal(d.geometry.valid,true);assert.equal(d.geometry.closed,true);assert.deepEqual(d.geometry.lanePaths.map(l=>l.id),base.geometry.lanePaths.map(l=>l.id));assert.ok(d.geometry.lanePaths.some((l,i)=>Math.abs(l.lengthMm-base.geometry.lanePaths[i].lengthMm)>.1));assert.equal(I.prepare(raw(d)).track.laneCount,4);});
test('FreeForm spread rejects ambiguous or contradictory metadata and cannot silently lose lanes',()=>{const{s,m}=freeform();for(const change of[{mode:'squeeze'},{mode:undefined},{version:3},{spacingMm:100},{spacingMm:80},{spacingMm:301},{domain:[1,0]},{future:true}]){const bad=structuredClone(m);Object.assign(bad.nodes[0].squeeze,change);assert.throws(()=>FF.definition(bad,s));}assert.throws(()=>FF.configure(m,1,1,1),/Reset all/);});
