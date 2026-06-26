const crypto = require("crypto");

const LOG_LEVELS = {
  info: 10,
  warn: 20,
  error: 30,
};

function log(level, event, extra = {}) {
  const normalizedLevel = LOG_LEVELS[level] ? level : "info";
  const configuredLevel = LOG_LEVELS[process.env.LOG_LEVEL] ? process.env.LOG_LEVEL : "info";

  if (LOG_LEVELS[normalizedLevel] < LOG_LEVELS[configuredLevel]) {
    return;
  }

  const entry = {
    level: normalizedLevel,
    event,
    request_id: extra.request_id || crypto.randomUUID(),
    route: extra.route || "app",
    method: extra.method || "SYSTEM",
    timestamp: new Date().toISOString(),
  };
  const safeOptionalFields = [
    "status_code",
    "payment_status",
    "order_status",
    "error_type",
    "webhook_secret_present",
    "webhook_secret_length",
    "webhook_secret_sha256_prefix",
  ];

  for (const field of safeOptionalFields) {
    if (extra[field] !== undefined) {
      entry[field] = extra[field];
    }
  }

  const serializedEntry = JSON.stringify(entry);

  if (normalizedLevel === "error") {
    console.error(serializedEntry);
  } else if (normalizedLevel === "warn") {
    console.warn(serializedEntry);
  } else {
    console.log(serializedEntry);
  }
}

module.exports = {
  log,
};
