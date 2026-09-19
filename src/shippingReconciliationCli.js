const ACTIONS = Object.freeze({
  MARK_CREATED: "mark-created",
  REQUEUE: "requeue",
});

function isReconciliationEnabled(args, env) {
  return args.includes("--execute") &&
    env.SHIPPING_IMPORT_RECONCILIATION_ENABLED === "true";
}

async function runShippingReconciliation({
  args = process.argv.slice(2),
  env = process.env,
  loadReconciliation = loadShippingReconciliation,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!isReconciliationEnabled(args, env)) {
    writeLine(stderr, "[shipping-reconciliation] disabled");
    return 1;
  }

  const parsed = parseArguments(args);
  if (!parsed) {
    writeLine(stderr, "[shipping-reconciliation] invalid_arguments");
    return 1;
  }

  try {
    const reconciliation = loadReconciliation();
    const result = parsed.action === ACTIONS.MARK_CREATED
      ? await reconciliation.markUnknownAsCreated({ orderId: parsed.orderId })
      : await reconciliation.requeueUnknown({ orderId: parsed.orderId });
    const safeResult = sanitizeResult(result, parsed.orderId);
    if (!safeResult) throw new Error("invalid reconciliation result");

    writeLine(stdout, formatResult(safeResult));
    return safeResult.outcome === "no_change" ? 1 : 0;
  } catch (error) {
    writeLine(stderr, "[shipping-reconciliation] errorType=unexpected_error");
    return 1;
  }
}

function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 4 ||
      args.filter((argument) => argument === "--execute").length !== 1) return null;

  const values = {};
  for (const argument of args.filter((value) => value !== "--execute")) {
    const match = /^--(order-id|action|confirm)=(.+)$/.exec(argument);
    if (!match || Object.prototype.hasOwnProperty.call(values, match[1])) return null;
    values[match[1]] = match[2];
  }

  if (!isCanonicalDatabaseId(values["order-id"])) return null;
  const confirmationMatches =
    (values.action === ACTIONS.MARK_CREATED && values.confirm === "provider-found") ||
    (values.action === ACTIONS.REQUEUE && values.confirm === "provider-absence-confirmed");
  if (!confirmationMatches) return null;

  return { orderId: values["order-id"], action: values.action };
}

function loadShippingReconciliation() {
  const variableName = "SHIPPING_IMPORT_CLI_MODE";
  const previousValue = process.env[variableName];
  process.env[variableName] = "true";
  try {
    return require("./shippingReconciliation");
  } finally {
    if (previousValue === undefined) delete process.env[variableName];
    else process.env[variableName] = previousValue;
  }
}

function sanitizeResult(result, expectedOrderId) {
  if (!isPlainObject(result) || !["created", "requeued", "no_change"].includes(result.outcome) ||
      !isPositiveDatabaseId(result.orderId) || String(result.orderId) !== String(expectedOrderId)) {
    return null;
  }
  return { outcome: result.outcome, orderId: result.orderId };
}

function formatResult(result) {
  return `[shipping-reconciliation] outcome=${result.outcome} orderId=${result.orderId}`;
}

function writeLine(stream, value) {
  stream.write(`${value}\n`);
}

function isPositiveDatabaseId(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return isCanonicalDatabaseId(value);
}

function isCanonicalDatabaseId(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  ACTIONS,
  isReconciliationEnabled,
  loadShippingReconciliation,
  parseArguments,
  runShippingReconciliation,
  sanitizeResult,
  formatResult,
};
