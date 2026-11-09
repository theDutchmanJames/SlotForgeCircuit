(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PieceColours=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const curves=['#bf646a','#c78650','#b7a24f','#73a878','#50a39d','#5797c0','#8b83bc','#b67ca6'];
const straights=['#657888','#527e9c','#5994b4','#69abc5','#86bacb','#a0cbd5'];
const shade=(palette,i)=>palette[i]||`hsl(${Math.round((i*137.508+(palette===curves?20:195))%360)} 38% ${45+Math.floor(i/12)%3*8}%)`;
function eligible(d){return !!d?.geometry&&!d.parameters.routed&&!d.parameters.laneChange&&['straight','curve'].includes(d.parameters.type);}
const packKey=d=>(d.pack||'Custom')+'|'+(d.family||'custom');
const sizeKey=d=>d.parameters.type+':'+(d.parameters.type==='curve'?d.parameters.innerRadiusMm:d.parameters.lengthMm);
function build(definitions){
 const groups=new Map(),colours=new Map(),legends=new Map();
 for(const d of definitions)if(eligible(d)){const key=packKey(d);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(d);}
 for(const [key,defs]of groups){const entries=[];
  for(const type of ['straight','curve']){const bySize=new Map();for(const d of defs.filter(d=>d.parameters.type===type)){const n=type==='curve'?d.parameters.innerRadiusMm:d.parameters.lengthMm;if(!bySize.has(n))bySize.set(n,[]);bySize.get(n).push(d);}
   const sizes=[...bySize.keys()].sort((a,b)=>type==='curve'?a-b:b-a);
   const standard=defs.filter(d=>d.parameters.type==='straight'&&/\bstandard\b|\bfull[- ](?:length|straight)\b/i.test(d.name)).map(d=>d.parameters.lengthMm).sort((a,b)=>b-a)[0]||sizes[0];
   sizes.forEach((size,i)=>{const members=bySize.get(size),color=shade(type==='curve'?curves:straights,i),r=members.map(d=>d.name.match(/\bR\d+\b/i)?.[0].toUpperCase()).filter(Boolean).sort()[0],ratio=size/standard,fraction=[2,3,4,8].find(n=>Math.abs(ratio-1/n)<.002),lengthLabel=fraction?'1/'+fraction+' straight':Math.abs(ratio-1)<.00001?'Full straight':'Straight',label=type==='curve'?(r||'Curve')+' · '+Number(size.toFixed(2))+' mm inner radius':lengthLabel+' · '+Number(size.toFixed(2))+' mm';entries.push({color,label,type,size});for(const d of members)colours.set(key+'|'+sizeKey(d),color);});
  }legends.set(key,entries);
 }
 return{colour:d=>eligible(d)?colours.get(packKey(d)+'|'+sizeKey(d)):undefined,legend:pieces=>{const keys=new Set(pieces.filter(eligible).map(packKey));return[...keys].flatMap(k=>legends.get(k)||[]);}};
}
return{eligible,build};
});
