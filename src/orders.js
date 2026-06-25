const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceRoleKey } = require("./config");
const { log } = require("./logger");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

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

module.exports = {
  createPendingOrder,
  importesCoinciden,
  markOrderAsPaid,
};
