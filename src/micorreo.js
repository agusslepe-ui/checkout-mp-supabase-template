const {
  micorreoBaseUrl,
  micorreoUser,
  micorreoPassword,
} = require("./config");
const { ShippingProviderError } = require("./shippingProvider");

const REQUEST_TIMEOUT_MS = 8000;
const TOKEN_EXPIRY_MARGIN_MS = 30 * 1000;

let cachedToken = null;
let tokenExpiresAt = 0;
let tokenRequestPromise = null;

class MicorreoError extends ShippingProviderError {
  constructor(type, status = null) {
    super(type, status);
    this.name = "MicorreoError";
    this.type = type;
    this.status = status;
  }
}

async function quoteRates(payload) {
  return requestWithBearer("/rates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "micorreo_rate_error", "micorreo_invalid_response");
}

async function listAgencies({ customerId, provinceCode }) {
  const query = new URLSearchParams({ customerId, provinceCode });
  return requestWithBearer(`/agencies?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  }, "micorreo_agency_error", "micorreo_invalid_agencies_response");
}

async function requestWithBearer(pathname, options, responseErrorType, jsonErrorType) {
  let token = await authenticate();
  let response = await request(pathname, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    // Un 401 tardio no debe invalidar una renovacion de otra cotizacion.
    if (cachedToken === token) clearToken();
    token = await authenticate();
    response = await request(pathname, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  if (!response.ok) {
    if (response.status === 401 && cachedToken === token) clearToken();
    throw new MicorreoError(responseErrorType, response.status);
  }

  return parseJson(response, jsonErrorType);
}

async function authenticate() {
  if ([micorreoBaseUrl, micorreoUser, micorreoPassword].some(
    (value) => typeof value !== "string" || value.trim() === ""
  )) {
    throw new MicorreoError("micorreo_config_error");
  }
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (tokenRequestPromise) return tokenRequestPromise;

  tokenRequestPromise = requestToken().finally(() => {
    tokenRequestPromise = null;
  });

  return tokenRequestPromise;
}

async function requestToken() {
  const credentials = Buffer.from(`${micorreoUser}:${micorreoPassword}`).toString("base64");
  const response = await request("/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new MicorreoError("micorreo_auth_error", response.status);
  }

  const body = await parseJson(response, "micorreo_auth_error");
  const token = body?.token || body?.access_token;

  if (typeof token !== "string" || token.trim() === "") {
    throw new MicorreoError("micorreo_auth_error", response.status);
  }

  cachedToken = token;
  tokenExpiresAt = calculateTokenExpiry(token, body);
  return cachedToken;
}

async function request(pathname, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${micorreoBaseUrl.replace(/\/$/, "")}${pathname}`, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    throw new MicorreoError("micorreo_network_error");
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response, errorType) {
  try {
    return await response.json();
  } catch (error) {
    throw new MicorreoError(errorType, response.status);
  }
}

function calculateTokenExpiry(token, responseBody) {
  const now = Date.now();
  const expires = typeof responseBody?.expires === "string"
    ? Date.parse(responseBody.expires)
    : NaN;
  if (Number.isFinite(expires)) return expires - TOKEN_EXPIRY_MARGIN_MS;

  // exp solo se decodifica para gestionar cache, no valida la firma del JWT.
  const jwtExpiry = readJwtExpiry(token);
  if (Number.isFinite(jwtExpiry)) return jwtExpiry - TOKEN_EXPIRY_MARGIN_MS;

  const expiresIn = Number(responseBody?.expires_in ?? responseBody?.expiresIn);

  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return now + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS;
  }

  // Sin vencimiento conocido se usa una vez, sin inventar una vigencia.
  return now;
}

function readJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : NaN;
  } catch (error) {
    return NaN;
  }
}

function clearToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

/** @type {import("./shippingProvider").ShippingProvider} */
const MiCorreoProvider = Object.freeze({ authenticate, quoteRates, listAgencies });

module.exports = { MicorreoError, MiCorreoProvider, authenticate, quoteRates, listAgencies };
