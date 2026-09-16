const { CartError, resolveCart } = require("./cart");
const { MAX_QUOTE_UNITS, getPackageProfile } = require("./packageProfiles");
const {
  micorreoBaseUrl,
  micorreoUser,
  micorreoPassword,
  micorreoCustomerId,
  shippingOriginPostalCode,
} = require("./config");
const { MiCorreoProvider } = require("./micorreo");
const { ShippingProviderError } = require("./shippingProvider");

const ARGENTINA_PROVINCES = new Set([
  "AR-A", "AR-B", "AR-C", "AR-D", "AR-E", "AR-F",
  "AR-G", "AR-H", "AR-J", "AR-K", "AR-L", "AR-M",
  "AR-N", "AR-P", "AR-Q", "AR-R", "AR-S", "AR-T",
  "AR-U", "AR-V", "AR-W", "AR-X", "AR-Y", "AR-Z",
]);

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

/** @param {import("./shippingProvider").ShippingProvider} provider */
function createShippingService(provider = MiCorreoProvider) {
  async function getShippingQuotes(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ShippingInputError();
    const hasItems = Object.prototype.hasOwnProperty.call(input, "items");
    const hasSku = Object.prototype.hasOwnProperty.call(input, "sku");
    const hasQuantity = Object.prototype.hasOwnProperty.call(input, "quantity");
    if (hasItems ? (hasSku || hasQuantity) : !(hasSku && hasQuantity)) throw new ShippingInputError();
    let lines;
    try {
      ({ lines } = resolveCart({ items: hasItems ? input.items : [{ sku: input.sku, quantity: input.quantity }] }));
    } catch (error) {
      if (error instanceof CartError) throw new ShippingInputError();
      throw error;
    }
    const totalUnits = lines.reduce((total, line) => total + line.quantity, 0);
    if (totalUnits < 1 || totalUnits > MAX_QUOTE_UNITS) throw new ShippingInputError();

    const destination = normalizePostalCode(input.postalCodeDestination);
    ensureShippingConfiguration();
    const profile = getPackageProfile(totalUnits);
    ensureDimensions(profile);

    const ratePayload = {
      customerId: micorreoCustomerId,
      postalCodeOrigin: shippingOriginPostalCode.trim().toUpperCase(),
      postalCodeDestination: destination,
      dimensions: {
        weight: profile.weight,
        height: profile.height,
        width: profile.width,
        length: profile.length,
      },
    };

    try {
      const response = await provider.quoteRates(ratePayload);
      return normalizeRates(response);
    } catch (error) {
      if (error instanceof ShippingProviderError) {
        throw new ShippingUnavailableError(error.type);
      }
      throw error;
    }
  }
  async function listShippingAgencies(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ShippingInputError();
    }
    const province = normalizeProvince(input.province);
    ensureAgencyConfiguration();

    try {
      const response = await provider.listAgencies({
        customerId: micorreoCustomerId,
        provinceCode: province.slice(3),
      });
      return normalizeAgencies(response);
    } catch (error) {
      if (error instanceof ShippingProviderError) {
        throw new ShippingUnavailableError(error.type);
      }
      throw error;
    }
  }
  return { getShippingQuotes, listShippingAgencies };
}

const ShippingService = createShippingService();
const { getShippingQuotes, listShippingAgencies } = ShippingService;

function normalizeProvince(value) {
  if (typeof value !== "string") throw new ShippingInputError();
  const province = value.trim().toUpperCase();
  if (!ARGENTINA_PROVINCES.has(province)) throw new ShippingInputError();
  return province;
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
    dimensions?.height,
    dimensions?.width,
    dimensions?.length,
  ];
  if (!Number.isInteger(dimensions?.weight) || dimensions.weight < 1 || dimensions.weight > 25000 ||
      values.some((value) => !Number.isInteger(value) || value < 1 || value > 150)) {
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

  const normalizedById = new Map();
  const ambiguousIds = new Set();

  for (const rate of response.rates) {
    const option = labels[rate?.deliveredType];
    const service = { CP: "classic", EP: "express" }[rate?.productType];
    if (!Object.prototype.hasOwnProperty.call(labels, rate?.deliveredType) ||
        !["CP", "EP"].includes(rate?.productType)) continue;
    if (!["number", "string"].includes(typeof rate?.price) || String(rate.price).trim() === "") continue;
    const price = Number(rate?.price);
    const priceCents = Math.round(price * 100);
    if (!option || !Number.isSafeInteger(priceCents) || priceCents < 0) continue;

    const id = `micorreo:${option.type}:${service}`;
    const normalized = {
      id,
      provider: "micorreo",
      type: option.type,
      deliveryType: option.type,
      service,
      label: `${option.label} — ${service === "classic" ? "Clásico" : "Express"}`,
      price: priceCents / 100,
    };
    const previous = normalizedById.get(id);

    if (!previous) {
      normalizedById.set(id, normalized);
    } else if (Math.round(previous.price * 100) !== priceCents) {
      ambiguousIds.add(id);
    }
  }

  for (const id of ambiguousIds) normalizedById.delete(id);
  return [...normalizedById.values()];
}

function ensureAgencyConfiguration() {
  const values = [micorreoBaseUrl, micorreoUser, micorreoPassword, micorreoCustomerId];
  if (values.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new ShippingUnavailableError();
  }
}

function normalizeAgencies(response) {
  if (!Array.isArray(response)) {
    throw new ShippingUnavailableError("micorreo_invalid_agencies_response");
  }

  const agencies = [];
  for (const agency of response) {
    const pickupIsPresent = agency?.services &&
      Object.prototype.hasOwnProperty.call(agency.services, "pickupAvailability");
    if (agency?.status !== "ACTIVE" ||
        (pickupIsPresent && agency.services.pickupAvailability !== true)) continue;

    const address = agency?.location?.address;
    if (!address || typeof address !== "object") continue;
    const normalized = {
      code: normalizePublicText(agency?.code, 64),
      name: normalizePublicText(agency?.name, 120),
      streetName: normalizePublicText(address.streetName, 120),
      streetNumber: normalizePublicText(address.streetNumber, 30),
      locality: normalizePublicText(address.locality, 120),
      city: normalizePublicText(address.city, 120),
      postalCode: normalizePublicText(address.postalCode, 16),
    };
    if ([normalized.code, normalized.name, normalized.streetName,
      normalized.streetNumber, normalized.locality, normalized.postalCode]
      .some((value) => !value)) continue;

    agencies.push({
      ...normalized,
    });
  }
  return agencies;
}

function normalizePublicText(value, maxLength) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

module.exports = {
  ShippingInputError,
  ShippingUnavailableError,
  getShippingQuotes,
  listShippingAgencies,
  createShippingService,
  ShippingService,
};
