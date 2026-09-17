const crypto = require("crypto");
const { CHECKOUT_ATTEMPT_STATES, checkoutRequestMatchesSnapshot } = require("./checkoutAttempt");
const checkoutAttempts = require("./checkoutAttempts");
const { createPreference, searchPreferencesByExternalReference } = require("./payments");

const CHECKOUT_LEASE_MS = 30 * 1000;
const EXPECTED_ATTEMPT_UNIQUE_CONSTRAINT = "checkout_attempts_checkout_attempt_id_key";

class CheckoutFlowError extends Error {
  constructor(status, publicMessage, type) {
    super(type);
    this.name = "CheckoutFlowError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.type = type;
  }
}

async function processCheckoutAttempt({
  attempt,
  identity,
  baseUrl,
  now = Date.now,
  randomUUID = crypto.randomUUID,
  repository = checkoutAttempts,
  paymentGateway = { createPreference, searchPreferencesByExternalReference },
}) {
  ensureMatchingRequest(identity, attempt);

  if (attempt.state === CHECKOUT_ATTEMPT_STATES.READY) {
    ensureReadyOrderIsNotPaid(attempt);
    return readyResponse(attempt);
  }

  if (hasActiveLease(attempt, now())) {
    throw preparingError();
  }

  const needsRecovery = attempt.state === CHECKOUT_ATTEMPT_STATES.UNKNOWN ||
    attempt.state === CHECKOUT_ATTEMPT_STATES.CREATING_PREFERENCE;
  if (needsRecovery) {
    let recovery;
    try {
      recovery = await paymentGateway.searchPreferencesByExternalReference(
        attempt.order.external_reference
      );
    } catch {
      throw temporaryError("preference_recovery_failed");
    }

    if (recovery.count > 1) {
      const claim = await acquireClaim({ attempt, now, randomUUID, repository });
      if (!claim) return resolveClaimLoss({ attempt, identity, repository });
      await safelyMarkUnknown(attempt.checkout_attempt_id, claim.leaseToken, repository);
      throw temporaryError("preference_recovery_ambiguous");
    }

    if (recovery.count === 1) {
      const claim = await acquireClaim({ attempt, now, randomUUID, repository });
      if (!claim) return resolveClaimLoss({ attempt, identity, repository });
      const recovered = recovery.preference;
      const ready = await repository.markCheckoutAttemptReady({
        checkoutAttemptId: attempt.checkout_attempt_id,
        leaseToken: claim.leaseToken,
        preferenceId: recovered.id,
        checkoutUrl: recovered.checkout_url,
      });
      if (!ready) return resolveClaimLoss({ attempt, identity, repository });
      return readyResponse(ready);
    }
  }

  const claim = await acquireClaim({ attempt, now, randomUUID, repository });
  if (!claim) return resolveClaimLoss({ attempt, identity, repository });
  return createAndPersistPreference({
    attempt,
    claim,
    baseUrl,
    repository,
    paymentGateway,
  });
}

async function createAndPersistPreference({
  attempt,
  claim,
  baseUrl,
  repository,
  paymentGateway,
}) {
  let preferenceBody;
  try {
    preferenceBody = buildPreferenceFromSnapshot(attempt, baseUrl);
  } catch {
    await safelyMarkUnknown(attempt.checkout_attempt_id, claim.leaseToken, repository);
    throw temporaryError("persisted_snapshot_invalid");
  }

  try {
    const result = await paymentGateway.createPreference(preferenceBody);
    if (!isNonEmptyString(result?.id) || !isUsableCheckoutUrl(result?.init_point)) {
      throw new Error("invalid preference response");
    }
    const ready = await repository.markCheckoutAttemptReady({
      checkoutAttemptId: attempt.checkout_attempt_id,
      leaseToken: claim.leaseToken,
      preferenceId: result.id,
      checkoutUrl: result.init_point,
    });
    if (!ready) throw new Error("checkout attempt transition failed");
    return readyResponse(ready);
  } catch {
    await safelyMarkUnknown(attempt.checkout_attempt_id, claim.leaseToken, repository);
    throw temporaryError("preference_creation_ambiguous");
  }
}

