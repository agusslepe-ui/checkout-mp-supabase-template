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
  constructor(type, status = null, details = {}) {
    super(type, status, details);
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

async function importShipment(payload) {
  let token;
  try {
    token = await authenticate();
  } catch (error) {
    throw classifyImportTransportError(error, false);
  }

  let response = await requestImport(payload, token);
  if (response.status === 401) {
    if (cachedToken === token) clearToken();
    try {
      token = await authenticate();
    } catch (error) {
      // El POST previo fue rechazado explícitamente con 401; aún no se hizo el retry.
      throw classifyImportTransportError(error, false);
    }
    response = await requestImport(payload, token);
  }

  if (!response.ok) {
    if (response.status === 401 && cachedToken === token) clearToken();
    throw classifyImportHttpError(response.status);
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new MicorreoError("AMBIGUOUS_RESPONSE", response.status, {
      requestAttempted: true,
      ambiguous: true,
    });
  }
  if (!isValidCreatedAt(body?.createdAt)) {
    throw new MicorreoError("AMBIGUOUS_RESPONSE", response.status, {
      requestAttempted: true,
      ambiguous: true,
    });
  }
  return { createdAt: body.createdAt };
}

async function requestImport(payload, token) {
  try {
    return await request("/shipping/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }, { classifyTimeoutSeparately: true });
  } catch (error) {
    throw classifyImportTransportError(error, true);
  }
}

function classifyImportTransportError(error, requestAttempted) {
  if (error instanceof MicorreoError && error.type === "micorreo_timeout_error") {
    return new MicorreoError("TIMEOUT", null, {
      requestAttempted,
      ambiguous: requestAttempted,
      retryable: !requestAttempted,
    });
  }
  if (error instanceof MicorreoError && error.type === "micorreo_network_error") {
    return new MicorreoError("NETWORK", null, {
      requestAttempted,
      ambiguous: requestAttempted,
      retryable: !requestAttempted,
    });
  }
  if (error instanceof MicorreoError &&
      ["micorreo_auth_error", "micorreo_config_error"].includes(error.type)) {
    return new MicorreoError("AUTH", error.status, { requestAttempted });
  }
  return error;
}

function classifyImportHttpError(status) {
  if (status === 401 || status === 403) {
    return new MicorreoError("AUTH", status, { requestAttempted: true });
  }
  if (status === 429) {
    return new MicorreoError("RATE_LIMIT", status, {
      requestAttempted: true,
      retryable: true,
    });
  }
  if (status === 408) {
    return new MicorreoError("TIMEOUT", status, {
      requestAttempted: true,
      ambiguous: true,
    });
  }
  if (status >= 500) {
    return new MicorreoError("SERVER", status, {
      requestAttempted: true,
      ambiguous: true,
    });
  }
  return new MicorreoError("PROVIDER_REJECTED", status, { requestAttempted: true });
}

function isValidCreatedAt(value) {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/
  );
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    timezone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;
  if (timezone !== "Z" &&
      (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return true;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
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

async function request(pathname, options, { classifyTimeoutSeparately = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${micorreoBaseUrl.replace(/\/$/, "")}${pathname}`, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    throw new MicorreoError(
      classifyTimeoutSeparately && controller.signal.aborted
        ? "micorreo_timeout_error"
        : "micorreo_network_error"
    );
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
const MiCorreoProvider = Object.freeze({ authenticate, quoteRates, listAgencies, importShipment });

module.exports = {
  MicorreoError,
  MiCorreoProvider,
  authenticate,
  quoteRates,
  listAgencies,
  importShipment,
};
