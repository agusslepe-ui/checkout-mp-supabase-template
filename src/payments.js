const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");
const { mercadoPagoAccessToken } = require("./config");

const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken });
const preference = new Preference(client);
const payment = new Payment(client);
const PREFERENCE_SEARCH_TIMEOUT_MS = 8000;

function createPreference(body) {
  return preference.create({ body });
}

function getPayment(id) {
  return payment.get({ id });
}

async function searchPreferencesByExternalReference(externalReference) {
  if (typeof externalReference !== "string" || externalReference.trim() === "") {
    throw new Error("invalid external reference");
  }

  const response = await preference.search({
    options: { external_reference: externalReference, limit: 100 },
    requestOptions: { timeout: PREFERENCE_SEARCH_TIMEOUT_MS },
  });
  const elements = response?.elements;
  const total = response?.total;
  if (!Array.isArray(elements) || !Number.isSafeInteger(total) || total < 0) {
    throw new Error("invalid preference search response");
  }
  if (elements.some((item) => item?.external_reference !== externalReference)) {
    throw new Error("invalid preference search response");
  }
  if (total !== elements.length) {
    if (total > 1) return { count: total, preference: null };
    throw new Error("invalid preference search response");
  }
  if (total === 0) return { count: 0, preference: null };
  if (total > 1) return { count: total, preference: null };

  const summary = elements[0];
  if (typeof summary?.id !== "string" || summary.id.trim() === "") {
    throw new Error("invalid preference search response");
  }
  const complete = isUsableCheckoutUrl(summary.init_point)
    ? summary
    : await preference.get({ preferenceId: summary.id });
  if (complete?.id !== summary.id || complete?.external_reference !== externalReference ||
      !isUsableCheckoutUrl(complete?.init_point)) {
    throw new Error("invalid recovered preference");
  }

  return {
    count: 1,
    preference: {
      id: complete.id,
      external_reference: complete.external_reference,
      checkout_url: complete.init_point,
    },
  };
}

function isUsableCheckoutUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = {
  createPreference,
  getPayment,
  searchPreferencesByExternalReference,
};
