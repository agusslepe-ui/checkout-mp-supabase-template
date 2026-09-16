const CHECKOUT_ATTEMPT_STATES = Object.freeze({
  RESERVED: "reserved",
  CREATING_PREFERENCE: "creating_preference",
  READY: "ready",
  UNKNOWN: "unknown",
});

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CheckoutAttemptIdError extends Error {
  constructor() {
    super("invalid checkout attempt id");
    this.name = "CheckoutAttemptIdError";
  }
}

function normalizeCheckoutAttemptId(value) {
  if (typeof value !== "string") throw new CheckoutAttemptIdError();

  const normalized = value.trim().toLowerCase();
  if (!CANONICAL_UUID_PATTERN.test(normalized)) {
    throw new CheckoutAttemptIdError();
  }

  return normalized;
}

module.exports = {
  CHECKOUT_ATTEMPT_STATES,
  CheckoutAttemptIdError,
  normalizeCheckoutAttemptId,
};
