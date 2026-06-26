const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { getProduct } = require("./catalog");
const { baseUrl, mercadoPagoAccessToken } = require("./config");
const { log } = require("./logger");
const { createPendingOrder, markOrderAsPaid } = require("./orders");
const { createPreference, getPayment } = require("./payments");
const {
  getWebhookSignatureDiagnostics,
  validateWebhookSignature,
} = require("./webhookSignature");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function getSupabaseErrorCategory(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const status = error?.status;

  if (code === "PGRST116") {
    return "supabase_result_shape_error";
  }

  if (code === "42501" || status === 401 || status === 403) {
    return "supabase_auth_or_rls_error";
  }

  if (code.startsWith("23")) {
    return "supabase_constraint_error";
  }

  if (code.startsWith("PGRST")) {
    return "supabase_postgrest_error";
  }

  return "supabase_error";
}

function getSupabaseDiagnosticFields(error) {
  const fields = {};

  if (typeof error?.code === "string") {
    fields.supabase_code = error.code;
  }

  if (typeof error?.status === "number" || typeof error?.status === "string") {
    fields.supabase_status = error.status;
  }

  if (typeof error?.name === "string") {
    fields.supabase_error_name = error.name;
  }

  if (error?.details !== undefined) {
    fields.supabase_details_type = typeof error.details;
  }

  if (error?.hint !== undefined) {
    fields.supabase_hint_type = typeof error.hint;
  }

  return fields;
}

function logSupabasePersistError(error, logContext) {
  const entry = {
    level: "error",
    event: "error al persistir pedido",
    request_id: logContext.request_id,
    route: logContext.route,
    method: logContext.method,
    timestamp: new Date().toISOString(),
    status_code: 500,
    error_type: getSupabaseErrorCategory(error),
    ...getSupabaseDiagnosticFields(error),
  };

  console.error(JSON.stringify(entry));
}

function logInvalidWebhookSignature(req, logContext) {
  const entry = {
    level: "warn",
    event: "firma de webhook invalida",
    request_id: logContext.request_id,
    route: logContext.route,
    method: logContext.method,
    timestamp: new Date().toISOString(),
    status_code: 401,
    ...getWebhookSignatureDiagnostics(req),
  };

  console.warn(JSON.stringify(entry));
}

function getHeaderString(req, headerName) {
  const value = req.headers?.[headerName];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return typeof value === "string" ? value : null;
}

function getWebhookRequestUrlFull(req) {
  const originalUrl =
    typeof req.originalUrl === "string"
      ? req.originalUrl
      : typeof req.url === "string"
        ? req.url
        : "";

  if (/^https?:\/\//i.test(originalUrl)) {
    return originalUrl;
  }

  const host = getHeaderString(req, "host");

  if (!host) {
    return originalUrl;
  }

  const forwardedProto = getHeaderString(req, "x-forwarded-proto");
  const protocol = forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : typeof req.protocol === "string"
      ? req.protocol
      : "http";

  return `${protocol}://${host}${originalUrl}`;
}

function logMercadoPagoSupportCapture(req) {
  if (process.env.MP_SUPPORT_CAPTURE_FULL_WEBHOOK !== "true") {
    return;
  }

  console.warn(
    JSON.stringify({
      event: "captura temporal soporte mercado pago",
      request_url_full: getWebhookRequestUrlFull(req),
      header_x_signature_full: getHeaderString(req, "x-signature"),
      header_x_request_id_full: getHeaderString(req, "x-request-id"),
    })
  );
}

app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "success.html"));
});

app.get("/failure", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "failure.html"));
});

app.get("/pending", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "pending.html"));
});

