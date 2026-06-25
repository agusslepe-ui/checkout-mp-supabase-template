const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { baseUrl, mercadoPagoAccessToken } = require("./config");
const { log } = require("./logger");
const { createPendingOrder, markOrderAsPaid } = require("./orders");
const { createPreference, getPayment } = require("./payments");
const { validateWebhookSignature } = require("./webhookSignature");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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

  const signatureIsValid = validateWebhookSignature(req);

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

    const result = await createPreference({
      items: [product],
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
