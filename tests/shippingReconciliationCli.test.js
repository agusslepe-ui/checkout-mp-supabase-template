const fs = require("fs");
const path = require("path");

const {
  parseArguments,
  runShippingReconciliation,
} = require("../src/shippingReconciliationCli");

function captureStream() {
  let output = "";
  return {
    stream: { write: jest.fn((value) => { output += value; }) },
    read: () => output,
  };
}

function validArgs(action = "mark-created") {
  return [
    "--execute",
    "--order-id=123",
    `--action=${action}`,
    action === "mark-created"
      ? "--confirm=provider-found"
      : "--confirm=provider-absence-confirmed",
  ];
}

function runOptions(overrides = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  return {
    options: {
      args: validArgs(),
      env: { SHIPPING_IMPORT_RECONCILIATION_ENABLED: "true" },
      stdout: stdout.stream,
      stderr: stderr.stream,
      ...overrides,
    },
    stdout,
    stderr,
  };
}

describe("shipping reconciliation CLI", () => {
  test.each([undefined, "false", "TRUE", "True", "1", "yes", "", "Infinity"])(
    "env %p bloquea antes de cargar Supabase",
    async (flag) => {
      const loadReconciliation = jest.fn();
      const stderr = captureStream();
      const env = flag === undefined ? {} : { SHIPPING_IMPORT_RECONCILIATION_ENABLED: flag };
      const exitCode = await runShippingReconciliation({
        args: validArgs(), env, loadReconciliation,
        stdout: captureStream().stream, stderr: stderr.stream,
      });
      expect(exitCode).toBe(1);
      expect(loadReconciliation).not.toHaveBeenCalled();
      expect(stderr.read()).toBe("[shipping-reconciliation] disabled\n");
    }
  );

  test("falta --execute y no carga configuraciÃ³n", async () => {
    const loadReconciliation = jest.fn();
    const args = validArgs().filter((argument) => argument !== "--execute");
    const stderr = captureStream();
    const exitCode = await runShippingReconciliation({
      args,
      env: { SHIPPING_IMPORT_RECONCILIATION_ENABLED: "true" },
      loadReconciliation,
      stdout: captureStream().stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(1);
    expect(loadReconciliation).not.toHaveBeenCalled();
    expect(stderr.read()).toBe("[shipping-reconciliation] disabled\n");
  });

  test.each([
    ["order id cero", ["--execute", "--order-id=0", "--action=mark-created", "--confirm=provider-found"]],
    ["order id no canÃ³nico", ["--execute", "--order-id=01", "--action=mark-created", "--confirm=provider-found"]],
    ["order id negativo", ["--execute", "--order-id=-1", "--action=mark-created", "--confirm=provider-found"]],
    ["order id decimal", ["--execute", "--order-id=1.0", "--action=mark-created", "--confirm=provider-found"]],
    ["order id exponencial", ["--execute", "--order-id=1e2", "--action=mark-created", "--confirm=provider-found"]],
    ["order id alfabetico", ["--execute", "--order-id=abc", "--action=mark-created", "--confirm=provider-found"]],
    ["order id whitespace", ["--execute", "--order-id= ", "--action=mark-created", "--confirm=provider-found"]],
    ["order id Infinity", ["--execute", "--order-id=Infinity", "--action=mark-created", "--confirm=provider-found"]],
    ["action invÃ¡lida", ["--execute", "--order-id=123", "--action=created", "--confirm=provider-found"]],
    ["confirm genÃ©rica", ["--execute", "--order-id=123", "--action=mark-created", "--confirm=yes"]],
    ["confirm cruzada created", ["--execute", "--order-id=123", "--action=mark-created", "--confirm=provider-absence-confirmed"]],
    ["confirm cruzada requeue", ["--execute", "--order-id=123", "--action=requeue", "--confirm=provider-found"]],
    ["argumento extra", [...validArgs(), "--force=true"]],
  ])("%s falla antes de RPC", async (description, args) => {
    const loadReconciliation = jest.fn();
    const stderr = captureStream();
    const exitCode = await runShippingReconciliation({
      args,
      env: { SHIPPING_IMPORT_RECONCILIATION_ENABLED: "true" },
      loadReconciliation,
      stdout: captureStream().stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(1);
    expect(loadReconciliation).not.toHaveBeenCalled();
    expect(stderr.read()).toBe("[shipping-reconciliation] invalid_arguments\n");
  });

  test("parser admite orden de flags sin relajar combinaciones", () => {
    expect(parseArguments([
      "--action=requeue",
      "--confirm=provider-absence-confirmed",
      "--execute",
      "--order-id=123",
    ])).toEqual({ orderId: "123", action: "requeue" });
  });

  test.each([
    ["mark-created", "markUnknownAsCreated", "created"],
    ["requeue", "requeueUnknown", "requeued"],
  ])("%s llama una sola acciÃ³n y retorna exit 0", async (action, method, outcome) => {
    const reconciliation = {
      markUnknownAsCreated: jest.fn(),
      requeueUnknown: jest.fn(),
    };
    reconciliation[method].mockResolvedValue({ outcome, orderId: "123", attemptCount: 4 });
    const loadReconciliation = jest.fn(() => reconciliation);
    const { options, stdout, stderr } = runOptions({
      args: validArgs(action), loadReconciliation,
    });

    const exitCode = await runShippingReconciliation(options);
    expect(exitCode).toBe(0);
    expect(loadReconciliation).toHaveBeenCalledTimes(1);
    expect(reconciliation[method]).toHaveBeenCalledTimes(1);
    expect(reconciliation[method]).toHaveBeenCalledWith({ orderId: "123" });
    const otherMethod = method === "markUnknownAsCreated" ? "requeueUnknown" : "markUnknownAsCreated";
    expect(reconciliation[otherMethod]).not.toHaveBeenCalled();
    expect(stdout.read()).toBe(
      `[shipping-reconciliation] outcome=${outcome} orderId=123\n`
    );
    expect(stderr.read()).toBe("");
  });

  test("no_change retorna exit 1 sin segunda operaciÃ³n", async () => {
    const markUnknownAsCreated = jest.fn(async () => ({
      outcome: "no_change", orderId: "123",
    }));
    const requeueUnknown = jest.fn();
    const { options, stdout } = runOptions({
      loadReconciliation: () => ({ markUnknownAsCreated, requeueUnknown }),
    });
    expect(await runShippingReconciliation(options)).toBe(1);
    expect(markUnknownAsCreated).toHaveBeenCalledTimes(1);
    expect(requeueUnknown).not.toHaveBeenCalled();
    expect(stdout.read()).toBe(
      "[shipping-reconciliation] outcome=no_change orderId=123\n"
    );
  });

  test("error inesperado queda sanitizado y retorna exit 1", async () => {
    const sensitive = "ana@example.test TOKEN EXT-ORDER";
    const { options, stdout, stderr } = runOptions({
      loadReconciliation: () => ({
        markUnknownAsCreated: jest.fn(async () => { throw new Error(sensitive); }),
      }),
    });
    expect(await runShippingReconciliation(options)).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe(
      "[shipping-reconciliation] errorType=unexpected_error\n"
    );
    expect(stderr.read()).not.toContain(sensitive);
  });

  test("entrypoint no contiene red, provider, loop ni endpoint", () => {
    const files = [
      "../src/shippingReconciliationCli.js",
      "../src/shippingReconciliation.js",
      "../scripts/shipping-reconcile-unknown.js",
    ];
    const source = files.map((file) =>
      fs.readFileSync(path.join(__dirname, file), "utf8")
    ).join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(|micorreo|\/shipping\/import|express\s*\(|\.listen\s*\(/i);
    expect(source).not.toMatch(/\bwhile\s*\(|setInterval|setTimeout/);
    expect(source).not.toMatch(/console\.(?:log|error)|error\.message|error\.stack/);
    expect(require("../package.json").scripts["shipping:reconcile-unknown"])
      .toBe("node scripts/shipping-reconcile-unknown.js");
    expect(require("../package.json").scripts.start).toBe("node index.js");
  });
});
