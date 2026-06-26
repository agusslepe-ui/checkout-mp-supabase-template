const crypto = require("crypto");

const { log } = require("./logger");

const PORT = 3003;

// Estas variables son obligatorias tanto en desarrollo como en producción.
const requiredEnvironmentVariables = [
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_WEBHOOK_SECRET",
  "BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name] || process.env[name].trim() === ""
);

if (missingEnvironmentVariables.length > 0) {
  log("error", "configuracion invalida", {
    request_id: "startup",
    route: "startup",
    method: "STARTUP",
    error_type: "missing_environment",
  });
  process.exit(1);
}

const mercadoPagoWebhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
const webhookSecretHashPrefix = crypto
  .createHash("sha256")
  .update(mercadoPagoWebhookSecret)
  .digest("hex")
  .slice(0, 8);

log("info", "diagnostico webhook secret", {
  request_id: "startup",
  route: "startup",
  method: "STARTUP",
  webhook_secret_present: Boolean(mercadoPagoWebhookSecret),
  webhook_secret_length: mercadoPagoWebhookSecret.length,
  webhook_secret_sha256_prefix: webhookSecretHashPrefix,
});

module.exports = {
  PORT,
  mercadoPagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  mercadoPagoWebhookSecret,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  baseUrl: process.env.BASE_URL,
};
