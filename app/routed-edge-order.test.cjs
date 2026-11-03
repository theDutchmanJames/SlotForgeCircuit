const test=require('node:test'),assert=require('node:assert/strict'),F=require('./core.js'),R=F.Routed,C=require('./routed-checks.js'),CP=require('./custom-packs.js');
const profile=R.settings({laneCount:4,laneSpacingMm:90,innerClearanceMm:50,outerClearanceMm:200,minRadiusMm:50}),near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
test('New flowing presets match circular lane/clearance order without changing legacy geometry',()=>{
 const oldPoints=R.Spline.preset('bend',profile),old=R.definition(profile,{type:'routed-spline',controlPointsMm:oldPoints});
 const start=R.startingShape('bend',profile),d=R.definition(profile,start.shape);assert.equal(start.flip,true);assert.equal(R.Spline.innerLane(start.shape.controlPointsMm,4),1);
 for(let i=1;i<4;i++)assert.ok(d.geometry.minRadiiMm[i]>d.geometry.minRadiiMm[i-1]);
 const edges=R.Spline.crossSection(d.parameters,d.geometry,0),lanes=d.geometry.lanePaths;near(F.dist(edges[0],lanes[0].start),50);near(F.dist(edges[1],lanes[3].start),200);
 assert.deepEqual(F.validateDefinition(old).geometry,old.geometry);assert.ok(old.geometry.minRadiiMm[0]>old.geometry.minRadiiMm[3]);
 for(const name of['bend','s-bend','transition']){const template=R.pack(profile).pieces.find(d=>d.id==='routed:template-'+name);assert.equal(template.catalogueFlip,true);assert.deepEqual(template.parameters.controlPointsMm,R.startingShape(name,profile).shape.controlPointsMm);}
 const pack=CP.addRouted(CP.empty(),d,{flip:start.flip});assert.equal(CP.read(CP.serialize(pack.library)).packs.at(-1).pieces[0].catalogueFlip,true);
});
test('New straight and straight-transition joins align asymmetric verges at either end and reflection',()=>{
 const corner=R.definition(profile,{type:'curve',slotRadiusMm:600,angleDeg:90},'corner'),straight=R.definition(profile,{type:'straight',lengthMm:500},'straight'),transition=R.definition(profile,R.startingShape('transition',profile).shape,'transition');
 for(const d of[straight,transition])for(const flip of[false,true])for(const index of[0,1]){
  const a={...F.pose(corner),flip,angle:37,x:190,y:-210},defs={[corner.id]:corner,[d.id]:d},target={...F.ports(a,defs)[index],definitionId:corner.id,placement:a},p=F.pose(d),before=structuredClone(a),joined=C.joinStraight(p,d,0,target,defs);
  assert.ok(F.slotsMatch(F.ports(joined,defs)[0],target));assert.ok(!C.checks([a,joined],defs).some(i=>i.code==='verge-step'));assert.deepEqual(a,before);assert.equal(p.flip,false);
 }
});
test('Edge alignment retains a requested orientation when margins are equal and never flips a corner',()=>{
 const s=R.settings(),d=R.definition(s,{type:'straight',lengthMm:500},'straight'),a=F.pose(d),defs={[d.id]:d},target={...F.ports(a,defs)[1],definitionId:d.id,placement:a};
 for(const flip of[true,false]){const p={...F.pose(d),flip};assert.equal(C.joinStraight(p,d,0,target,defs).flip,flip);}
 const bend=R.definition(profile,{type:'curve',slotRadiusMm:600,angleDeg:90},'bend'),p=F.pose(bend);assert.deepEqual(C.joinStraight(p,bend,0,target,defs),F.join(p,bend,0,target));
});
