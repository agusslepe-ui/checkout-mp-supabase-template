const { micorreoCustomerId } = require("./config");
const { MiCorreoProvider } = require("./micorreo");
const { normalizeProvince } = require("./shipping");
const { ShippingProviderError } = require("./shippingProvider");

const SHIPPING_IMPORT_ERROR_TYPES = Object.freeze({
  VALIDATION: "VALIDATION",
  AUTH: "AUTH",
  RATE_LIMIT: "RATE_LIMIT",
  PROVIDER_REJECTED: "PROVIDER_REJECTED",
  NETWORK: "NETWORK",
  TIMEOUT: "TIMEOUT",
  SERVER: "SERVER",
  AMBIGUOUS_RESPONSE: "AMBIGUOUS_RESPONSE",
  UNSUPPORTED_SERVICE: "UNSUPPORTED_SERVICE",
});

class ShippingImportError extends ShippingProviderError {
  constructor(type, details = {}) {
    super(type, details.status ?? null, details);
    this.name = "ShippingImportError";
  }
}

function createShippingImportService(
  provider = MiCorreoProvider,
  configuration = { customerId: micorreoCustomerId }
) {
  async function importShipment(snapshot) {
    const payload = buildImportPayload(snapshot, configuration.customerId);
    try {
      return await provider.importShipment(payload);
    } catch (error) {
      if (error instanceof ShippingProviderError) throw error;
      throw error;
    }
  }

  return { importShipment };
}

function buildImportPayload(snapshot, customerId) {
  if (!isPlainObject(snapshot)) throw validationError();
  const configuredCustomerId = requireString(customerId);
  requireString(snapshot.ext_order_id, { preserve: true });

  if (snapshot.shipping_service !== "classic") {
    if (snapshot.shipping_service === "express") {
      throw new ShippingImportError(SHIPPING_IMPORT_ERROR_TYPES.UNSUPPORTED_SERVICE);
    }
    throw validationError();
  }

  const firstName = requireString(snapshot.customer_first_name);
  const lastName = requireString(snapshot.customer_last_name);
  const email = requireEmail(snapshot.customer_email);
  const phone = requireString(snapshot.customer_phone);
  const shipping = buildShipping(snapshot);

  return {
    customerId: configuredCustomerId,
    extOrderId: snapshot.ext_order_id,
    recipient: {
      name: `${firstName} ${lastName}`,
      email,
      phone,
    },
    shipping,
  };
}

function buildShipping(snapshot) {
  const weight = requirePositiveInteger(snapshot.weight_grams);
  const height = requirePositiveInteger(snapshot.height_cm);
  const width = requirePositiveInteger(snapshot.width_cm);
  const length = requirePositiveInteger(snapshot.length_cm);
  const declaredValue = snapshot.declared_value;
  if (typeof declaredValue !== "number" ||
      !Number.isFinite(declaredValue) || declaredValue < 0) throw validationError();

  const physical = { weight, declaredValue, height, length, width };
  if (snapshot.shipping_delivery_type === "agency") {
    return {
      deliveryType: "S",
      agency: requireString(snapshot.shipping_agency_code),
      ...physical,
    };
  }
  if (snapshot.shipping_delivery_type !== "home") throw validationError();

  let province;
  try {
    province = normalizeProvince(snapshot.shipping_province).slice(3);
  } catch (error) {
    throw validationError();
  }
  return {
    deliveryType: "D",
    address: {
      streetName: requireString(snapshot.shipping_street),
      streetNumber: requireString(snapshot.shipping_street_number),
      city: requireString(snapshot.shipping_locality),
      provinceCode: province,
      postalCode: requireString(snapshot.shipping_postal_code),
    },
    ...physical,
  };
}

function requireString(value, { preserve = false } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw validationError();
  return preserve ? value : value.trim();
}

function requireEmail(value) {
  const email = requireString(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError();
  return email;
}

function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw validationError();
  return value;
}

function validationError() {
  return new ShippingImportError(SHIPPING_IMPORT_ERROR_TYPES.VALIDATION);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ShippingImportService = createShippingImportService();

module.exports = {
  SHIPPING_IMPORT_ERROR_TYPES,
  ShippingImportError,
  buildImportPayload,
  createShippingImportService,
  ShippingImportService,
  importShipment: ShippingImportService.importShipment,
};
