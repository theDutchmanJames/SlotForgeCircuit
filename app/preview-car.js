(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PreviewCar=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// A generic reference silhouette, not the dimensions of a particular car model.
const reference=Object.freeze({lengthMm:4500,widthMm:1800}),scales=Object.freeze(['1:32','1:24','1:42','1:64']);
function settings(raw){
 if(raw===undefined)return{version:1,scale:'1:32'};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||![...scales,'custom'].includes(raw.scale))throw Error('Choose a supported preview car scale or Custom.');
 const custom=raw.scale==='custom',keys=custom?['version','scale','lengthMm','widthMm']:['version','scale'];
 if(Object.keys(raw).some(k=>!keys.includes(k)))throw Error('Unsupported preview car size settings.');
 if(!custom)return{version:1,scale:raw.scale};
 for(const key of['lengthMm','widthMm'])if(!Number.isFinite(raw[key])||raw[key]<5||raw[key]>1000)throw Error('Car length and width must each be between 5 and 1,000 mm.');
 return{version:1,scale:'custom',lengthMm:raw.lengthMm,widthMm:raw.widthMm};
}
function dimensions(raw){const s=settings(raw);if(s.scale==='custom')return{lengthMm:s.lengthMm,widthMm:s.widthMm};const denominator=Number(s.scale.slice(2));return{lengthMm:reference.lengthMm/denominator,widthMm:reference.widthMm/denominator};}
function draw(raw,color='#ec6167'){
 const d=dimensions(raw),fill=/^#[0-9a-f]{6}$/i.test(color)?color:'#ec6167';
 // Exact 100 x 40 outer footprint including tyres/stroke. The guide is (0,0),
 // 10% of the length behind the nose. Drift rotates about that fixed guide.
 return`<g class="car-body" data-length-mm="${d.lengthMm}" data-width-mm="${d.widthMm}" transform="scale(${d.lengthMm/100} ${d.widthMm/40})"><rect x="-79" y="-20" width="16" height="40" rx="3" fill="#080c10"/><rect x="-18" y="-20" width="14" height="40" rx="3" fill="#080c10"/><path d="M 9.5 -10 V 10 Q 9.5 16.5 3 16.5 H -65 L -89.5 11 V -11 L -65 -16.5 H 3 Q 9.5 -16.5 9.5 -10 Z" fill="${fill}" stroke="#dce3e5" stroke-width="1" stroke-linejoin="round"/><path d="M -25 -10 H -52 L -61 0 L -52 10 H -25 Z" fill="#1a2c3b"/><path d="M -12 -9 V 9" stroke="#f1ece1" stroke-width="3"/></g>`;
}
return{reference,scales,settings,dimensions,draw};
});
