const { startShippingWorkerProcess } = require("../src/shippingPollingWorker");

function main({
  startWorkerProcess = startShippingWorkerProcess,
  terminate = (exitCode) => process.exit(exitCode),
  processObject = process,
} = {}) {
  const result = startWorkerProcess({
    processObject,
    onFatal: (exitCode) => terminate(exitCode),
  });
  if (!result.started) processObject.exitCode = result.exitCode;
  return result;
}

if (require.main === module) main();

module.exports = { main };
