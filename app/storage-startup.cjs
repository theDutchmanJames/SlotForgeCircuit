// Only legacy JSON workspaces wait for the browser's visible upgrade screen.
// The existing verified migration remains the single writer of saved data.
const fs=require('node:fs'),path=require('node:path');
function createStorageStartup(store){
 const exists=name=>fs.existsSync(path.join(store.directory,name));
 if(exists('workspace.sqlite')||exists('sqlite-storage.json')||!exists('workspace.json'))return null;
 let phase='waiting',error=null,result=null,task=null,acknowledged=false;
 const status=()=>({phase,error,result});
 return{status,get acknowledged(){return acknowledged;},acknowledge(){if(phase!=='ready')throw Error('The upgrade has not finished.');acknowledged=true;return status();},start(){if(!task){phase='running';task=store.init().then(()=>{result=store.migrationResult;phase='ready';},e=>{error=e.message;phase='error';});}return status();},async close(){if(task)await task;await store.close();}};
}
module.exports={createStorageStartup};
