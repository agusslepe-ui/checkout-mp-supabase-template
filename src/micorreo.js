const {
  micorreoBaseUrl,
  micorreoUser,
  micorreoPassword,
} = require("./config");

const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_TOKEN_LIFETIME_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_MARGIN_MS = 30 * 1000;

let cachedToken = null;
let tokenExpiresAt = 0;
let tokenRequestPromise = null;

class MicorreoError extends Error {
  constructor(type, status = null) {
    super(type);
    this.name = "MicorreoError";
    this.type = type;
    this.status = status;
  }
}

async function quoteRates(payload) {
  let token = await getToken();
  let response = await request("/rates", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 401) {
    clearToken();
    token = await getToken();
    response = await request("/rates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    throw new MicorreoError("micorreo_rate_error", response.status);
  }

  return parseJson(response, "micorreo_invalid_response");
}

async function getToken() {
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
  const expiresIn = Number(responseBody?.expires_in ?? responseBody?.expiresIn);

  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return now + Math.max(1000, expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS);
  }

  const jwtExpiry = readJwtExpiry(token);
  if (jwtExpiry > now) {
    return Math.max(now + 1000, jwtExpiry - TOKEN_EXPIRY_MARGIN_MS);
  }

  return now + DEFAULT_TOKEN_LIFETIME_MS - TOKEN_EXPIRY_MARGIN_MS;
}

function readJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) * 1000;
  } catch (error) {
    return 0;
  }
}

function clearToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

module.exports = { MicorreoError, quoteRates };
