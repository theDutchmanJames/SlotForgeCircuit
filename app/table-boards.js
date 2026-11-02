(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./table-stock.js'));else root.TableBoards=factory(root.TableStock);})(typeof globalThis!=='undefined'?globalThis:this,function(S){
'use strict';
const EPS=1e-7,cache=new WeakMap();
function validate(raw,l,w){
 if(!raw||raw.type!=='boards'||raw.version!==1||Object.keys(raw).some(k=>!['type','version','boards','planning'].includes(k))||!Array.isArray(raw.boards)||!raw.boards.length||raw.boards.length>128)throw Error('A table needs 1–128 boards in the supported table format.');
 const ids=new Set();const boards=raw.boards.map(b=>{
  if(!b||typeof b!=='object'||Object.keys(b).some(k=>!['id','name','x','y','lengthMm','widthMm','locked'].includes(k))||typeof b.id!=='string'||!/^[\w-]{1,100}$/.test(b.id)||ids.has(b.id))throw Error('Each table board needs a unique ID.');ids.add(b.id);
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80||/[\u0000-\u001f]/.test(b.name))throw Error('Give each board a name of 1–80 characters.');
  for(const k of ['x','y','lengthMm','widthMm'])if(!Number.isFinite(b[k]))throw Error('Board dimensions and positions must be finite millimetres.');
  if(b.x<0||b.y<0||b.lengthMm<10||b.widthMm<10||b.x+b.lengthMm>l+EPS||b.y+b.widthMm>w+EPS)throw Error('Boards must be at least 10 mm wide and fit inside the table dimensions (maximum 50,000 mm).');
  if(typeof b.locked!=='boolean')throw Error('Board lock must be true or false.');
  return{id:b.id,name:b.name.trim(),x:b.x,y:b.y,lengthMm:b.lengthMm,widthMm:b.widthMm,locked:b.locked};
 });return{type:'boards',version:1,boards,...(raw.planning!==undefined?{planning:S.settings(raw.planning)}:{})};
}
const rectangle=b=>[[b.x,b.y],[b.x+b.lengthMm,b.y],[b.x+b.lengthMm,b.y+b.widthMm],[b.x,b.y+b.widthMm]];
function extent(boards){return{lengthMm:Math.max(10,...boards.map(b=>b.x+b.lengthMm)),widthMm:Math.max(10,...boards.map(b=>b.y+b.widthMm))};}
function contains(shape,p,tol=EPS){return shape.boards.some(b=>p[0]>=b.x-tol&&p[1]>=b.y-tol&&p[0]<=b.x+b.lengthMm+tol&&p[1]<=b.y+b.widthMm+tol);}
// Union of axis-aligned boards. Only exposed edges enter clearance checks;
// touching board seams are construction joins, not outside table boundaries.
function contours(shape){
 if(cache.has(shape))return cache.get(shape);
 const xs=[...new Set(shape.boards.flatMap(b=>[b.x,b.x+b.lengthMm]))].sort((a,b)=>a-b),ys=[...new Set(shape.boards.flatMap(b=>[b.y,b.y+b.widthMm]))].sort((a,b)=>a-b),nx=xs.length-1,ny=ys.length-1,cells=new Uint8Array(nx*ny);
 for(const b of shape.boards)for(let y=ys.indexOf(b.y);y<ys.indexOf(b.y+b.widthMm);y++)for(let x=xs.indexOf(b.x);x<xs.indexOf(b.x+b.lengthMm);x++)cells[y*nx+x]=1;
 const filled=(x,y)=>x>=0&&y>=0&&x<nx&&y<ny&&cells[y*nx+x],edges=[],at=new Map(),key=p=>p.join(',');
 function edge(a,b){const i=edges.length;edges.push({a,b});const k=key(a);if(!at.has(k))at.set(k,[]);at.get(k).push(i);}
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(filled(x,y)){
  if(!filled(x,y-1))edge([xs[x],ys[y]],[xs[x+1],ys[y]]);
  if(!filled(x+1,y))edge([xs[x+1],ys[y]],[xs[x+1],ys[y+1]]);
  if(!filled(x,y+1))edge([xs[x+1],ys[y+1]],[xs[x],ys[y+1]]);
  if(!filled(x-1,y))edge([xs[x],ys[y+1]],[xs[x],ys[y]]);
 }
 const used=new Set(),out=[];
 for(let i=0;i<edges.length;i++)if(!used.has(i)){const points=[];let j=i;while(!used.has(j)){used.add(j);const e=edges[j];points.push(e.a);if(key(e.b)===key(edges[i].a))break;const candidates=(at.get(key(e.b))||[]).filter(k=>!used.has(k));if(!candidates.length)throw Error('Table boundary could not be traced.');const angle=Math.atan2(e.b[1]-e.a[1],e.b[0]-e.a[0]);candidates.sort((a,b)=>{const rank=k=>{const q=edges[k],turn=(Math.atan2(q.b[1]-q.a[1],q.b[0]-q.a[0])-angle+Math.PI*2)%(Math.PI*2);return Math.abs(turn-Math.PI/2)<EPS?0:turn<EPS?1:2;};return rank(a)-rank(b);});j=candidates[0];}
  out.push(points.filter((p,k)=>{const a=points[(k+points.length-1)%points.length],b=points[(k+1)%points.length];return Math.abs((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))>EPS;}));
 }cache.set(shape,out);return out;
}
function issues(shape,limit){const out=[];for(let i=0;i<shape.boards.length;i++){const a=shape.boards[i];if(limit&&!((a.lengthMm<=limit.lengthMm+EPS&&a.widthMm<=limit.widthMm+EPS)||(a.widthMm<=limit.lengthMm+EPS&&a.lengthMm<=limit.widthMm+EPS)))out.push(a.name+' exceeds the sheet / transport limits, even when rotated.');for(const b of shape.boards.slice(i+1))if(Math.min(a.x+a.lengthMm,b.x+b.lengthMm)-Math.max(a.x,b.x)>EPS&&Math.min(a.y+a.widthMm,b.y+b.widthMm)-Math.max(a.y,b.y)>EPS)out.push(a.name+' overlaps '+b.name+'.');}return out;}
function snap(board,others,tolerance=15){const result={...board};for(const axis of ['x','y']){const size=axis==='x'?'lengthMm':'widthMm',other=axis==='x'?'y':'x',otherSize=axis==='x'?'widthMm':'lengthMm';let best=tolerance+EPS,delta=0;for(const b of others){if(b.id===board.id||board[other]>b[other]+b[otherSize]+tolerance||board[other]+board[otherSize]<b[other]-tolerance)continue;for(const target of[b[axis],b[axis]+b[size]])for(const edge of[board[axis],board[axis]+board[size]]){const d=target-edge;if(Math.abs(d)<best){best=Math.abs(d);delta=d;}}}result[axis]=Math.max(0,board[axis]+delta);}return result;}
function split(board,axis,position,ids){if(board.locked)throw Error('Unlock the board before splitting it.');if(!['x','y'].includes(axis)||!Array.isArray(ids)||ids.length!==2)throw Error('Choose a horizontal or vertical split.');const size=axis==='x'?'lengthMm':'widthMm';if(!Number.isFinite(position)||position<10||position>board[size]-10)throw Error('Both panels must be at least 10 mm wide.');return[{...board,id:ids[0],name:(board.name+' A').slice(0,80),[size]:position},{...board,id:ids[1],name:(board.name+' B').slice(0,80),[axis]:board[axis]+position,[size]:board[size]-position}];}
return{Stock:S,validate,rectangle,extent,contains,contours,issues,snap,split};
});
