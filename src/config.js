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

module.exports = {
  PORT,
  mercadoPagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  mercadoPagoWebhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  baseUrl: process.env.BASE_URL,
};
