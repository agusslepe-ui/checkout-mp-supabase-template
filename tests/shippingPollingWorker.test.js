const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");

const {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  MAX_CONSECUTIVE_ERRORS,
  parseWorkerInterval,
  createShippingPollingWorker,
  startShippingWorkerProcess,
} = require("../src/shippingPollingWorker");
const { main: runWorkerEntrypoint } = require("../scripts/shipping-worker");

function captureStream() {
  let output = "";
  return {
    stream: { write: jest.fn((value) => { output += value; }) },
    read: () => output,
  };
}

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer: jest.fn((callback, delay) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    }),
    clearTimer: jest.fn((id) => timers.delete(id)),
    count: () => timers.size,
    delays: () => [...timers.values()].map(({ delay }) => delay),
    async runNext() {
      const first = timers.entries().next();
      if (first.done) throw new Error("no scheduled timer");
      const [id, timer] = first.value;
      timers.delete(id);
      return timer.callback();
    },
  };
}

function createController({ processNextShippingImport, ...overrides } = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  const timers = createTimerHarness();
  const onFatal = jest.fn();
  const controller = createShippingPollingWorker({
    processNextShippingImport: processNextShippingImport || jest.fn(async () => ({
      outcome: "idle",
    })),
    stdout: stdout.stream,
    stderr: stderr.stream,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onFatal,
    ...overrides,
  });
  return { controller, stdout, stderr, timers, onFatal };
}

