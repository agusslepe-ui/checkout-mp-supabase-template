(function exposeCheckoutAttemptClient(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LemontCheckoutAttempt = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi(root) {
  "use strict";

  const STORAGE_KEY = "lemont.checkoutAttempt.v1";
  const STORAGE_VERSION = 1;
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

  function buildCanonicalIntent(body) {
    const sourceItems = Object.prototype.hasOwnProperty.call(body, "items")
      ? body.items
      : [{ sku: body.sku, quantity: body.quantity }];
    const quantities = new Map();
    for (const item of sourceItems) {
      const next = (quantities.get(item.sku) || 0) + item.quantity;
      quantities.set(item.sku, next);
    }
    const products = [...quantities.entries()]
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((left, right) => left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0);
    const customer = body.customer || {};
    const delivery = body.delivery || {};
    const isAgency = typeof body.shippingOptionId === "string" &&
      body.shippingOptionId.startsWith("micorreo:agency:");

    return {
      products,
      customer: {
        firstName: normalizeSpaces(customer.firstName),
        lastName: normalizeSpaces(customer.lastName),
        email: normalizeText(customer.email).toLowerCase(),
        phone: normalizeText(customer.phone).replace(/\D/g, ""),
      },
      delivery: {
        province: normalizeText(delivery.province).toUpperCase(),
        locality: normalizeSpaces(delivery.locality),
        postalCode: normalizeText(delivery.postalCode).toUpperCase(),
        street: normalizeSpaces(delivery.street),
        streetNumber: normalizeText(delivery.streetNumber),
        apartment: normalizeNullable(delivery.apartment),
        notes: normalizeNullable(delivery.notes),
      },
      shippingOptionId: body.shippingOptionId,
      shippingAgencyCode: isAgency ? normalizeText(body.shippingAgencyCode) : null,
    };
  }

  async function createIntentDigest(body, options = {}) {
    const cryptoApi = options.cryptoApi || root.crypto;
    const TextEncoderApi = options.TextEncoderApi || root.TextEncoder;
    if (!cryptoApi?.subtle?.digest || typeof TextEncoderApi !== "function") {
      throw new Error("checkout_crypto_unavailable");
    }
    const canonical = JSON.stringify(buildCanonicalIntent(body));
    const digest = await cryptoApi.subtle.digest(
      "SHA-256",
      new TextEncoderApi().encode(canonical)
    );
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  function getOrCreateCheckoutAttempt(intentDigest, options = {}) {
    const storage = options.storage || root.sessionStorage;
    const cryptoApi = options.cryptoApi || root.crypto;
    if (!storage || typeof cryptoApi?.randomUUID !== "function" ||
        !DIGEST_PATTERN.test(intentDigest)) {
      throw new Error("checkout_crypto_unavailable");
    }

    const stored = readStoredAttempt(storage);
    if (stored && stored.intentDigest === intentDigest) {
      return stored.checkoutAttemptId;
    }

    clearCheckoutAttempt(storage);
    const checkoutAttemptId = cryptoApi.randomUUID();
    if (!UUID_PATTERN.test(checkoutAttemptId)) {
      throw new Error("checkout_crypto_unavailable");
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      checkoutAttemptId,
      intentDigest,
    }));
    return checkoutAttemptId;
  }

  function clearCheckoutAttempt(storage = root.sessionStorage) {
    if (!storage) return;
    storage.removeItem(STORAGE_KEY);
  }

  function readStoredAttempt(storage) {
    let value;
    try {
      value = JSON.parse(storage.getItem(STORAGE_KEY));
    } catch {
      clearCheckoutAttempt(storage);
      return null;
    }
    if (!isStoredAttempt(value)) {
      if (value !== null) clearCheckoutAttempt(storage);
      return null;
    }
    return value;
  }

  function isStoredAttempt(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 3 && value.version === STORAGE_VERSION &&
      UUID_PATTERN.test(value.checkoutAttemptId) && DIGEST_PATTERN.test(value.intentDigest);
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeSpaces(value) {
    return normalizeText(value).replace(/\s+/g, " ");
  }

  function normalizeNullable(value) {
    const normalized = normalizeText(value);
    return normalized || null;
  }

  return {
    STORAGE_KEY,
    buildCanonicalIntent,
    createIntentDigest,
    getOrCreateCheckoutAttempt,
    clearCheckoutAttempt,
  };
});
