(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('../track-packs/tools/geometry.cjs'));else root.PlasticLanes=factory(root.Geometry);})(typeof globalThis!=='undefined'?globalThis:this,function(G){
'use strict';
// Local millimetres. Only slot routes change; the manufactured road and its ends stay fixed.
function supported(p){return !!p&&['straight','curve'].includes(p.type)&&!p.routed&&!p.laneChange&&(p.laneOffsetsMm?.length??p.laneCount)>=2;}
function railWidth(family){return family==='slotforge.afx-racing'?4:family==='slotforge.carrera-go'?7:family==='slotforge.fleischmann-auto-rallye'?11:8;}
function info(p){const offsets=G.resolve(p).laneOffsetsMm;return{offsets,spacingMm:(offsets.at(-1)-offsets[0])/(offsets.length-1)};}
function settings(raw,p){
 if(!supported(p))throw Error('Lane adjustment needs a straight or circular corner with at least two lanes, without a lane changer.');
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||Object.keys(raw).some(k=>!['version','mode','spacingMm','anchor'].includes(k))||!['squeeze','spread'].includes(raw.mode)||!['centre','inner'].includes(raw.anchor))throw Error('Unsupported plastic lane adjustment settings.');
 if(p.type==='straight'&&raw.anchor!=='centre')throw Error('Straight lane adjustments must spread or squeeze from the centre.');
 const {spacingMm}=info(p);
 if(!Number.isFinite(raw.spacingMm)||raw.spacingMm<=0||raw.spacingMm>10000||(raw.mode==='spread'?raw.spacingMm<=spacingMm:raw.spacingMm>=spacingMm))throw Error(raw.mode==='spread'?'Spread spacing must be greater than the normal spacing.':'Squeeze spacing must be smaller than the normal spacing.');
 return{version:1,mode:raw.mode,spacingMm:raw.spacingMm,anchor:raw.anchor};
}
const cache=new Map();
function geometry(p,family='custom'){
 const z=settings(p.laneAdjustment,p),key=JSON.stringify([p,family]);
 if(cache.has(key))return structuredClone(cache.get(key));
 const result=calculate(p,family,z);cache.set(key,structuredClone(result));if(cache.size>32)cache.delete(cache.keys().next().value);return result;
}
function calculate(p,family,z){
 const base=G.derive(p),{offsets,spacingMm}=info(p),anchor=z.anchor==='inner'?offsets[0]:(offsets[0]+offsets.at(-1))/2,half=railWidth(family)/2;
 const changes=offsets.map(o=>(o-anchor)*(z.spacingMm/spacingMm-1)),peak=offsets.map((o,i)=>o+changes[i]);
 if([...offsets,...peak].some(o=>o<half+.1||o>p.widthMm-half-.1))throw Error('The lanes and rails would leave the road. Reduce Spread; the piece width stays fixed.');
 if(offsets.some((o,i)=>i&&Math.min(o-offsets[i-1],peak[i]-peak[i-1])<=2*half+.1))throw Error('Leave room between the rails. Increase the squeezed spacing.');
 const angle=(p.angleDeg||0)*Math.PI/180;
 function evaluate(t,i){
  const b=64*t**3*(1-t)**3,b1=192*t**2*(1-t)**2*(1-2*t),b2=384*t*(1-t)*(1-5*t+5*t*t),o=offsets[i]+changes[i]*b,v=changes[i]*b1,a=changes[i]*b2;
  let point,d,dd;
  if(p.type==='straight'){point=[p.lengthMm*t,o];d=[p.lengthMm,v];dd=[0,a];}
  else{const r=p.innerRadiusMm+o,s=Math.sin(angle*t),c=Math.cos(angle*t);point=[r*s,-r*c];d=[v*s+r*angle*c,-v*c+r*angle*s];dd=[a*s+2*v*angle*c-r*angle*angle*s,-a*c+2*v*angle*s+r*angle*angle*c];}
  const speed=Math.hypot(...d),curvature=(d[0]*dd[1]-d[1]*dd[0])/speed**3;
  if(!Number.isFinite(curvature)||Math.abs(curvature)*(half+.05)>=.98)throw Error('This change makes the rails fold. Use a longer section or a gentler spacing change.');
  return{point,heading:Math.atan2(d[1],d[0])*180/Math.PI,curvature};
 }
 // Dense seed intervals plus adaptive subdivision avoid missing a narrow transition.
 const ts=[0],memo=new Map(),at=t=>{if(!memo.has(t))memo.set(t,offsets.map((_,i)=>evaluate(t,i)));return memo.get(t);};
 const distance=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));return Math.hypot(p[0]-a[0]-u*x,p[1]-a[1]-u*y);};
 function split(a,b,depth){const aa=at(a),bb=at(b),middle=(a+b)/2;let refine=false;for(const t of[(3*a+b)/4,middle,(a+3*b)/4])for(const [i,q]of at(t).entries()){const turn=Math.abs(((bb[i].heading-aa[i].heading+540)%360)-180);if(distance(q.point,aa[i].point,bb[i].point)>.02||turn>2)refine=true;}
  if(refine){if(depth>=14||ts.length>2048)throw Error('This spacing change is too complex. Use a gentler change.');split(a,middle,depth+1);split(middle,b,depth+1);}else ts.push(b);
 }
 for(let i=0;i<32;i++)split(i/32,(i+1)/32,0);
 const lanePaths=base.lanePaths.map((lane,i)=>{const samples=ts.map(t=>at(t)[i]),points=samples.map(q=>q.point),distancesMm=[0];for(let n=1;n<points.length;n++)distancesMm.push(distancesMm[n-1]+Math.hypot(points[n][0]-points[n-1][0],points[n][1]-points[n-1][1]));
  // Keep connector coordinates bit-for-bit identical to the unadjusted piece.
  points[0]=lane.start.slice();points[points.length-1]=lane.end.slice();
  const segment={type:'polyline',samplingTargetMm:.02,points,distancesMm,headingsDeg:samples.map(q=>q.heading),curvaturesPerMm:samples.map(q=>q.curvature),referenceFractions:ts.slice(),lengthMm:distancesMm.at(-1)};
  return{...lane,segments:[segment],lengthMm:segment.lengthMm,d:points.map((q,n)=>(n?'L ':'M ')+q.map(v=>Number(v.toFixed(5))).join(' ')).join(' ')};
 });
 // A perpendicular gap may be smaller than the radial/vertical spacing on steep transitions.
 for(let k=1;k<lanePaths.length;k++){const a=lanePaths[k-1].segments[0].points,b=lanePaths[k].segments[0].points,limit=2*half+.05;
  for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++){
   if(Math.max(a[i-1][0],a[i][0])+limit<Math.min(b[j-1][0],b[j][0])||Math.max(b[j-1][0],b[j][0])+limit<Math.min(a[i-1][0],a[i][0])||Math.max(a[i-1][1],a[i][1])+limit<Math.min(b[j-1][1],b[j][1])||Math.max(b[j-1][1],b[j][1])+limit<Math.min(a[i-1][1],a[i][1]))continue;
   if(Math.min(distance(a[i-1],b[j-1],b[j]),distance(a[i],b[j-1],b[j]),distance(b[j-1],a[i-1],a[i]),distance(b[j],a[i-1],a[i]))<limit)throw Error('The rails get too close in the transition. Use a longer piece or less adjustment.');
  }
 }
 return{...base,lanePaths};
}
return{supported,info,settings,geometry,railWidth};
});