describe("worker automático aislado de shipping import", () => {
  test.each([undefined, "", "false", "TRUE", "1", "yes", "Infinity"])(
    "ENABLED=%p no carga ni inicia el worker",
    (enabled) => {
      const env = enabled === undefined ? {} : { SHIPPING_IMPORT_WORKER_ENABLED: enabled };
      const loadWorker = jest.fn();
      const stderr = captureStream();
      const processObject = new EventEmitter();

      const result = startShippingWorkerProcess({
        env,
        processObject,
        loadWorker,
        stdout: captureStream().stream,
        stderr: stderr.stream,
      });

      expect(result).toEqual({ started: false, exitCode: 1 });
      expect(loadWorker).not.toHaveBeenCalled();
      expect(stderr.read()).toBe("[shipping-worker] disabled\n");
    }
  );

  test("enabled carga composición e inicia exactamente una vez", () => {
    const start = jest.fn();
    const createPollingWorker = jest.fn(() => ({ start, stop: jest.fn() }));
    const processNextShippingImport = jest.fn();
    const loadWorker = jest.fn(() => ({ processNextShippingImport }));
    const processObject = new EventEmitter();

    const result = startShippingWorkerProcess({
      env: { SHIPPING_IMPORT_WORKER_ENABLED: "true" },
      processObject,
      loadWorker,
      createPollingWorker,
      stdout: captureStream().stream,
      stderr: captureStream().stream,
    });

    expect(result.started).toBe(true);
    expect(loadWorker).toHaveBeenCalledTimes(1);
    expect(createPollingWorker).toHaveBeenCalledWith(expect.objectContaining({
      processNextShippingImport,
      intervalMs: DEFAULT_INTERVAL_MS,
    }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  test("intervalo inválido falla antes de cargar la composición", () => {
    const loadWorker = jest.fn();
    const stderr = captureStream();
    const result = startShippingWorkerProcess({
      env: {
        SHIPPING_IMPORT_WORKER_ENABLED: "true",
        SHIPPING_IMPORT_WORKER_INTERVAL_MS: "9999",
      },
      processObject: new EventEmitter(),
      loadWorker,
      stdout: captureStream().stream,
      stderr: stderr.stream,
    });

    expect(result).toEqual({ started: false, exitCode: 1 });
    expect(loadWorker).not.toHaveBeenCalled();
    expect(stderr.read()).toBe("[shipping-worker] errorType=configuration_error\n");
  });

  test.each([
    [undefined, DEFAULT_INTERVAL_MS],
    ["", DEFAULT_INTERVAL_MS],
    [String(MIN_INTERVAL_MS), MIN_INTERVAL_MS],
    ["60000", 60000],
  ])("intervalo %p se normaliza a %i", (value, expected) => {
    expect(parseWorkerInterval(value)).toBe(expected);
  });

  test.each(["0", "-1", "9999", "1.5", "NaN", " 60000", "60000 ", "yes", 60000])(
    "intervalo inválido %p se rechaza",
    (value) => {
      expect(() => parseWorkerInterval(value)).toThrow("invalid worker interval");
    }
  );

  test.each([
    [{ outcome: "idle" }, "[shipping-worker] outcome=idle\n"],
    [{ outcome: "created", orderId: 11, attemptCount: 1 },
      "[shipping-worker] outcome=created orderId=11 attemptCount=1\n"],
    [{ outcome: "retryable", orderId: 12, attemptCount: 2 },
      "[shipping-worker] outcome=retryable orderId=12 attemptCount=2\n"],
    [{ outcome: "unknown", orderId: 13, attemptCount: 1 },
      "[shipping-worker] outcome=unknown orderId=13 attemptCount=1\n"],
    [{ outcome: "failed", orderId: 14, attemptCount: 4 },
      "[shipping-worker] outcome=failed orderId=14 attemptCount=4\n"],
    [{ outcome: "lease_lost", orderId: 15 },
      "[shipping-worker] outcome=lease_lost orderId=15\n"],
  ])("outcome controlado %p programa sólo el ciclo siguiente", async (result, expected) => {
    const processNextShippingImport = jest.fn(async () => result);
    const { controller, stdout, stderr, timers } = createController({
      processNextShippingImport,
    });

    await controller.start();

    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(stdout.read()).toContain(expected);
    expect(stderr.read()).toBe("");
    expect(timers.count()).toBe(1);
    expect(timers.delays()).toEqual([DEFAULT_INTERVAL_MS]);
  });

  test("cada timer ejecuta una sola orden y no drena la cola", async () => {
    const processNextShippingImport = jest.fn(async () => ({ outcome: "idle" }));
    const { controller, timers } = createController({ processNextShippingImport });

    await controller.start();
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);

    await timers.runNext();
    expect(processNextShippingImport).toHaveBeenCalledTimes(2);
    expect(timers.count()).toBe(1);
  });

  test("no superpone ciclos mientras la operación está activa", async () => {
    let resolveOperation;
    const operation = new Promise((resolve) => { resolveOperation = resolve; });
    const processNextShippingImport = jest.fn(() => operation);
    const { controller, timers } = createController({ processNextShippingImport });

    const firstCycle = controller.start();

    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(controller.getState().running).toBe(true);
    expect(timers.count()).toBe(0);

    resolveOperation({ outcome: "idle" });
    await firstCycle;

    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(timers.count()).toBe(1);
  });

  test("error inesperado se sanitiza y el próximo ciclo continúa", async () => {
    const sensitive = "ana@example.test secret stack Calle 123";
    const processNextShippingImport = jest
      .fn()
      .mockRejectedValueOnce(new Error(sensitive))
      .mockResolvedValueOnce({ outcome: "idle" });
    const { controller, stdout, stderr, timers } = createController({
      processNextShippingImport,
    });

    await controller.start();
    expect(stderr.read()).toBe(
      "[shipping-worker] errorType=unexpected_error consecutiveErrors=1\n"
    );
    expect(stderr.read()).not.toContain(sensitive);
    expect(timers.count()).toBe(1);

    await timers.runNext();
    expect(processNextShippingImport).toHaveBeenCalledTimes(2);
    expect(stdout.read()).toContain("outcome=idle");
    expect(controller.getState().consecutiveErrors).toBe(0);
  });

  test("resultado controlado resetea el contador de errores", async () => {
    const processNextShippingImport = jest
      .fn()
      .mockRejectedValueOnce(new Error("one"))
      .mockRejectedValueOnce(new Error("two"))
      .mockResolvedValueOnce({ outcome: "idle" })
      .mockRejectedValueOnce(new Error("three"));
    const { controller, timers } = createController({ processNextShippingImport });

    await controller.start();
    await timers.runNext();
    expect(controller.getState().consecutiveErrors).toBe(2);
    await timers.runNext();
    expect(controller.getState().consecutiveErrors).toBe(0);
    await timers.runNext();
    expect(controller.getState().consecutiveErrors).toBe(1);
  });

  test("errores 1-4 continúan y el quinto reporta fatal una vez después del ciclo", async () => {
    const processNextShippingImport = jest.fn(async () => {
      throw new Error("private detail");
    });
    const stdout = captureStream();
    const stderr = captureStream();
    const timers = createTimerHarness();
    let controller;
    let stateAtFatal;
    const onFatal = jest.fn(() => {
      stateAtFatal = controller.getState();
    });
    controller = createShippingPollingWorker({
      processNextShippingImport,
      stdout: stdout.stream,
      stderr: stderr.stream,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      onFatal,
    });

    await controller.start();
    for (let index = 1; index < MAX_CONSECUTIVE_ERRORS; index += 1) {
      expect(onFatal).not.toHaveBeenCalled();
      expect(timers.count()).toBe(1);
      await timers.runNext();
    }

    expect(processNextShippingImport).toHaveBeenCalledTimes(MAX_CONSECUTIVE_ERRORS);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledWith(1);
    expect(stateAtFatal).toEqual(expect.objectContaining({
      running: false,
      stopping: true,
      stopped: true,
      fatal: true,
    }));
    expect(stderr.read()).toContain(`consecutiveErrors=${MAX_CONSECUTIVE_ERRORS}`);
    expect(stdout.read()).toContain("[shipping-worker] stopping\n");
    expect(stdout.read()).toContain("[shipping-worker] stopped\n");
    expect(timers.count()).toBe(0);

    await controller.stop();
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  test("el entrypoint termina explícitamente sólo al recibir fatal", () => {
    let fatalCallback;
    const startWorkerProcess = jest.fn(({ onFatal }) => {
      fatalCallback = onFatal;
      return { started: true, exitCode: null };
    });
    const terminate = jest.fn();
    const processObject = { exitCode: undefined };

    runWorkerEntrypoint({ startWorkerProcess, terminate, processObject });
    expect(terminate).not.toHaveBeenCalled();

    fatalCallback(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledWith(1);
  });

  test("shutdown cancela el próximo ciclo y no crea otro claim", async () => {
    const processNextShippingImport = jest.fn(async () => ({ outcome: "idle" }));
    const { controller, stdout, timers } = createController({ processNextShippingImport });

    await controller.start();
    expect(timers.count()).toBe(1);
    const exitCode = await controller.stop();

    expect(exitCode).toBe(0);
    expect(timers.count()).toBe(0);
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(stdout.read()).toContain("[shipping-worker] stopping\n");
    expect(stdout.read()).toContain("[shipping-worker] stopped\n");
  });

  test("shutdown espera una iteración activa sin programar otra", async () => {
    let resolveOperation;
    const operation = new Promise((resolve) => { resolveOperation = resolve; });
    const processNextShippingImport = jest.fn(() => operation);
    const { controller, stdout, timers } = createController({ processNextShippingImport });

    controller.start();
    const stopping = controller.stop();
    expect(controller.getState().stopping).toBe(true);
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(stdout.read()).toContain("[shipping-worker] stopping\n");
    expect(stdout.read()).not.toContain("[shipping-worker] stopped\n");

    resolveOperation({ outcome: "created", orderId: 22, attemptCount: 1 });
    await expect(stopping).resolves.toBe(0);
    expect(stdout.read()).toContain("[shipping-worker] stopped\n");
    expect(timers.count()).toBe(0);
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
  });

  test("shutdown vence con exit 1 si la iteración no termina dentro del límite", async () => {
    let resolveOperation;
    const operation = new Promise((resolve) => { resolveOperation = resolve; });
    const processNextShippingImport = jest.fn(() => operation);
    const { controller, stdout, stderr, timers } = createController({
      processNextShippingImport,
      shutdownTimeoutMs: 25,
    });

    controller.start();
    const stopping = controller.stop();
    expect(timers.delays()).toEqual([25]);
    await timers.runNext();
    await expect(stopping).resolves.toBe(1);
    expect(stderr.read()).toContain("[shipping-worker] shutdown_timeout\n");
    expect(stdout.read()).toContain("[shipping-worker] stopping\n");
    expect(stdout.read()).not.toContain("[shipping-worker] stopped\n");
    expect(controller.getState()).toEqual(expect.objectContaining({
      stopping: true,
      stopped: false,
      running: true,
      shutdownTimedOut: true,
    }));
    expect(timers.count()).toBe(0);

    resolveOperation({ outcome: "idle" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(processNextShippingImport).toHaveBeenCalledTimes(1);
    expect(timers.count()).toBe(0);
    expect(stdout.read()).not.toContain("[shipping-worker] stopped\n");
    await expect(controller.stop()).resolves.toBe(1);
    expect(stdout.read()).not.toContain("[shipping-worker] stopped\n");
  });

  test.each(["SIGTERM", "SIGINT"])("%s ejecuta shutdown una sola vez", async (signal) => {
    const stop = jest.fn(async () => 0);
    const processObject = new EventEmitter();
    processObject.exitCode = undefined;
    const result = startShippingWorkerProcess({
      env: { SHIPPING_IMPORT_WORKER_ENABLED: "true" },
      processObject,
      loadWorker: () => ({ processNextShippingImport: jest.fn() }),
      createPollingWorker: () => ({ start: jest.fn(), stop }),
      stdout: captureStream().stream,
      stderr: captureStream().stream,
    });

    processObject.emit(signal);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.started).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(processObject.exitCode).toBe(0);
    expect(processObject.listenerCount("SIGTERM")).toBe(0);
    expect(processObject.listenerCount("SIGINT")).toBe(0);
  });

  test("package mantiene web/manual y agrega sólo el proceso worker separado", () => {
    const packageJson = require("../package.json");
    expect(packageJson.scripts.start).toBe("node index.js");
    expect(packageJson.scripts["shipping:worker"]).toBe("node scripts/shipping-worker.js");
    expect(packageJson.scripts["shipping:process-once"]).toBe(
      "node scripts/shipping-process-once.js"
    );
    expect(packageJson.scripts["shipping:expire-once"]).toBe(
      "node scripts/shipping-expire-once.js"
    );
    expect(packageJson.scripts).not.toHaveProperty("prestart");
    expect(packageJson.scripts).not.toHaveProperty("poststart");
  });

  test("entrypoint automático no importa Express ni expire leases", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../scripts/shipping-worker.js"),
      "utf8"
    );
    expect(source).not.toMatch(/express|index\.js|app\.js|expireStaleShippingImportLeases/);
  });
});
