// SQLite operations run in a worker; the local HTTP server stays responsive.
const path=require('node:path'),{Worker}=require('node:worker_threads'),L=require('./legacy-disk-store.cjs');
const MAX=256*1024*1024;
class DiskStore{
 constructor(directory){this.directory=path.resolve(directory);this.engine='sqlite';this.file=path.join(this.directory,'workspace.sqlite');this.queue=Promise.resolve();this.worker=null;this.pending=new Map();this.sequence=0;this.closed=false;}
 async init(){this.migrationResult=await this.call('init');return this;}
 call(method,...args){
  if(this.closed)return Promise.reject(Error('Storage is closing. Start Circuit again before saving.'));
  if(!this.worker){const worker=new Worker(path.join(__dirname,'storage-worker.cjs'),{workerData:{directory:this.directory}});this.worker=worker;
   const failed=error=>{if(this.worker!==worker)return;this.worker=null;for(const p of this.pending.values())p.reject(error);this.pending.clear();worker.unref();};
   worker.on('error',failed);worker.on('exit',code=>{if(this.worker===worker)failed(Error('Storage worker stopped. Reload before retrying; download unsaved work first.'));});
   worker.on('message',message=>{const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);if(message.error)p.reject(Object.assign(Error(message.error.message),{status:message.error.status}));else p.resolve(message.value);if(!this.pending.size)worker.unref();});worker.unref();
  }
  const id=++this.sequence,worker=this.worker;worker.ref();const task=new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{worker.postMessage({id,method,args});}catch(e){this.pending.delete(id);if(!this.pending.size)worker.unref();reject(e);}});this.queue=Promise.allSettled([this.queue,task]).then(()=>{});return task;
 }
 async close(){this.closed=true;await this.queue;const worker=this.worker;this.worker=null;if(worker)await worker.terminate();}
 lock(){return new L.DiskStore(this.directory).lock();}
}
for(const method of ['read','current','packs','list','summaries','page','preview','get','putCurrent','putPacks','putDesign','remove','exportBundle','previousBundle','importBundle','history'])DiskStore.prototype[method]=function(...args){return this.call(method,...args);};
module.exports={DiskStore,home:L.home,MAX};
