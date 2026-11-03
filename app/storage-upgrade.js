(function(root){'use strict';
async function run(initial,request){
 const dialog=document.getElementById('storage-upgrade'),heading=document.getElementById('upgrade-heading'),message=document.getElementById('upgrade-message'),progress=document.getElementById('upgrade-progress'),details=document.getElementById('upgrade-details'),next=document.getElementById('upgrade-continue'),stop=document.getElementById('upgrade-stop');
 dialog.addEventListener('cancel',e=>e.preventDefault());
 dialog.showModal();
 try{
  // Yield to rendering before asking the helper to start the conversion.
  await new Promise(resolve=>setTimeout(resolve,80));
  let state=initial;
  if(state.phase==='waiting')state=await request('storage-startup','POST',{});
  while(state.phase==='running'||state.phase==='waiting'){
   await new Promise(resolve=>setTimeout(resolve,300));
   state=await request('storage-startup');
  }
  if(state.phase!=='ready')throw Error(state.error||'The upgrade could not be completed.');
  progress.hidden=true;heading.textContent='Your library is ready';
  message.textContent='Your saved workspace is now using SQLite. You can carry on designing.';
  const r=state.result;
  const count=(n,label)=>n+' '+label+(n===1?'':'s');
  details.textContent=r?.migrated?`${count(r.tracks,'saved track')} · ${count(r.packs,'custom pack')} · ${count(r.pieces,'custom piece')}${r.current?' · current drawing retained':''}`:'Your saved workspace has been checked and is ready.';
  next.hidden=false;next.focus();
  await new Promise(resolve=>next.onclick=resolve);
  await request('storage-startup','POST',{acknowledge:true});
  dialog.close();
 }catch(error){
  progress.hidden=true;next.hidden=true;heading.textContent='Your library needs attention';
  message.textContent='Circuit could not finish opening your saved workspace. The editor has been kept closed; nothing was reset.';
  details.textContent=error.message;
  stop.hidden=false;stop.onclick=async()=>{stop.disabled=true;try{await request('quit','POST',{});details.textContent=error.message+' Local app stopped. Keep the complete data folder and report this error before trying again.';}catch(e){details.textContent=error.message+' '+e.message;stop.disabled=false;}};
  throw error;
 }
}
root.StorageUpgrade={run};
})(typeof globalThis!=='undefined'?globalThis:this);
