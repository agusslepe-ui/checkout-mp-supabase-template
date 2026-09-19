const {
  loadShippingImportWorker,
  sanitizeProcessResult,
} = require("./shippingImportCli");

const DEFAULT_INTERVAL_MS = 60 * 1000;
const MIN_INTERVAL_MS = 10 * 1000;
const MAX_CONSECUTIVE_ERRORS = 5;
const SHUTDOWN_TIMEOUT_MS = 30 * 1000;

function parseWorkerInterval(value) {
  if (value === undefined || value === "") return DEFAULT_INTERVAL_MS;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("invalid worker interval");
  }
  const intervalMs = Number(value);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    throw new Error("invalid worker interval");
  }
  return intervalMs;
}

function createShippingPollingWorker({
  processNextShippingImport,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxConsecutiveErrors = MAX_CONSECUTIVE_ERRORS,
  shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS,
  stdout = process.stdout,
  stderr = process.stderr,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onFatal = () => {},
} = {}) {
  validateConfiguration({
    processNextShippingImport,
    intervalMs,
    maxConsecutiveErrors,
    shutdownTimeoutMs,
  });

  let started = false;
  let stopping = false;
  let stopped = false;
  let scheduledTimer = null;
  let activeCycle = null;
  let consecutiveErrors = 0;
  let fatalPending = false;
  let fatalReported = false;
  let shutdownTimedOut = false;

  function start() {
    if (started) return activeCycle;
    started = true;
    writeLine(stdout, `[shipping-worker] started intervalMs=${intervalMs}`);
    return startCycle();
  }

  function startCycle() {
    if (stopping || activeCycle) return activeCycle;
    activeCycle = runCycle().finally(() => {
      activeCycle = null;
      if (fatalPending && !fatalReported) {
        fatalReported = true;
        stopped = true;
        writeLine(stdout, "[shipping-worker] stopped");
        onFatal(1);
      } else if (!stopping) {
        scheduleNextCycle();
      }
    });
    return activeCycle;
  }

  async function runCycle() {
    try {
      const result = sanitizeProcessResult(await processNextShippingImport());
      if (!result) throw new Error("invalid worker result");
      consecutiveErrors = 0;
      writeLine(stdout, formatWorkerResult(result));
    } catch (error) {
      consecutiveErrors += 1;
      writeLine(
        stderr,
        `[shipping-worker] errorType=unexpected_error consecutiveErrors=${consecutiveErrors}`
      );
      if (consecutiveErrors >= maxConsecutiveErrors) {
        stopping = true;
        fatalPending = true;
        writeLine(stdout, "[shipping-worker] stopping");
      }
    }
  }

  function scheduleNextCycle() {
    if (stopping || scheduledTimer !== null) return;
    scheduledTimer = setTimer(() => {
      scheduledTimer = null;
      return startCycle();
    }, intervalMs);
  }

  async function stop() {
    if (stopped) return 0;
    if (shutdownTimedOut) return 1;
    if (!stopping) {
      stopping = true;
      writeLine(stdout, "[shipping-worker] stopping");
    }
    if (scheduledTimer !== null) {
      clearTimer(scheduledTimer);
      scheduledTimer = null;
    }

    const completed = await waitForActiveCycle(activeCycle, {
      timeoutMs: shutdownTimeoutMs,
      setTimer,
      clearTimer,
    });
    if (!completed) {
      shutdownTimedOut = true;
      writeLine(stderr, "[shipping-worker] shutdown_timeout");
      return 1;
    }
    stopped = true;
    writeLine(stdout, "[shipping-worker] stopped");
    return 0;
  }

  function getState() {
    return {
      started,
      stopping,
      stopped,
      running: activeCycle !== null,
      consecutiveErrors,
      fatal: fatalPending,
      shutdownTimedOut,
    };
  }

  return { start, stop, getState };
}

function startShippingWorkerProcess({
  env = process.env,
  processObject = process,
  stdout = process.stdout,
  stderr = process.stderr,
  loadWorker = loadShippingImportWorker,
  createPollingWorker = createShippingPollingWorker,
  onFatal = (exitCode) => {
    processObject.exitCode = exitCode;
  },
} = {}) {
  if (env.SHIPPING_IMPORT_WORKER_ENABLED !== "true") {
    writeLine(stderr, "[shipping-worker] disabled");
    return { started: false, exitCode: 1 };
  }

  let pollingWorker;
  try {
    const intervalMs = parseWorkerInterval(env.SHIPPING_IMPORT_WORKER_INTERVAL_MS);
    const worker = loadWorker();
    pollingWorker = createPollingWorker({
      processNextShippingImport: worker.processNextShippingImport,
      intervalMs,
      stdout,
      stderr,
      onFatal: (exitCode) => {
        removeSignalHandlers();
        onFatal(exitCode);
      },
    });
  } catch (error) {
    writeLine(stderr, "[shipping-worker] errorType=configuration_error");
    return { started: false, exitCode: 1 };
  }

  let signalHandled = false;
  const handleSignal = async () => {
    if (signalHandled) return;
    signalHandled = true;
    const exitCode = await pollingWorker.stop();
    processObject.exitCode = exitCode;
    removeSignalHandlers();
  };
  function removeSignalHandlers() {
    processObject.removeListener("SIGTERM", handleSignal);
    processObject.removeListener("SIGINT", handleSignal);
  }

  processObject.once("SIGTERM", handleSignal);
  processObject.once("SIGINT", handleSignal);
  pollingWorker.start();
  return { started: true, exitCode: null, pollingWorker };
}

function formatWorkerResult(result) {
  const fields = [`outcome=${result.outcome}`];
  if (Object.prototype.hasOwnProperty.call(result, "orderId")) {
    fields.push(`orderId=${result.orderId}`);
  }
  if (Object.prototype.hasOwnProperty.call(result, "attemptCount")) {
    fields.push(`attemptCount=${result.attemptCount}`);
  }
  return `[shipping-worker] ${fields.join(" ")}`;
}

async function waitForActiveCycle(activeCycle, { timeoutMs, setTimer, clearTimer }) {
  if (!activeCycle) return true;
  let timeoutHandle;
  const completed = await Promise.race([
    activeCycle.then(() => true, () => true),
    new Promise((resolve) => {
      timeoutHandle = setTimer(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeoutHandle !== undefined) clearTimer(timeoutHandle);
  return completed;
}

function validateConfiguration({
  processNextShippingImport,
  intervalMs,
  maxConsecutiveErrors,
  shutdownTimeoutMs,
}) {
  if (typeof processNextShippingImport !== "function" ||
      !Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS ||
      !Number.isSafeInteger(maxConsecutiveErrors) || maxConsecutiveErrors < 1 ||
      !Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
    throw new Error("invalid polling worker configuration");
  }
}

function writeLine(stream, value) {
  stream.write(`${value}\n`);
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  MAX_CONSECUTIVE_ERRORS,
  SHUTDOWN_TIMEOUT_MS,
  parseWorkerInterval,
  createShippingPollingWorker,
  startShippingWorkerProcess,
  formatWorkerResult,
};
