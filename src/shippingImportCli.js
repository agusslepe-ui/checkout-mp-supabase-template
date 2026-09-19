const PROCESS_OUTCOMES = new Set([
  "idle",
  "created",
  "retryable",
  "unknown",
  "failed",
  "lease_lost",
]);

function isManualExecutionEnabled(args, env) {
  return args.includes("--execute") && env.SHIPPING_IMPORT_MANUAL_EXECUTION === "true";
}

async function runManualShippingImport({
  operation,
  args = process.argv.slice(2),
  env = process.env,
  loadWorker = loadShippingImportWorker,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!isManualExecutionEnabled(args, env)) {
    writeLine(stderr, "[shipping-import] manual execution disabled");
    return 1;
  }

  try {
    const worker = loadWorker();
    const rawResult = operation === "process"
      ? await worker.processNextShippingImport()
      : operation === "expire"
        ? await worker.expireStaleShippingImportLeases()
        : null;
    const result = operation === "process"
      ? sanitizeProcessResult(rawResult)
      : operation === "expire"
        ? sanitizeExpireResult(rawResult)
        : null;

    if (!result) throw new Error("invalid manual operation result");
    writeLine(stdout, formatResult(result));
    return 0;
  } catch (error) {
    writeLine(stderr, "[shipping-import] outcome=error errorType=unexpected_error");
    return 1;
  }
}

function loadShippingImportWorker() {
  const variableName = "SHIPPING_IMPORT_CLI_MODE";
  const previousValue = process.env[variableName];
  process.env[variableName] = "true";
  try {
    return require("./shippingImportWorker");
  } finally {
    if (previousValue === undefined) delete process.env[variableName];
    else process.env[variableName] = previousValue;
  }
}

function sanitizeProcessResult(result) {
  if (!isPlainObject(result) || !PROCESS_OUTCOMES.has(result.outcome)) return null;
  if (result.outcome === "idle") return { outcome: "idle" };
  if (!isPositiveDatabaseId(result.orderId)) return null;

  const safe = { outcome: result.outcome, orderId: result.orderId };
  if (Number.isSafeInteger(result.attemptCount) && result.attemptCount >= 1) {
    safe.attemptCount = result.attemptCount;
  }
  return safe;
}

function sanitizeExpireResult(result) {
  if (!isPlainObject(result) || result.outcome !== "expired" ||
      !Number.isSafeInteger(result.count) || result.count < 0) return null;
  return { outcome: "expired", count: result.count };
}

function formatResult(result) {
  const fields = [`outcome=${result.outcome}`];
  if (Object.prototype.hasOwnProperty.call(result, "orderId")) {
    fields.push(`orderId=${result.orderId}`);
  }
  if (Object.prototype.hasOwnProperty.call(result, "attemptCount")) {
    fields.push(`attemptCount=${result.attemptCount}`);
  }
  if (Object.prototype.hasOwnProperty.call(result, "count")) {
    fields.push(`count=${result.count}`);
  }
  return `[shipping-import] ${fields.join(" ")}`;
}

function writeLine(stream, value) {
  stream.write(`${value}\n`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveDatabaseId(value) {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^[1-9][0-9]*$/.test(value));
}

module.exports = {
  isManualExecutionEnabled,
  loadShippingImportWorker,
  runManualShippingImport,
  sanitizeProcessResult,
  sanitizeExpireResult,
  formatResult,
};
