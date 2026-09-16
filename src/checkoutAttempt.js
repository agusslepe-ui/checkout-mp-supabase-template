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

class CheckoutAttemptRequestError extends Error {
  constructor() {
    super("invalid checkout attempt request");
    this.name = "CheckoutAttemptRequestError";
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

function buildCheckoutRequestIdentity({ body, checkoutInput, shippingOptionId, shippingAgencyCode }) {
  const products = normalizeProducts(body);
  const isAgency = shippingOptionId.startsWith("micorreo:agency:");
  return {
    products,
    customer: {
      firstName: checkoutInput.customer_first_name,
      lastName: checkoutInput.customer_last_name,
      email: checkoutInput.customer_email,
      phone: checkoutInput.customer_phone,
    },
    delivery: {
      province: checkoutInput.shipping_province,
      locality: checkoutInput.shipping_locality,
      postalCode: checkoutInput.shipping_postal_code,
      street: checkoutInput.shipping_street,
      streetNumber: checkoutInput.shipping_street_number,
      apartment: checkoutInput.shipping_apartment,
      notes: checkoutInput.shipping_notes,
    },
    shippingOptionId,
    shippingAgencyCode: isAgency ? shippingAgencyCode : null,
  };
}

function checkoutRequestMatchesSnapshot(identity, snapshot) {
  const order = snapshot?.order;
  if (!order || !Array.isArray(order.items)) return false;

  let persistedProducts;
  try {
    persistedProducts = groupProducts(order.items.map((item) => ({
      sku: item.product_sku,
      quantity: item.quantity,
    })));
  } catch {
    return false;
  }

  return JSON.stringify(identity.products) === JSON.stringify(persistedProducts) &&
    identity.customer.firstName === order.customer_first_name &&
    identity.customer.lastName === order.customer_last_name &&
    identity.customer.email === order.customer_email &&
    identity.customer.phone === order.customer_phone &&
    identity.delivery.province === order.shipping_province &&
    identity.delivery.locality === order.shipping_locality &&
    identity.delivery.postalCode === order.shipping_postal_code &&
    identity.delivery.street === order.shipping_street &&
    identity.delivery.streetNumber === order.shipping_street_number &&
    nullableEqual(identity.delivery.apartment, order.shipping_apartment) &&
    nullableEqual(identity.delivery.notes, order.shipping_notes) &&
    identity.shippingOptionId === order.shipping_option_id &&
    (order.shipping_delivery_type === "home" ||
      identity.shippingAgencyCode === order.shipping_agency_code);
}

function normalizeProducts(body) {
  const hasItems = Object.prototype.hasOwnProperty.call(body, "items");
  const hasSku = Object.prototype.hasOwnProperty.call(body, "sku");
  const hasQuantity = Object.prototype.hasOwnProperty.call(body, "quantity");
  if (hasItems && (hasSku || hasQuantity)) throw new CheckoutAttemptRequestError();
  return groupProducts(hasItems ? body.items : [{ sku: body.sku, quantity: body.quantity }]);
}

function groupProducts(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    throw new CheckoutAttemptRequestError();
  }
  const grouped = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.sku !== "string" || item.sku === "" ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutAttemptRequestError();
    }
    const quantity = (grouped.get(item.sku) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new CheckoutAttemptRequestError();
    grouped.set(item.sku, quantity);
  }
  return [...grouped.entries()]
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function nullableEqual(left, right) {
  return (left ?? null) === (right ?? null);
}

module.exports = {
  CHECKOUT_ATTEMPT_STATES,
  CheckoutAttemptIdError,
  CheckoutAttemptRequestError,
  normalizeCheckoutAttemptId,
  buildCheckoutRequestIdentity,
  checkoutRequestMatchesSnapshot,
};
