require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = 3003;
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

const mercadoPagoAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const mercadoPagoWebhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BASE_URL;
const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken });
const preference = new Preference(client);
const payment = new Payment(client);
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function isValidWebhookSignature({ signatureHeader, requestId, dataId }) {
  let timestamp;
  let receivedSignature;

  for (const part of signatureHeader.split(",")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key === "ts") {
      timestamp = value;
    } else if (key === "v1") {
      receivedSignature = value;
    }
  }

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !receivedSignature ||
    !/^[a-fA-F0-9]{64}$/.test(receivedSignature)
  ) {
    return false;
  }

  const manifestParts = [];

  if (dataId !== undefined && dataId !== null && String(dataId) !== "") {
    manifestParts.push(`id:${String(dataId).toLowerCase()};`);
  }

  if (typeof requestId === "string" && requestId !== "") {
    manifestParts.push(`request-id:${requestId};`);
  }

  manifestParts.push(`ts:${timestamp};`);

  const expectedSignature = crypto
    .createHmac("sha256", mercadoPagoWebhookSecret)
    .update(manifestParts.join(""))
    .digest();
  const receivedSignatureBuffer = Buffer.from(receivedSignature, "hex");

  return (
    expectedSignature.length === receivedSignatureBuffer.length &&
    crypto.timingSafeEqual(expectedSignature, receivedSignatureBuffer)
  );
}

function importesCoinciden(a, b) {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

async function createPendingOrder({
  external_reference,
  product_name,
  quantity,
  amount,
  currency,
  status,
}) {
  const { data, error } = await supabase
    .from("orders")
    .insert({
      external_reference,
      product_name,
      quantity,
      amount,
      currency,
      status,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function markOrderAsPaid({
  external_reference,
  mercadopago_payment_id,
  mercadopago_status,
  transaction_amount,
  currency_id,
  logContext,
}) {
  const { data: order, error: findError } = await supabase
    .from("orders")
    .select("*")
    .eq("external_reference", external_reference)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (!order) {
    log("warn", "pedido no encontrado", logContext);
    return null;
  }

  if (order.status === "paid") {
    log("info", "webhook duplicado ignorado", {
      ...logContext,
      order_status: "paid",
    });
    return null;
  }

  if (currency_id !== order.currency) {
    log("warn", "moneda no coincide", logContext);
    return null;
  }

  if (!importesCoinciden(transaction_amount, order.amount)) {
    log("warn", "importe no coincide", logContext);
    return null;
  }

  const { data: updatedOrder, error } = await supabase
    .from("orders")
    .update({
      status: "paid",
      mercadopago_payment_id,
      mercadopago_status,
      updated_at: new Date().toISOString(),
    })
    .eq("external_reference", external_reference)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!updatedOrder) {
    log("info", "webhook duplicado ignorado", logContext);
    return null;
  }

  return updatedOrder;
}

app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "success.html"));
});

app.get("/failure", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "failure.html"));
});

app.get("/pending", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pending.html"));
});

app.post("/webhook", async (req, res) => {
  const signatureHeader = req.headers["x-signature"];
  const logContext = {
    request_id:
      typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"] !== ""
        ? req.headers["x-request-id"]
        : crypto.randomUUID(),
    route: "/webhook",
    method: "POST",
  };

  if (typeof signatureHeader !== "string" || signatureHeader.trim() === "") {
    log("warn", "firma de webhook ausente", {
      ...logContext,
      status_code: 401,
    });
    return res.status(401).json({ error: "Webhook inválido" });
  }

  const signatureIsValid = isValidWebhookSignature({
    signatureHeader,
    requestId: req.headers["x-request-id"],
    dataId: req.query["data.id"],
  });

  if (!signatureIsValid) {
    log("warn", "firma de webhook invalida", {
      ...logContext,
      status_code: 401,
    });
    return res.status(401).json({ error: "Webhook inválido" });
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
    const paymentInfo = await payment.get({ id: paymentId });

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

  try {
    const product = {
      title: "Remera LEMONT",
      quantity: 1,
      unit_price: 100,
      currency_id: "ARS",
    };
    const externalReference = `LEMONT-ORDER-${crypto.randomUUID()}`;

    log("info", "inicio de creacion de preferencia", logContext);

    try {
      await createPendingOrder({
        external_reference: externalReference,
        product_name: product.title,
        quantity: product.quantity,
        amount: product.unit_price,
        currency: product.currency_id,
        status: "pending",
      });

      log("info", "pedido persistido", {
        ...logContext,
        order_status: "pending",
      });
    } catch (error) {
      log("error", "error al persistir pedido", {
        ...logContext,
        status_code: 500,
        error_type: "supabase_error",
      });
      return res.status(500).json({
        error: "No se pudo iniciar el pago",
      });
    }

    const result = await preference.create({
      body: {
        items: [product],
        external_reference: externalReference,
        notification_url: `${baseUrl}/webhook`,
        back_urls: {
          success: `${baseUrl}/success`,
          failure: `${baseUrl}/failure`,
          pending: `${baseUrl}/pending`,
        },
        auto_return: "approved",
      },
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
    return res.status(400).json({ error: "JSON inválido" });
  }

  next(err);
});

app.listen(PORT, () => {
  log("info", "servidor iniciado", {
    request_id: "startup",
    route: "startup",
    method: "STARTUP",
  });
});
