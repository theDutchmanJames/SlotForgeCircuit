const {parentPort,workerData}=require('node:worker_threads'),store=require('./sqlite-store.cjs');
let queue=Promise.resolve();
parentPort.on('message',message=>{queue=queue.then(async()=>{try{parentPort.postMessage({id:message.id,value:await store.run(workerData.directory,message.method,message.args)});}catch(e){const storageFailure=e.code||/database|Original retained/i.test(e.message);parentPort.postMessage({id:message.id,error:{message:storageFailure&&!e.status?'Cannot access the SQLite workspace. Original retained. '+e.message:e.message,status:e.status||(storageFailure?500:400)}});}});});
