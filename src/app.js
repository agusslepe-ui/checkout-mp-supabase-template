const crypto = require("crypto");
const path = require("path");
const express = require("express");
const {
  CartError,
  MAX_CART_ITEMS,
  summarizeCart,
  resolveCheckoutCart,
} = require("./cart");
const { getProduct } = require("./catalog");
const { CheckoutInputError, parseCheckoutInput } = require("./checkoutInput");
const { baseUrl, mercadoPagoAccessToken } = require("./config");
const { log } = require("./logger");
const { createPendingOrder, markOrderAsPaid } = require("./orders");
const { createPreference, getPayment } = require("./payments");
const { MAX_QUOTE_UNITS } = require("./packageProfiles");
const {
  ShippingInputError,
  ShippingUnavailableError,
  getShippingQuotes,
  listShippingAgencies,
} = require("./shipping");
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

const WEBHOOK_PROCESSING_ERROR_RESPONSE = {
  error: "No se pudo procesar el webhook",
};

function getExternalErrorStatus(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const numericStatus = Number(status);

  return Number.isInteger(numericStatus) ? numericStatus : null;
}

function getMercadoPagoErrorType(error) {
  const status = getExternalErrorStatus(error);

  if (status === 401 || status === 403) {
    return "mp_auth_or_config_error";
  }

  if (status === 429) {
    return "mp_rate_limit_error";
  }

  if (status >= 500 && status <= 599) {
    return "mp_service_error";
  }

  return "mp_temporary_or_unknown_error";
}

function respondWebhookUnavailable(res) {
  return res.status(503).json(WEBHOOK_PROCESSING_ERROR_RESPONSE);
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

app.post("/carrito/resumen", (req, res) => {
  const logContext = {
    request_id: crypto.randomUUID(),
    route: "/carrito/resumen",
    method: "POST",
  };

  try {
    const summary = summarizeCart(req.body || {});
    log("info", "resumen de carrito calculado", {
      ...logContext,
      status_code: 200,
    });
    return res.json(summary);
  } catch (error) {
    if (!(error instanceof CartError)) throw error;

    log("warn", "carrito invalido", {
      ...logContext,
      status_code: 400,
      error_type: "cart_validation_error",
    });
    return res.status(400).json({ error: "Carrito inválido" });
  }
});

app.post("/cotizar-envio", async (req, res) => {
  const logContext = {
    request_id: crypto.randomUUID(),
    route: "/cotizar-envio",
    method: "POST",
  };

  try {
    const options = await getShippingQuotes(req.body || {});
    return res.json({ options });
  } catch (error) {
    if (error instanceof ShippingInputError) {
      log("warn", "cotizacion de envio rechazada", {
        ...logContext,
        status_code: 400,
        error_type: "shipping_validation_error",
      });
      return res.status(400).json({ error: "No pudimos calcular el envío" });
    }

    const errorType =
      error instanceof ShippingUnavailableError
        ? error.type
        : "shipping_unavailable";
    log("error", "cotizacion de envio no disponible", {
      ...logContext,
      status_code: 503,
      error_type: errorType,
    });
    return res.status(503).json({ error: "No pudimos calcular el envío" });
  }
});

app.post("/sucursales-envio", async (req, res) => {
  const logContext = {
    request_id: crypto.randomUUID(),
    route: "/sucursales-envio",
    method: "POST",
  };

  try {
    const agencies = await listShippingAgencies(req.body || {});
    log("info", "agency_lookup_ok", { ...logContext, status_code: 200 });
    return res.json({ agencies });
  } catch (error) {
    const isInputError = error instanceof ShippingInputError;
    const errorType = error instanceof ShippingUnavailableError
      ? error.type
      : isInputError ? "agency_validation_error" : "shipping_unavailable";
    log(isInputError ? "warn" : "error", "agency_lookup_failed", {
      ...logContext,
      status_code: isInputError ? 400 : 503,
      error_type: errorType,
    });
    return res.status(isInputError ? 400 : 503).json({
      error: "No pudimos obtener las sucursales",
    });
  }
});

app.post("/webhook", async (req, res) => {
  const signatureHeader = req.headers["x-signature"];
  const logContext = {
    request_id: crypto.randomUUID(),
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
    logInvalidWebhookSignature(req, logContext);
    return res.status(401).json({ error: "Webhook inválido" });
  }

  if (
    typeof req.headers["x-request-id"] === "string" &&
    req.headers["x-request-id"] !== ""
  ) {
    logContext.request_id = req.headers["x-request-id"];
  }

  try {
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

    if (paymentId === undefined || paymentId === null || String(paymentId) === "") {
      log("warn", "identificador de pago ausente", {
        ...logContext,
        status_code: 200,
      });
      return res.json({ received: true });
    }

    log("info", "pago detectado en webhook", logContext);

    let paymentInfo;

    try {
      paymentInfo = await getPayment(paymentId);
    } catch (error) {
      log("error", "error consultando pago en mercado pago", {
        ...logContext,
        status_code: 503,
        error_type: getMercadoPagoErrorType(error),
      });
      return respondWebhookUnavailable(res);
    }

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
            status_code: 503,
            error_type: "supabase_error",
          });
          return respondWebhookUnavailable(res);
        }
      }
    } else {
      log("warn", "pago no aprobado", {
        ...logContext,
        payment_status: paymentInfo.status,
      });
    }
  } catch (error) {
    log("error", "error interno procesando webhook", {
      ...logContext,
      status_code: 503,
      error_type: "unexpected_processing_error",
    });
    return respondWebhookUnavailable(res);
  }

  return res.json({ received: true });
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

