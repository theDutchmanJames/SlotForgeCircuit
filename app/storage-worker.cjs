const { parentPort, workerData } = require('node:worker_threads'),
  store = require('./sqlite-store.cjs');
let queue = Promise.resolve(),
  waiting = 0;
parentPort.on('message', message => {
  waiting++;
  queue = queue.then(async () => {
    let reply;
    try {
      reply = { id: message.id, value: await store.run(workerData.directory, message.method, message.args) };
    } catch (e) {
      const storageFailure = e.code || /database|Original retained/i.test(e.message);
      reply = {
        id: message.id,
        error: {
          message:
            storageFailure && !e.status
              ? 'Cannot access the SQLite workspace. Original retained. ' + e.message
              : e.message,
          status: e.status || (storageFailure ? 500 : 400),
        },
      };
    }
    // Requests queued behind this one reuse the open database; with none waiting it is closed
    // before the answer goes out, so the caller never finds the file still held open.
    if (--waiting === 0) store.release(workerData.directory);
    parentPort.postMessage(reply);
  });
});