app.post("/webhook", async (req, res) => {
  const signatureHeader = req.headers["x-signature"];
  const logContext = {
    request_id: crypto.randomUUID(),
    route: "/webhook",
    method: "POST",
  };

  logMercadoPagoSupportCapture(req);

  if (typeof signatureHeader !== "string" || signatureHeader.trim() === "") {
    log("warn", "firma de webhook ausente", {
      ...logContext,
      status_code: 401,
    });
    return res.status(401).json({ error: "Webhook inválido" });
  }

  const signatureIsValid = validateWebhookSignature(req);

  if (!signatureIsValid) {
    logInvalidWebhookSignature(req, logContext);
    return res.status(401).json({ error: "Webhook inválido" });
  }

  if (
    typeof req.headers["x-request-id"] === "string" &&
    req.headers["x-request-id"] !== ""
  ) {
    logContext.request_id = req.headers["x-request-id"];
  }

  log("info", "webhook recibido", logContext);

  const eventType =
    req.query.topic || req.body?.topic || req.query.type || req.body?.type;
  const paymentId =
    req.query.id ||
    req.body?.resource ||
    req.body?.data?.id ||
    req.query["data.id"];

  if (eventType !== "payment") {
    log("info", "evento ignorado", {
      ...logContext,
      status_code: 200,
    });
    return res.json({ received: true });
  }

  log("info", "pago detectado en webhook", logContext);

  try {
    const paymentInfo = await getPayment(paymentId);

    log("info", "pago consultado en mercado pago", logContext);

    if (paymentInfo.status === "approved") {
      log("info", "pago aprobado confirmado por api", {
        ...logContext,
        payment_status: "approved",
      });

      if (!paymentInfo.external_reference) {
        log("warn", "referencia externa ausente", logContext);
      } else {
        try {
          const updatedOrder = await markOrderAsPaid({
            external_reference: paymentInfo.external_reference,
            mercadopago_payment_id: paymentInfo.id,
            mercadopago_status: paymentInfo.status,
            transaction_amount: paymentInfo.transaction_amount,
            currency_id: paymentInfo.currency_id,
            logContext,
          });

          if (updatedOrder) {
            log("info", "pedido actualizado a pagado", {
              ...logContext,
              order_status: "paid",
            });
          }
        } catch (error) {
          log("error", "error actualizando pedido en supabase", {
            ...logContext,
            error_type: "supabase_error",
          });
        }
      }
    } else {
      log("warn", "pago no aprobado", {
        ...logContext,
        payment_status: paymentInfo.status,
      });
    }
  } catch (error) {
    log("error", "error consultando pago en mercado pago", {
      ...logContext,
      error_type: "mp_api_error",
    });
  }

  res.json({ received: true });
});

if (process.env.NODE_ENV !== "production") {
  app.get("/webhook", (req, res) => {
    const logContext = {
      request_id: crypto.randomUUID(),
      route: "/webhook",
      method: "GET",
    };

    log("info", "webhook get recibido", {
      ...logContext,
      status_code: 200,
    });

    res.json({ received: true });
  });
}

app.post("/crear-preferencia", async (req, res) => {
  const logContext = {
    request_id: crypto.randomUUID(),
    route: "/crear-preferencia",
    method: "POST",
  };

  if (!mercadoPagoAccessToken) {
    return res.status(500).json({
      error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN en el archivo .env",
    });
  }

  const { sku, quantity } = req.body || {};
  const product = getProduct(sku);

  if (!product) {
    return res.status(400).json({
      error: "Producto no encontrado",
    });
  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > product.maxQuantity
  ) {
    return res.status(400).json({
      error: "Cantidad inválida",
    });
  }

  try {
    const total = product.unitPrice * quantity;
    const preferenceItem = {
      title: product.name,
      quantity,
      unit_price: product.unitPrice,
      currency_id: product.currency,
    };
    const externalReference = `LEMONT-ORDER-${crypto.randomUUID()}`;

    log("info", "inicio de creacion de preferencia", logContext);

    try {
      await createPendingOrder({
        external_reference: externalReference,
        product_name: product.name,
        quantity,
        amount: total,
        currency: product.currency,
        status: "pending",
      });

      log("info", "pedido persistido", {
        ...logContext,
        order_status: "pending",
      });
    } catch (error) {
      logSupabasePersistError(error, logContext);
      return res.status(500).json({
        error: "No se pudo iniciar el pago",
      });
    }

    const result = await createPreference({
      items: [preferenceItem],
      external_reference: externalReference,
      notification_url: `${baseUrl}/webhook`,
      back_urls: {
        success: `${baseUrl}/success`,
        failure: `${baseUrl}/failure`,
        pending: `${baseUrl}/pending`,
      },
      auto_return: "approved",
    });

    log("info", "preferencia creada", logContext);

    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error) {
    log("error", "error al crear la preferencia", {
      ...logContext,
      status_code: 500,
      error_type: "mercado_pago_error",
    });

    res.status(500).json({
      error: "No se pudo crear la preferencia",
    });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    res.set("Content-Type", "application/json; charset=utf-8");
    return res.status(400).json({ error: "JSON inválido" });
  }

  next(err);
});

module.exports = {
  app,
};