const PAYABLE_SHIPPING_OPTION_IDS = new Set([
  "micorreo:home:classic",
  "micorreo:home:express",
  "micorreo:agency:classic",
  "micorreo:agency:express",
]);
const MAX_NUMERIC_12_2_CENTS = 999999999999;

function getKnownCartTotalUnits(body, hasItems) {
  const items = hasItems ? body.items : [{ sku: body.sku, quantity: body.quantity }];
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CART_ITEMS) return null;

  let totalUnits = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !getProduct(item.sku) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      return null;
    }
    totalUnits += item.quantity;
    if (!Number.isSafeInteger(totalUnits)) return null;
  }
  return totalUnits;
}

function getPreferenceTotalCents(items) {
  let totalCents = 0;
  for (const item of items) {
    const unitPriceCents = Math.round(Number(item.unit_price) * 100);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error("invalid preference item amount");
    }
    totalCents += unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(totalCents)) {
      throw new Error("invalid preference total");
    }
  }
  return totalCents;
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

  const body = req.body || {};
  const hasItems = Object.prototype.hasOwnProperty.call(body, "items");
  const hasSku = Object.prototype.hasOwnProperty.call(body, "sku");
  const hasQuantity = Object.prototype.hasOwnProperty.call(body, "quantity");
  const { sku, quantity } = body;
  let cart;

  if (hasItems) {
    try {
      if (hasSku || hasQuantity) throw new CartError();
      const requestedUnits = getKnownCartTotalUnits(body, true);
      if (requestedUnits !== null && requestedUnits > MAX_QUOTE_UNITS) {
        return res.status(400).json({ error: "No pudimos calcular el envío" });
      }
      cart = resolveCheckoutCart(body);
    } catch (error) {
      if (!(error instanceof CartError)) throw error;
      log("warn", "carrito invalido", {
        ...logContext,
        status_code: 400,
        error_type: "cart_validation_error",
      });
      return res.status(400).json({ error: "Carrito inválido" });
    }
  } else {
    const product = getProduct(sku);
    if (!product) {
      return res.status(400).json({ error: "Producto no encontrado" });
    }
    if (Number.isSafeInteger(quantity) && quantity > MAX_QUOTE_UNITS) {
      return res.status(400).json({ error: "No pudimos calcular el envío" });
    }
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > product.maxQuantity
    ) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }
  }

  const shippingOptionId = body.shippingOptionId;
  if (typeof shippingOptionId !== "string" ||
      !PAYABLE_SHIPPING_OPTION_IDS.has(shippingOptionId)) {
    log("warn", "opcion de envio invalida", {
      ...logContext,
      status_code: 400,
      error_type: "shipping_option_invalid",
    });
    return res.status(400).json({ error: "Elegí una opción de envío" });
  }
  const isAgencyShipping = shippingOptionId.startsWith("micorreo:agency:");
  const shippingAgencyCode = typeof body.shippingAgencyCode === "string"
    ? body.shippingAgencyCode.trim()
    : "";

  let checkoutInput;
  try {
    checkoutInput = parseCheckoutInput(body);
  } catch (error) {
    if (!(error instanceof CheckoutInputError)) throw error;

    log("warn", "datos de checkout invalidos", {
      ...logContext,
      status_code: 400,
      error_type: "checkout_input_error",
    });
    return res.status(400).json({
      error: "Revisá los datos del comprador y la entrega",
    });
  }
  if (isAgencyShipping && !shippingAgencyCode) {
    log("warn", "agency_selection_invalid", {
      ...logContext,
      status_code: 400,
      error_type: "agency_code_required",
    });
    return res.status(400).json({ error: "Elegí una sucursal" });
  }

  if (!hasItems) {
    cart = resolveCheckoutCart({ items: [{ sku, quantity }] });
  }
  const { currency, subtotalCents, orderItems, preferenceItems } = cart;
  const totalUnits = orderItems.reduce((total, item) => total + item.quantity, 0);
  if (totalUnits > MAX_QUOTE_UNITS) {
    return res.status(400).json({ error: "No pudimos calcular el envío" });
  }

  let shippingOptions;
  try {
    shippingOptions = await getShippingQuotes({
      ...(hasItems ? { items: body.items } : { sku, quantity }),
      postalCodeDestination: checkoutInput.shipping_postal_code,
    });
  } catch (error) {
    if (error instanceof ShippingInputError) {
      log("warn", "cotizacion de envio rechazada", {
        ...logContext,
        status_code: 400,
        error_type: "shipping_validation_error",
      });
      return res.status(400).json({ error: "No pudimos calcular el envío" });
    }

    const errorType = error instanceof ShippingUnavailableError
      ? error.type
      : "shipping_unavailable";
    log("error", "cotizacion de envio no disponible", {
      ...logContext,
      status_code: 503,
      error_type: errorType,
    });
    return res.status(503).json({ error: "No pudimos calcular el envío" });
  }

  const selectedShipping = shippingOptions.find((option) =>
    option.id === shippingOptionId && option.provider === "micorreo" &&
    option.deliveryType === (isAgencyShipping ? "agency" : "home") &&
    ["classic", "express"].includes(option.service)
  );
  if (!selectedShipping) {
    log("warn", "opcion de envio no disponible", {
      ...logContext,
      status_code: 409,
      error_type: "shipping_option_unavailable",
    });
    return res.status(409).json({
      error: "La opción de envío ya no está disponible",
    });
  }

  let selectedAgency = null;
  if (isAgencyShipping) {
    let agencies;
    try {
      agencies = await listShippingAgencies({
        province: checkoutInput.shipping_province,
      });
    } catch (error) {
      const errorType = error instanceof ShippingUnavailableError
        ? error.type
        : "shipping_unavailable";
      log("error", "agency_lookup_failed", {
        ...logContext,
        status_code: 503,
        error_type: errorType,
      });
      return res.status(503).json({ error: "No pudimos obtener las sucursales" });
    }

    selectedAgency = agencies.find((agency) => agency.code === shippingAgencyCode) || null;
    if (!selectedAgency) {
      log("warn", "agency_selection_invalid", {
        ...logContext,
        status_code: 409,
        error_type: "agency_unavailable",
      });
      return res.status(409).json({ error: "La sucursal ya no está disponible" });
    }
    log("info", "agency_lookup_ok", { ...logContext, status_code: 200 });
  }

  const shippingCents = Math.round(Number(selectedShipping.price) * 100);
  const totalCents = subtotalCents + shippingCents;
  if (!Number.isSafeInteger(shippingCents) || shippingCents < 0 ||
      shippingCents > MAX_NUMERIC_12_2_CENTS ||
      !Number.isSafeInteger(totalCents) || totalCents < 1 ||
      totalCents > MAX_NUMERIC_12_2_CENTS) {
    return res.status(503).json({ error: "No pudimos calcular el envío" });
  }

  const productsSubtotal = subtotalCents / 100;
  const shippingAmount = shippingCents / 100;
  const expectedAmount = totalCents / 100;
  const shippingSnapshot = {
    provider: "micorreo",
    optionId: shippingOptionId,
    deliveryType: selectedShipping.deliveryType,
    service: selectedShipping.service,
    agency: selectedAgency,
  };
  const paymentItems = [
    ...preferenceItems,
    {
      title: "Envío",
      quantity: 1,
      unit_price: shippingAmount,
      currency_id: "ARS",
    },
  ];

  if (getPreferenceTotalCents(paymentItems) !== totalCents) {
    log("error", "total de preferencia inconsistente", {
      ...logContext,
      status_code: 500,
      error_type: "preference_total_mismatch",
    });
    return res.status(500).json({ error: "No se pudo iniciar el pago" });
  }

  log("info", "inicio de creacion de preferencia", logContext);

  let createdOrder;
  try {
    createdOrder = await createPendingOrder({
      expectedAmount,
      productsSubtotal,
      shippingAmount,
      shipping: shippingSnapshot,
      currency,
      customer: {
        firstName: checkoutInput.customer_first_name,
        lastName: checkoutInput.customer_last_name,
        email: checkoutInput.customer_email,
        phone: checkoutInput.customer_phone,
      },
      delivery: {
        province: checkoutInput.shipping_province,
        locality: checkoutInput.shipping_locality,
        postalCode: checkoutInput.shipping_postal_code,
        street: checkoutInput.shipping_street,
        streetNumber: checkoutInput.shipping_street_number,
        apartment: checkoutInput.shipping_apartment,
        notes: checkoutInput.shipping_notes,
      },
      items: orderItems,
    });

    if (
      Math.round(Number(createdOrder.amount) * 100) !== totalCents ||
      createdOrder.currency !== currency ||
      createdOrder.status !== "pending"
    ) {
      throw new Error("incompatible pending order RPC response");
    }

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

  try {
    const result = await createPreference({
      items: paymentItems,
      external_reference: createdOrder.external_reference,
      notification_url: `${baseUrl}/webhook?source_news=webhooks`,
      back_urls: {
        success: `${baseUrl}/success`,
        failure: `${baseUrl}/failure`,
        pending: `${baseUrl}/pending`,
      },
      auto_return: "approved",
    });

    log("info", "preferencia creada", logContext);

    return res.json({
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

    return res.status(500).json({
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
