require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();
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
  console.error(
    `Configuración inválida. Variables faltantes o vacías: ${missingEnvironmentVariables.join(
      ", "
    )}`
  );
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
    console.log("Pedido no encontrado para procesar pago");
    return null;
  }

  if (order.status === "paid") {
    console.log("Pedido ya estaba pagado, webhook duplicado ignorado");
    return null;
  }

  if (Number(order.amount) !== Number(transaction_amount)) {
    console.log("Monto de pago no coincide con el pedido");
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
    console.log("Pedido ya procesado, webhook duplicado ignorado");
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

  if (typeof signatureHeader !== "string" || signatureHeader.trim() === "") {
    console.log("firma de webhook ausente");
    return res.status(401).json({ error: "Webhook inválido" });
  }

  const signatureIsValid = isValidWebhookSignature({
    signatureHeader,
    requestId: req.headers["x-request-id"],
    dataId: req.query["data.id"],
  });

  if (!signatureIsValid) {
    console.log("firma de webhook inválida");
    return res.status(401).json({ error: "Webhook inválido" });
  }

  console.log("Webhook POST recibido");
  console.log("method:", req.method);
  console.log("originalUrl:", req.originalUrl);
  console.log("query:", req.query);
  console.log("body:", req.body);
  console.log("content-type:", req.headers["content-type"]);

  const eventType =
    req.query.topic || req.body?.topic || req.query.type || req.body?.type;
  const paymentId =
    req.query.id ||
    req.body?.resource ||
    req.body?.data?.id ||
    req.query["data.id"];

  if (eventType !== "payment") {
    console.log("Evento ignorado:", eventType);
    return res.json({ received: true });
  }

  console.log("Payment ID detectado:", paymentId);

  try {
    const paymentInfo = await payment.get({ id: paymentId });

    console.log("Datos del pago:");
    console.log("id:", paymentInfo.id);
    console.log("status:", paymentInfo.status);
    console.log("status_detail:", paymentInfo.status_detail);
    console.log("transaction_amount:", paymentInfo.transaction_amount);
    console.log("currency_id:", paymentInfo.currency_id);
    console.log("description:", paymentInfo.description);
    console.log("external_reference:", paymentInfo.external_reference);
    console.log("date_approved:", paymentInfo.date_approved);
    console.log("payment_method_id:", paymentInfo.payment_method_id);
    console.log("payment_type_id:", paymentInfo.payment_type_id);

    if (paymentInfo.status === "approved") {
      console.log("PAGO APROBADO CONFIRMADO POR API");

      if (!paymentInfo.external_reference) {
        console.log("No hay external_reference para actualizar pedido");
      } else {
        try {
          const updatedOrder = await markOrderAsPaid({
            external_reference: paymentInfo.external_reference,
            mercadopago_payment_id: paymentInfo.id,
            mercadopago_status: paymentInfo.status,
            transaction_amount: paymentInfo.transaction_amount,
          });

          if (updatedOrder) {
            console.log("Pedido actualizado a paid en Supabase");
          }
        } catch (error) {
          console.error("Error actualizando pedido en Supabase");
        }
      }
    } else {
      console.log("Pago recibido pero no aprobado:", paymentInfo.status);
    }
  } catch (error) {
    console.error(
      "Error consultando pago en Mercado Pago:",
      error.message
    );
  }

  res.json({ received: true });
});

app.get("/webhook", (req, res) => {
  console.log("Webhook GET recibido");
  console.log("method:", req.method);
  console.log("originalUrl:", req.originalUrl);
  console.log("query:", req.query);
  console.log("content-type:", req.headers["content-type"]);

  res.json({ received: true });
});

app.post("/crear-preferencia", async (req, res) => {
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
    const externalReference = `LEMONT-ORDER-${Date.now()}`;

    console.log("Preferencia creada para pedido:");
    console.log("external_reference:", externalReference);
    console.log("producto:", product.title);
    console.log("monto:", product.unit_price);

    try {
      await createPendingOrder({
        external_reference: externalReference,
        product_name: product.title,
        quantity: product.quantity,
        amount: product.unit_price,
        currency: product.currency_id,
        status: "pending",
      });

      console.log("Pedido guardado en Supabase:", externalReference);
    } catch (error) {
      console.error("Error guardando pedido en Supabase");
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

    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error) {
    console.error("Error al crear la preferencia:", error);

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
  console.log(`Servidor escuchando en ${baseUrl}`);
});
