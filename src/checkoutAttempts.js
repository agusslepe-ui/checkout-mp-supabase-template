const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceRoleKey } = require("./config");
const { CHECKOUT_ATTEMPT_STATES } = require("./checkoutAttempt");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const STATE_VALUES = new Set(Object.values(CHECKOUT_ATTEMPT_STATES));
const ATTEMPT_COLUMNS = [
  "checkout_attempt_id", "order_id", "state", "mercadopago_preference_id",
  "checkout_url", "lease_token", "lease_expires_at",
].join(",");
const ORDER_COLUMNS = [
  "id", "external_reference", "products_subtotal", "shipping_amount", "amount",
  "currency", "status", "customer_first_name", "customer_last_name",
  "customer_email", "customer_phone", "shipping_province", "shipping_locality",
  "shipping_postal_code", "shipping_street", "shipping_street_number",
  "shipping_apartment", "shipping_notes", "shipping_option_id",
  "shipping_delivery_type", "shipping_service", "shipping_agency_code",
].join(",");
const ITEM_COLUMNS = "product_sku,product_name,product_size,quantity,unit_price";

class CheckoutAttemptRepositoryError extends Error {
  constructor(message = "invalid checkout attempt repository result") {
    super(message);
    this.name = "CheckoutAttemptRepositoryError";
  }
}

