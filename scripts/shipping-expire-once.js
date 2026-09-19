const { runManualShippingImport } = require("../src/shippingImportCli");

runManualShippingImport({ operation: "expire" })
  .then((exitCode) => {
    process.exitCode = exitCode;
  });
