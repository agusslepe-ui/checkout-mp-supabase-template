const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceRoleKey } = require("./config");
const { log } = require("./logger");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function importesCoinciden(a, b) {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

async function createPendingOrder({
  expectedAmount,
  currency,
  customer,
  delivery,
  items,
}) {
  const { data, error } = await supabase
    .rpc("create_pending_order_with_items", {
      p_expected_amount: expectedAmount,
      p_currency: currency,
      p_customer_first_name: customer.firstName,
      p_customer_last_name: customer.lastName,
      p_customer_email: customer.email,
      p_customer_phone: customer.phone,
      p_shipping_province: delivery.province,
      p_shipping_locality: delivery.locality,
      p_shipping_postal_code: delivery.postalCode,
      p_shipping_street: delivery.street,
      p_shipping_street_number: delivery.streetNumber,
      p_shipping_apartment: delivery.apartment,
      p_shipping_notes: delivery.notes,
      p_items: items,
    })
    .single();

  if (error) {
    throw error;
  }

  const requiredFields = [
    "order_id",
    "external_reference",
    "amount",
    "currency",
    "status",
  ];
  const hasValidOrderId =
    (typeof data?.order_id === "number" &&
      Number.isSafeInteger(data.order_id) &&
      data.order_id > 0) ||
    (typeof data?.order_id === "string" && /^[1-9][0-9]*$/.test(data.order_id));

  if (
    !data ||
    typeof data !== "object" ||
    !requiredFields.every((field) => Object.prototype.hasOwnProperty.call(data, field)) ||
    !hasValidOrderId ||
    typeof data.external_reference !== "string" ||
    data.external_reference.trim() === "" ||
    !Number.isFinite(Number(data.amount)) ||
    typeof data.currency !== "string" ||
    typeof data.status !== "string"
  ) {
    throw new Error("invalid pending order RPC response");
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

module.exports = {
  createPendingOrder,
  importesCoinciden,
  markOrderAsPaid,
};