function createCheckoutAttemptsRepository(client = supabase) {
  async function findCheckoutAttempt(checkoutAttemptId) {
    const { data: attempt, error: attemptError } = await client
      .from("checkout_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("checkout_attempt_id", checkoutAttemptId)
      .maybeSingle();

    if (attemptError) throw attemptError;
    if (!attempt) return null;
    validateAttempt(attempt, checkoutAttemptId);

    const { data: order, error: orderError } = await client
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("id", attempt.order_id)
      .maybeSingle();
    if (orderError) throw orderError;
    validateOrder(order, attempt.order_id);

    const { data: items, error: itemsError } = await client
      .from("order_items")
      .select(ITEM_COLUMNS)
      .eq("order_id", attempt.order_id);
    if (itemsError) throw itemsError;
    validateItems(items);

    return { ...attempt, order: { ...order, items } };
  }

  async function claimCheckoutAttempt({ checkoutAttemptId, leaseToken, leaseExpiresAt }) {
    const { data, error } = await client
      .rpc("claim_checkout_attempt", {
        p_checkout_attempt_id: checkoutAttemptId,
        p_lease_token: leaseToken,
        p_lease_expires_at: leaseExpiresAt,
      })
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    validateAttempt(data, checkoutAttemptId);
    if (data.state !== CHECKOUT_ATTEMPT_STATES.CREATING_PREFERENCE ||
        data.lease_token !== leaseToken) {
      throw new CheckoutAttemptRepositoryError();
    }
    return data;
  }

  async function markCheckoutAttemptReady({
    checkoutAttemptId,
    leaseToken,
    preferenceId,
    checkoutUrl,
    updatedAt = new Date().toISOString(),
  }) {
    return updateClaimedAttempt({
      checkoutAttemptId,
      leaseToken,
      values: {
        state: CHECKOUT_ATTEMPT_STATES.READY,
        mercadopago_preference_id: preferenceId,
        checkout_url: checkoutUrl,
        lease_token: null,
        lease_expires_at: null,
        updated_at: updatedAt,
      },
      expectedState: CHECKOUT_ATTEMPT_STATES.READY,
    });
  }

  async function markCheckoutAttemptUnknown({
    checkoutAttemptId,
    leaseToken,
    updatedAt = new Date().toISOString(),
  }) {
    return updateClaimedAttempt({
      checkoutAttemptId,
      leaseToken,
      values: {
        state: CHECKOUT_ATTEMPT_STATES.UNKNOWN,
        mercadopago_preference_id: null,
        checkout_url: null,
        lease_token: null,
        lease_expires_at: null,
        updated_at: updatedAt,
      },
      expectedState: CHECKOUT_ATTEMPT_STATES.UNKNOWN,
    });
  }

  async function updateClaimedAttempt({
    checkoutAttemptId,
    leaseToken,
    values,
    expectedState,
  }) {
    const { data, error } = await client
      .from("checkout_attempts")
      .update(values)
      .eq("checkout_attempt_id", checkoutAttemptId)
      .eq("state", CHECKOUT_ATTEMPT_STATES.CREATING_PREFERENCE)
      .eq("lease_token", leaseToken)
      .select(ATTEMPT_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    validateAttempt(data, checkoutAttemptId);
    if (data.state !== expectedState) throw new CheckoutAttemptRepositoryError();
    return data;
  }

  return {
    findCheckoutAttempt,
    claimCheckoutAttempt,
    markCheckoutAttemptReady,
    markCheckoutAttemptUnknown,
  };
}

function validateAttempt(attempt, checkoutAttemptId) {
  if (!isPlainObject(attempt) || attempt.checkout_attempt_id !== checkoutAttemptId ||
      !isPositiveDatabaseId(attempt.order_id) || !STATE_VALUES.has(attempt.state) ||
      !isNullableString(attempt.mercadopago_preference_id) ||
      !isNullableString(attempt.checkout_url) || !isNullableString(attempt.lease_token) ||
      !isNullableString(attempt.lease_expires_at)) {
    throw new CheckoutAttemptRepositoryError();
  }
  const preferencePairIsNull = attempt.mercadopago_preference_id === null &&
    attempt.checkout_url === null;
  const leaseIsNull = attempt.lease_token === null && attempt.lease_expires_at === null;
  const stateIsCoherent = {
    [CHECKOUT_ATTEMPT_STATES.RESERVED]: preferencePairIsNull && leaseIsNull,
    [CHECKOUT_ATTEMPT_STATES.CREATING_PREFERENCE]: preferencePairIsNull &&
      isNonEmptyString(attempt.lease_token) && isNonEmptyString(attempt.lease_expires_at),
    [CHECKOUT_ATTEMPT_STATES.READY]: isNonEmptyString(attempt.mercadopago_preference_id) &&
      isNonEmptyString(attempt.checkout_url) && leaseIsNull,
    [CHECKOUT_ATTEMPT_STATES.UNKNOWN]: leaseIsNull &&
      ((attempt.mercadopago_preference_id === null && attempt.checkout_url === null) ||
        (isNonEmptyString(attempt.mercadopago_preference_id) &&
          isNonEmptyString(attempt.checkout_url))),
  }[attempt.state];
  if (!stateIsCoherent) throw new CheckoutAttemptRepositoryError();
}

function validateOrder(order, orderId) {
  const requiredStrings = [
    "external_reference", "currency", "status", "customer_first_name",
    "customer_last_name", "customer_email", "customer_phone", "shipping_province",
    "shipping_locality", "shipping_postal_code", "shipping_street",
    "shipping_street_number", "shipping_option_id", "shipping_delivery_type",
    "shipping_service",
  ];
  if (!isPlainObject(order) || String(order.id) !== String(orderId) ||
      !requiredStrings.every((field) => isNonEmptyString(order[field])) ||
      !["products_subtotal", "shipping_amount", "amount"]
        .every((field) => Number.isFinite(Number(order[field]))) ||
      !isNullableString(order.shipping_apartment) ||
      !isNullableString(order.shipping_notes) ||
      !isNullableString(order.shipping_agency_code)) {
    throw new CheckoutAttemptRepositoryError();
  }
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.some((item) =>
    !isPlainObject(item) || !isNonEmptyString(item.product_sku) ||
    !isNonEmptyString(item.product_name) || !isNullableString(item.product_size) ||
    (typeof item.product_size === "string" && !isNonEmptyString(item.product_size)) ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 1 || !Number.isFinite(Number(item.unit_price)) ||
    Number(item.unit_price) <= 0
  )) {
    throw new CheckoutAttemptRepositoryError();
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveDatabaseId(value) {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^[1-9][0-9]*$/.test(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

const CheckoutAttemptsRepository = createCheckoutAttemptsRepository();

module.exports = {
  CheckoutAttemptRepositoryError,
  createCheckoutAttemptsRepository,
  ...CheckoutAttemptsRepository,
};
