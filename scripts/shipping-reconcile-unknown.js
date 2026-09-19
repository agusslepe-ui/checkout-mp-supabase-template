const { runShippingReconciliation } = require("../src/shippingReconciliationCli");

runShippingReconciliation()
  .then((exitCode) => {
    process.exitCode = exitCode;
  });
