const { runManualShippingImport } = require("../src/shippingImportCli");

runManualShippingImport({ operation: "process" })
  .then((exitCode) => {
    process.exitCode = exitCode;
  });
