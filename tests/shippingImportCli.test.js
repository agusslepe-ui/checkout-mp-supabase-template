const fs = require("fs");
const path = require("path");

const {
  loadShippingImportWorker,
  runManualShippingImport,
} = require("../src/shippingImportCli");

function captureStream() {
  let output = "";
  return {
    stream: { write: jest.fn((value) => { output += value; }) },
    read: () => output,
  };
}

function authorizedOptions(overrides = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  return {
    options: {
      args: ["--execute"],
      env: { SHIPPING_IMPORT_MANUAL_EXECUTION: "true" },
      stdout: stdout.stream,
      stderr: stderr.stream,
      ...overrides,
    },
    stdout,
    stderr,
  };
}

describe("CLI manual one-shot de shipping import", () => {
  test("sin --execute no carga ni llama el worker", async () => {
    const loadWorker = jest.fn();
    const stdout = captureStream();
    const stderr = captureStream();

    const exitCode = await runManualShippingImport({
      operation: "process",
      args: [],
      env: { SHIPPING_IMPORT_MANUAL_EXECUTION: "true" },
      loadWorker,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(1);
    expect(loadWorker).not.toHaveBeenCalled();
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe("[shipping-import] manual execution disabled\n");
  });

  test.each([undefined, "false", "TRUE", "1"])(
    "variable %p no carga ni llama el worker",
    async (flag) => {
      const loadWorker = jest.fn();
      const stderr = captureStream();
      const env = flag === undefined ? {} : { SHIPPING_IMPORT_MANUAL_EXECUTION: flag };

      const exitCode = await runManualShippingImport({
        operation: "process",
        args: ["--execute"],
        env,
        loadWorker,
        stdout: captureStream().stream,
        stderr: stderr.stream,
      });

      expect(exitCode).toBe(1);
      expect(loadWorker).not.toHaveBeenCalled();
      expect(stderr.read()).toContain("manual execution disabled");
    }
  );

  test.each([
    [{ outcome: "idle" }, "[shipping-import] outcome=idle\n"],
    [{ outcome: "created", orderId: 123, attemptCount: 1 },
      "[shipping-import] outcome=created orderId=123 attemptCount=1\n"],
    [{ outcome: "unknown", orderId: 124, attemptCount: 2 },
      "[shipping-import] outcome=unknown orderId=124 attemptCount=2\n"],
    [{ outcome: "retryable", orderId: 125, attemptCount: 3 },
      "[shipping-import] outcome=retryable orderId=125 attemptCount=3\n"],
    [{ outcome: "failed", orderId: 126, attemptCount: 4 },
      "[shipping-import] outcome=failed orderId=126 attemptCount=4\n"],
    [{ outcome: "lease_lost", orderId: 127 },
      "[shipping-import] outcome=lease_lost orderId=127\n"],
  ])("process autorizado llama exactamente una vez y sanitiza %p", async (result, expected) => {
    const processNextShippingImport = jest.fn(async () => result);
    const loadWorker = jest.fn(() => ({ processNextShippingImport }));
    const { options, stdout, stderr } = authorizedOptions({ loadWorker });

    const exitCode = await runManualShippingImport({ operation: "process", ...options });

    expect(exitCode).toBe(0);
    expect(loadWorker).toHaveBeenCalledTimes(1);
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(stdout.read()).toBe(expected);
    expect(stderr.read()).toBe("");
  });

  test("error inesperado retorna 1 sin message, stack ni PII", async () => {
    const sensitive = "Ana ana@example.test TOKEN-SECRET Calle-123";
    const processNextShippingImport = jest.fn(async () => {
      const error = new Error(sensitive);
      error.stack = `stack ${sensitive}`;
      throw error;
    });
    const { options, stdout, stderr } = authorizedOptions({
      loadWorker: () => ({ processNextShippingImport }),
    });

    const exitCode = await runManualShippingImport({ operation: "process", ...options });

    expect(exitCode).toBe(1);
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe(
      "[shipping-import] outcome=error errorType=unexpected_error\n"
    );
    expect(stderr.read()).not.toContain(sensitive);
  });

  test("descarta campos sensibles aunque aparezcan en el resultado interno", async () => {
    const sensitive = "ana@example.test Calle 123 TOKEN-SECRET EXT-ORDER-1";
    const { options, stdout, stderr } = authorizedOptions({
      loadWorker: () => ({
        processNextShippingImport: jest.fn(async () => ({
          outcome: "created",
          orderId: 321,
          attemptCount: 1,
          customerEmail: sensitive,
          payload: { address: sensitive },
          accessToken: sensitive,
        })),
      }),
    });

    const exitCode = await runManualShippingImport({ operation: "process", ...options });

    expect(exitCode).toBe(0);
    expect(stdout.read()).toBe(
      "[shipping-import] outcome=created orderId=321 attemptCount=1\n"
    );
    expect(stdout.read()).not.toContain(sensitive);
    expect(stderr.read()).toBe("");
  });

  test.each([0, 3])("expire autorizado llama una vez y muestra count=%i", async (count) => {
    const expireStaleShippingImportLeases = jest.fn(async () => ({
      outcome: "expired",
      count,
    }));
    const { options, stdout, stderr } = authorizedOptions({
      loadWorker: () => ({ expireStaleShippingImportLeases }),
    });

    const exitCode = await runManualShippingImport({ operation: "expire", ...options });

    expect(exitCode).toBe(0);
    expect(expireStaleShippingImportLeases).toHaveBeenCalledTimes(1);
    expect(stdout.read()).toBe(`[shipping-import] outcome=expired count=${count}\n`);
    expect(stderr.read()).toBe("");
  });

  test("expire sin guardas no carga worker ni ejecuta RPC", async () => {
    const loadWorker = jest.fn();
    const stderr = captureStream();

    const exitCode = await runManualShippingImport({
      operation: "expire",
      args: ["--execute"],
      env: {},
      loadWorker,
      stdout: captureStream().stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(1);
    expect(loadWorker).not.toHaveBeenCalled();
    expect(stderr.read()).toContain("manual execution disabled");
  });

  test("expire inesperado retorna error seguro", async () => {
    const { options, stdout, stderr } = authorizedOptions({
      loadWorker: () => ({
        expireStaleShippingImportLeases: jest.fn(async () => {
          throw new Error("private database detail");
        }),
      }),
    });

    const exitCode = await runManualShippingImport({ operation: "expire", ...options });

    expect(exitCode).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe(
      "[shipping-import] outcome=error errorType=unexpected_error\n"
    );
  });

  test("implementación y entrypoints no contienen loops, timers ni ejecución duplicada", () => {
    const files = [
      "../src/shippingImportCli.js",
      "../scripts/shipping-process-once.js",
      "../scripts/shipping-expire-once.js",
    ];
    const source = files.map((file) => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");

    expect(source).not.toMatch(/\b(?:for|while)\s*\(|setInterval|setTimeout|sleep\s*\(/);
    expect(source.match(/worker\.processNextShippingImport\(\)/g)).toHaveLength(1);
    expect(source.match(/worker\.expireStaleShippingImportLeases\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/console\.(?:log|error)|JSON\.stringify\(error\)|error\.stack/);
  });

  test("package expone ambos comandos sin alterar npm start", () => {
    const packageJson = require("../package.json");

    expect(packageJson.scripts["shipping:process-once"]).toBe(
      "node scripts/shipping-process-once.js"
    );
    expect(packageJson.scripts["shipping:expire-once"]).toBe(
      "node scripts/shipping-expire-once.js"
    );
    expect(packageJson.scripts.start).toBe("node index.js");
    expect(packageJson.scripts.start).not.toMatch(/shipping|worker|process-once|expire-once/);
  });

  test("la carga real suprime sólo el diagnóstico startup sensible del CLI", () => {
    const cliSource = fs.readFileSync(
      path.join(__dirname, "../src/shippingImportCli.js"),
      "utf8"
    );
    const configSource = fs.readFileSync(path.join(__dirname, "../src/config.js"), "utf8");

    expect(typeof loadShippingImportWorker).toBe("function");
    expect(cliSource).toMatch(/SHIPPING_IMPORT_CLI_MODE/);
    expect(configSource).toMatch(
      /if \(process\.env\.SHIPPING_IMPORT_CLI_MODE !== "true"\)[\s\S]*diagnostico webhook secret/
    );
    expect(require("../package.json").scripts.start).toBe("node index.js");
  });
});
