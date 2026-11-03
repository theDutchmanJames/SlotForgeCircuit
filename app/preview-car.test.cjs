const test=require('node:test'),assert=require('node:assert/strict'),P=require('./preview-car.js'),F=require('./core.js'),I=require('./integration.js'),DL=require('./design-library.js');
test('Scale presets use physical millimetres from the declared reference car',()=>{
 assert.deepEqual(P.settings(),{version:1,scale:'1:32'});
 for(const scale of['1:32','1:24','1:42','1:64']){const n=+scale.slice(2),s={version:1,scale},d=P.dimensions(s);assert.equal(d.lengthMm,4500/n);assert.equal(d.widthMm,1800/n);const drawing=P.draw(s);assert.ok(drawing.includes(`scale(${d.lengthMm/100} ${d.widthMm/40})`));assert.ok(drawing.includes(`data-length-mm="${d.lengthMm}"`));}
 assert.equal(P.dimensions({version:1,scale:'1:24'}).widthMm,75);
});
test('Custom dimensions are independent, finite and validated before rendering',()=>{
 const s={version:1,scale:'custom',lengthMm:137,widthMm:61};assert.deepEqual(P.dimensions(s),{lengthMm:137,widthMm:61});assert.match(P.draw(s),/scale\(1.37 1.525\)/);
 for(const bad of[null,[],{}, {version:2,scale:'1:32'},{version:1,scale:'1:43'},{version:1,scale:'1:32',widthMm:60},...[-1,0,4.99,1001,NaN,Infinity,'60',null].map(widthMm=>({...s,widthMm}))])assert.throws(()=>P.settings(bad));
 assert.doesNotMatch(P.draw(s,'" onload="alert(1)'),/onload/);
});
test('Car size survives layouts and library preparation without changing geometry, routes or tune profile',()=>{
 const raw=structuredClone(require('../integration/slotforge-timing/routed-examples/closed-routed-oval.slotforge.json')),base=I.prepare(raw);raw.workspace={...raw.workspace,previewCar:{version:1,scale:'custom',lengthMm:140,widthMm:63}};const out=I.prepare(raw);
 assert.deepEqual(out.workspace.previewCar,raw.workspace.previewCar);assert.deepEqual(I.importLayout(out).workspace.previewCar,raw.workspace.previewCar);assert.deepEqual(DL.prepare(out,out.title).workspace.previewCar,raw.workspace.previewCar);assert.deepEqual(I.prepare(out),out);
 assert.deepEqual(out.preparedGeometry,base.preparedGeometry);assert.deepEqual(out.track,base.track);assert.deepEqual(out.profile,base.profile);assert.equal(out.integration.contractVersion,base.integration.contractVersion);
 assert.equal(I.prepare({...raw,workspace:{previewCar:{version:1,scale:'1:64'}}}).workspace.previewCar.scale,'1:64');
 assert.throws(()=>F.validateLayout({...raw,workspace:{previewCar:{version:1,scale:'custom',lengthMm:0,widthMm:60}}}),/length and width/);
 delete raw.workspace.previewCar;assert.equal(I.importLayout(raw).workspace.previewCar,undefined);
});