function buildPreferenceFromSnapshot(attempt, baseUrl) {
  const order = attempt.order;
  if (order.status !== "pending") throw new Error("invalid persisted order state");
  const items = order.items.map((item) => ({
    title: isNonEmptyString(item.product_size)
      ? `${item.product_name} - Talle ${item.product_size}`
      : item.product_name,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    currency_id: order.currency,
  }));
  items.push({
    title: "Envío",
    quantity: 1,
    unit_price: Number(order.shipping_amount),
    currency_id: order.currency,
  });
  if (getPreferenceTotalCents(items) !== toCents(order.amount)) {
    throw new Error("persisted preference total mismatch");
  }
  return {
    items,
    external_reference: order.external_reference,
    notification_url: `${baseUrl}/webhook?source_news=webhooks`,
    back_urls: {
      success: `${baseUrl}/success`,
      failure: `${baseUrl}/failure`,
      pending: `${baseUrl}/pending`,
    },
    auto_return: "approved",
  };
}

async function acquireClaim({ attempt, now, randomUUID, repository }) {
  const nowMs = now();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(nowMs + CHECKOUT_LEASE_MS).toISOString();
  const claimed = await repository.claimCheckoutAttempt({
    checkoutAttemptId: attempt.checkout_attempt_id,
    leaseToken,
    leaseExpiresAt,
  });
  return claimed ? { leaseToken, leaseExpiresAt } : null;
}

async function resolveClaimLoss({ attempt, identity, repository }) {
  const current = await repository.findCheckoutAttempt(attempt.checkout_attempt_id);
  if (!current) throw temporaryError("checkout_attempt_disappeared");
  ensureMatchingRequest(identity, current);
  if (current.state === CHECKOUT_ATTEMPT_STATES.READY) {
    ensureReadyOrderIsNotPaid(current);
    return readyResponse(current);
  }
  throw preparingError();
}

async function safelyMarkUnknown(checkoutAttemptId, leaseToken, repository) {
  try {
    await repository.markCheckoutAttemptUnknown({ checkoutAttemptId, leaseToken });
  } catch {
    // The public result remains temporary/ambiguous. Never expose persistence details.
  }
}

function ensureMatchingRequest(identity, attempt) {
  if (!checkoutRequestMatchesSnapshot(identity, attempt)) {
    throw new CheckoutFlowError(
      409,
      "El intento de pago no coincide con la compra original",
      "checkout_attempt_mismatch"
    );
  }
}

function ensureReadyOrderIsNotPaid(attempt) {
  if (attempt.order?.status === "paid") {
    throw new CheckoutFlowError(
      409,
      "Esta compra ya fue pagada.",
      "checkout_attempt_already_paid"
    );
  }
}

function readyResponse(attempt) {
  if (!isNonEmptyString(attempt.mercadopago_preference_id) ||
      !isUsableCheckoutUrl(attempt.checkout_url)) {
    throw temporaryError("ready_attempt_invalid");
  }
  return {
    preference_id: attempt.mercadopago_preference_id,
    init_point: attempt.checkout_url,
  };
}

function hasActiveLease(attempt, nowMs) {
  if (attempt.state !== CHECKOUT_ATTEMPT_STATES.CREATING_PREFERENCE) return false;
  const expiresAt = Date.parse(attempt.lease_expires_at);
  if (!Number.isFinite(expiresAt)) throw temporaryError("invalid_checkout_lease");
  return expiresAt > nowMs;
}

function isCheckoutAttemptUniqueViolation(error) {
  if (error?.code !== "23505") return false;
  if (error?.constraint === EXPECTED_ATTEMPT_UNIQUE_CONSTRAINT) return true;
  const safeDatabaseText = [error?.message, error?.details]
    .filter((value) => typeof value === "string")
    .join(" ");
  return safeDatabaseText.includes(EXPECTED_ATTEMPT_UNIQUE_CONSTRAINT);
}

function getPreferenceTotalCents(items) {
  return items.reduce((total, item) => {
    const unitCents = toCents(item.unit_price);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error("invalid persisted quantity");
    }
    const next = total + unitCents * item.quantity;
    if (!Number.isSafeInteger(next)) throw new Error("invalid persisted total");
    return next;
  }, 0);
}

function toCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("invalid persisted amount");
  return cents;
}

function isUsableCheckoutUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function preparingError() {
  return new CheckoutFlowError(
    409,
    "El checkout está siendo preparado. Intentá nuevamente",
    "checkout_attempt_busy"
  );
}

function temporaryError(type) {
  return new CheckoutFlowError(503, "No se pudo iniciar el pago", type);
}

module.exports = {
  CHECKOUT_LEASE_MS,
  EXPECTED_ATTEMPT_UNIQUE_CONSTRAINT,
  CheckoutFlowError,
  processCheckoutAttempt,
  buildPreferenceFromSnapshot,
  isCheckoutAttemptUniqueViolation,
};
