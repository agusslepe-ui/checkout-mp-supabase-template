const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceRoleKey } = require("./config");
const { log } = require("./logger");
const { getPackageProfile } = require("./packageProfiles");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function importesCoinciden(a, b) {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

async function createPendingOrder({
  checkoutAttemptId,
  expectedAmount,
  productsSubtotal,
  shippingAmount,
  shipping,
  currency,
  customer,
  delivery,
  items,
}) {
  const totalUnits = items.reduce((total, item) => total + item.quantity, 0);
  const packageProfile = getPackageProfile(totalUnits);
  if (!packageProfile) {
    throw new Error("invalid package profile for pending order");
  }

  const { data, error } = await supabase
    .rpc("create_pending_order_with_items_v3", {
      p_checkout_attempt_id: checkoutAttemptId,
      p_expected_amount: expectedAmount,
      p_products_subtotal: productsSubtotal,
      p_shipping_amount: shippingAmount,
      p_shipping_provider: shipping.provider,
      p_shipping_option_id: shipping.optionId,
      p_shipping_delivery_type: shipping.deliveryType,
      p_shipping_service: shipping.service,
      p_shipping_agency_code: shipping.agency?.code ?? null,
      p_shipping_agency_name: shipping.agency?.name ?? null,
      p_shipping_agency_street_name: shipping.agency?.streetName ?? null,
      p_shipping_agency_street_number: shipping.agency?.streetNumber ?? null,
      p_shipping_agency_locality: shipping.agency?.locality ?? null,
      p_shipping_agency_postal_code: shipping.agency?.postalCode ?? null,
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
      p_package_weight_grams: packageProfile.weight,
      p_package_height_cm: packageProfile.height,
      p_package_width_cm: packageProfile.width,
      p_package_length_cm: packageProfile.length,
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

  const updatedAt = new Date().toISOString();
  const { data: updatedOrder, error } = await supabase
    .rpc("mark_order_paid_and_queue_shipping_import_v2", {
      p_external_reference: external_reference,
      p_mercadopago_payment_id: mercadopago_payment_id,
      p_mercadopago_status: mercadopago_status,
      p_transaction_amount: transaction_amount,
      p_currency: currency_id,
      p_updated_at: updatedAt,
    })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!updatedOrder) {
    log("info", "webhook duplicado ignorado", logContext);
    return null;
  }

  const hasValidOrderId =
    (typeof updatedOrder.order_id === "number" &&
      Number.isSafeInteger(updatedOrder.order_id) &&
      updatedOrder.order_id > 0) ||
    (typeof updatedOrder.order_id === "string" &&
      /^[1-9][0-9]*$/.test(updatedOrder.order_id));

  if (
    !hasValidOrderId ||
    updatedOrder.status !== "paid" ||
    typeof updatedOrder.shipping_queued !== "boolean"
  ) {
    throw new Error("invalid paid order RPC response");
  }

  return updatedOrder;
}

module.exports = {
  createPendingOrder,
  importesCoinciden,
  markOrderAsPaid,
};
