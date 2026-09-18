const crypto = require("crypto");

const { ShippingImportService, SHIPPING_IMPORT_ERROR_TYPES } = require("./shippingImportService");
const { ShippingImportsRepository } = require("./shippingImports");
const { ShippingProviderError } = require("./shippingProvider");

// Debe superar holgadamente el timeout HTTP actual de 8 s sin bloquear trabajos por minutos.
const SHIPPING_IMPORT_LEASE_MS = 60 * 1000;
const SHIPPING_IMPORT_MAX_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = Object.freeze([60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]);

const PERMANENT_ERROR_TYPES = new Set([
  SHIPPING_IMPORT_ERROR_TYPES.VALIDATION,
  SHIPPING_IMPORT_ERROR_TYPES.UNSUPPORTED_SERVICE,
  SHIPPING_IMPORT_ERROR_TYPES.PROVIDER_REJECTED,
]);
const AMBIGUOUS_ERROR_TYPES = new Set([
  SHIPPING_IMPORT_ERROR_TYPES.NETWORK,
  SHIPPING_IMPORT_ERROR_TYPES.TIMEOUT,
  SHIPPING_IMPORT_ERROR_TYPES.SERVER,
  SHIPPING_IMPORT_ERROR_TYPES.AMBIGUOUS_RESPONSE,
]);
const RETRYABLE_ERROR_TYPES = new Set([
  SHIPPING_IMPORT_ERROR_TYPES.RATE_LIMIT,
  SHIPPING_IMPORT_ERROR_TYPES.AUTH,
]);

class ShippingImportWorkerError extends Error {
  constructor(type) {
    super(type);
    this.name = "ShippingImportWorkerError";
    this.type = type;
  }
}

function createShippingImportWorker({
  repository = ShippingImportsRepository,
  service = ShippingImportService,
  createLeaseToken = () => crypto.randomUUID(),
  now = () => new Date(),
  leaseDurationMs = SHIPPING_IMPORT_LEASE_MS,
  maxAttempts = SHIPPING_IMPORT_MAX_ATTEMPTS,
  retryBackoffMs = RETRY_BACKOFF_MS,
} = {}) {
  validateWorkerConfiguration({ leaseDurationMs, maxAttempts, retryBackoffMs });

  async function processNextShippingImport() {
    const leaseToken = createLeaseToken();
    if (typeof leaseToken !== "string" || leaseToken.trim() === "") {
      throw new ShippingImportWorkerError("invalid_lease_token");
    }
    const claimTime = readNow(now);
    const leaseExpiresAt = new Date(claimTime.getTime() + leaseDurationMs).toISOString();
    const claim = await repository.claimNextShippingImport({ leaseToken, leaseExpiresAt });
    if (!claim) return { outcome: "idle" };

    const orderId = claim.order_id;
    const attemptCount = claim.attempt_count;
    let snapshot;

    try {
      snapshot = normalizeClaimForImport(claim);
    } catch (error) {
      const decision = decideFailure({ error, providerCallStarted: false, attemptCount, maxAttempts });
      return persistFailure({
        decision,
        orderId,
        leaseToken,
        attemptCount,
        repository,
        now,
        retryBackoffMs,
      });
    }

    let result;
    try {
      result = await service.importShipment(snapshot);
    } catch (error) {
      const decision = decideFailure({
        error,
        providerCallStarted: true,
        attemptCount,
        maxAttempts,
      });
      return persistFailure({
        decision,
        orderId,
        leaseToken,
        attemptCount,
        repository,
        now,
        retryBackoffMs,
      });
    }

    // Una falla de persistencia no dispara otra transición: el lease/recovery SQL
    // conserva la autoridad y expirará a unknown si no pudo cerrarse.
    const transitioned = await repository.completeShippingImport({
      orderId,
      leaseToken,
      providerCreatedAt: result.createdAt,
      importedAt: readNow(now).toISOString(),
    });
    return transitionResult(transitioned, "created", orderId, attemptCount);
  }

  async function expireStaleShippingImportLeases() {
    const expired = await repository.expireShippingImportLeases();
    return { outcome: "expired", count: expired.length };
  }

  return { processNextShippingImport, expireStaleShippingImportLeases };
}

function normalizeClaimForImport(claim) {
  if (!Number.isSafeInteger(claim.attempt_count) || claim.attempt_count < 1) {
    throw new ShippingImportWorkerError("invalid_snapshot");
  }
  return {
    ...claim,
    declared_value: normalizeDeclaredValue(claim.declared_value),
  };
}

