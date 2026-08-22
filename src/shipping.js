const { getProduct } = require("./catalog");
const {
  micorreoBaseUrl,
  micorreoUser,
  micorreoPassword,
  micorreoCustomerId,
  shippingOriginPostalCode,
} = require("./config");
const { MicorreoError, quoteRates } = require("./micorreo");

class ShippingInputError extends Error {
  constructor() {
    super("invalid shipping input");
    this.name = "ShippingInputError";
  }
}

class ShippingUnavailableError extends Error {
  constructor(type = "shipping_unavailable") {
    super(type);
    this.name = "ShippingUnavailableError";
    this.type = type;
  }
}

async function getShippingQuotes({ sku, quantity, postalCodeDestination }) {
  const product = getProduct(sku);
  if (!product) throw new ShippingInputError();
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.maxQuantity) {
    throw new ShippingInputError();
  }

  const destination = normalizePostalCode(postalCodeDestination);
  ensureShippingConfiguration();
  ensureDimensions(product.shipping);

  const ratePayload = {
    customerId: micorreoCustomerId,
    postalCodeOrigin: shippingOriginPostalCode.trim().toUpperCase(),
    postalCodeDestination: destination,
    dimensions: {
      weight: product.shipping.weightGrams,
      height: product.shipping.heightCm,
      width: product.shipping.widthCm,
      length: product.shipping.lengthCm,
    },
  };

  try {
    const response = await quoteRates(ratePayload);
    return normalizeRates(response);
  } catch (error) {
    if (error instanceof MicorreoError) {
      throw new ShippingUnavailableError(error.type);
    }
    throw error;
  }
}

function normalizePostalCode(value) {
  if (typeof value !== "string") throw new ShippingInputError();
  const postalCode = value.trim().toUpperCase();
  if (!/^\d{4}$/.test(postalCode) && !/^[A-Z]\d{4}[A-Z]{3}$/.test(postalCode)) {
    throw new ShippingInputError();
  }
  return postalCode;
}

function ensureShippingConfiguration() {
  const values = [
    micorreoBaseUrl,
    micorreoUser,
    micorreoPassword,
    micorreoCustomerId,
    shippingOriginPostalCode,
  ];
  if (values.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new ShippingUnavailableError();
  }
}

function ensureDimensions(dimensions) {
  const values = [
    dimensions?.weightGrams,
    dimensions?.heightCm,
    dimensions?.widthCm,
    dimensions?.lengthCm,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new ShippingUnavailableError();
  }
}

function normalizeRates(response) {
  if (!response || !Array.isArray(response.rates)) {
    throw new ShippingUnavailableError("micorreo_invalid_response");
  }

  const labels = {
    D: { type: "home", label: "Envío a domicilio" },
    S: { type: "agency", label: "Retiro en sucursal" },
  };

  return response.rates.flatMap((rate) => {
    const option = labels[rate?.deliveredType];
    const price = Number(rate?.price);
    if (!option || !Number.isFinite(price) || price < 0) return [];
    return [{ ...option, price }];
  });
}

module.exports = {
  ShippingInputError,
  ShippingUnavailableError,
  getShippingQuotes,
};