function normalizeDeclaredValue(value) {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) return value;
    throw new ShippingImportWorkerError("invalid_snapshot");
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new ShippingImportWorkerError("invalid_snapshot");
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new ShippingImportWorkerError("invalid_snapshot");
  }
  return normalized;
}

function decideFailure({ error, providerCallStarted, attemptCount, maxAttempts }) {
  if (error instanceof ShippingImportWorkerError) {
    return { outcome: "failed", errorType: error.type };
  }
  if (!(error instanceof ShippingProviderError)) {
    return {
      outcome: providerCallStarted ? "unknown" : "failed",
      errorType: "internal_error",
    };
  }

  const errorType = normalizeErrorType(error.type);
  if ([SHIPPING_IMPORT_ERROR_TYPES.NETWORK, SHIPPING_IMPORT_ERROR_TYPES.TIMEOUT]
    .includes(error.type) && !error.requestAttempted &&
      !error.previousRequestAttempted && error.retryable) {
    return attemptCount >= maxAttempts
      ? { outcome: "failed", errorType: `${errorType}_attempt_limit` }
      : { outcome: "retryable", errorType };
  }
  if (error.type === SHIPPING_IMPORT_ERROR_TYPES.AUTH && error.requestAttempted) {
    return { outcome: "unknown", errorType };
  }
  if (error.previousRequestAttempted || error.ambiguous || AMBIGUOUS_ERROR_TYPES.has(error.type)) {
    return { outcome: "unknown", errorType };
  }
  if (PERMANENT_ERROR_TYPES.has(error.type)) {
    return { outcome: "failed", errorType };
  }
  if (RETRYABLE_ERROR_TYPES.has(error.type)) {
    return attemptCount >= maxAttempts
      ? { outcome: "failed", errorType: `${errorType}_attempt_limit` }
      : { outcome: "retryable", errorType };
  }
  return {
    outcome: providerCallStarted ? "unknown" : "failed",
    errorType: "internal_error",
  };
}

async function persistFailure({
  decision,
  orderId,
  leaseToken,
  attemptCount,
  repository,
  now,
  retryBackoffMs,
}) {
  let transitioned;
  if (decision.outcome === "retryable") {
    const delay = retryBackoffMs[attemptCount - 1];
    const nextAttemptAt = new Date(readNow(now).getTime() + delay).toISOString();
    transitioned = await repository.retryShippingImport({
      orderId,
      leaseToken,
      nextAttemptAt,
      errorType: decision.errorType,
    });
  } else if (decision.outcome === "unknown") {
    transitioned = await repository.markShippingImportUnknown({
      orderId,
      leaseToken,
      errorType: decision.errorType,
    });
  } else {
    transitioned = await repository.failShippingImport({
      orderId,
      leaseToken,
      errorType: decision.errorType,
    });
  }
  return transitionResult(transitioned, decision.outcome, orderId, attemptCount);
}

function transitionResult(row, outcome, orderId, attemptCount) {
  if (!row) return { outcome: "lease_lost", orderId };
  return { outcome, orderId, attemptCount };
}

function normalizeErrorType(value) {
  return typeof value === "string" && /^[A-Z_]+$/.test(value)
    ? value.toLowerCase()
    : "provider_error";
}

function readNow(now) {
  const value = now();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ShippingImportWorkerError("invalid_clock");
  return date;
}

function validateWorkerConfiguration({ leaseDurationMs, maxAttempts, retryBackoffMs }) {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0 ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 2 ||
      !Array.isArray(retryBackoffMs) || retryBackoffMs.length < maxAttempts - 1 ||
      retryBackoffMs.some((delay) => !Number.isSafeInteger(delay) || delay <= 0)) {
    throw new ShippingImportWorkerError("invalid_worker_configuration");
  }
}

const ShippingImportWorker = createShippingImportWorker();

module.exports = {
  SHIPPING_IMPORT_LEASE_MS,
  SHIPPING_IMPORT_MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  ShippingImportWorkerError,
  normalizeDeclaredValue,
  createShippingImportWorker,
  ShippingImportWorker,
  processNextShippingImport: ShippingImportWorker.processNextShippingImport,
  expireStaleShippingImportLeases: ShippingImportWorker.expireStaleShippingImportLeases,
};
