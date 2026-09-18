const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceRoleKey } = require("./config");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const SHIPPING_IMPORT_STATES = Object.freeze({
  NOT_REQUESTED: "not_requested",
  QUEUED: "queued",
  PROCESSING: "processing",
  CREATED: "created",
  RETRYABLE: "retryable",
  UNKNOWN: "unknown",
  FAILED: "failed",
});

const STATE_VALUES = new Set(Object.values(SHIPPING_IMPORT_STATES));

class ShippingImportRepositoryError extends Error {
  constructor(message = "invalid shipping import repository result") {
    super(message);
    this.name = "ShippingImportRepositoryError";
  }
}

function createShippingImportsRepository(client = supabase) {
  async function claimNextShippingImport({ leaseToken, leaseExpiresAt }) {
    const { data, error } = await client
      .rpc("claim_order_shipping_import", {
        p_lease_token: leaseToken,
        p_lease_expires_at: leaseExpiresAt,
      })
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    validateClaim(data, leaseToken);
    return data;
  }

  async function completeShippingImport({
    orderId,
    leaseToken,
    providerCreatedAt = null,
    importedAt = new Date().toISOString(),
  }) {
    return transition("complete_order_shipping_import", {
      p_order_id: orderId,
      p_lease_token: leaseToken,
      p_provider_created_at: providerCreatedAt,
      p_imported_at: importedAt,
    }, SHIPPING_IMPORT_STATES.CREATED);
  }

  async function retryShippingImport({ orderId, leaseToken, nextAttemptAt, errorType }) {
    return transition("retry_order_shipping_import", {
      p_order_id: orderId,
      p_lease_token: leaseToken,
      p_next_attempt_at: nextAttemptAt,
      p_error_type: errorType,
    }, SHIPPING_IMPORT_STATES.RETRYABLE);
  }

  async function markShippingImportUnknown({ orderId, leaseToken, errorType }) {
    return transition("mark_order_shipping_import_unknown", {
      p_order_id: orderId,
      p_lease_token: leaseToken,
      p_error_type: errorType,
    }, SHIPPING_IMPORT_STATES.UNKNOWN);
  }

  async function failShippingImport({ orderId, leaseToken, errorType }) {
    return transition("fail_order_shipping_import", {
      p_order_id: orderId,
      p_lease_token: leaseToken,
      p_error_type: errorType,
    }, SHIPPING_IMPORT_STATES.FAILED);
  }

  async function transition(rpcName, args, expectedState) {
    const { data, error } = await client.rpc(rpcName, args).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    validateImport(data, expectedState);
    return data;
  }

  async function expireShippingImportLeases() {
    const { data, error } = await client.rpc("expire_order_shipping_import_leases");
    if (error) throw error;
    if (!Array.isArray(data)) throw new ShippingImportRepositoryError();
    data.forEach((row) => validateImport(row, SHIPPING_IMPORT_STATES.UNKNOWN));
    return data;
  }

  return {
    claimNextShippingImport,
    completeShippingImport,
    retryShippingImport,
    markShippingImportUnknown,
    failShippingImport,
    expireShippingImportLeases,
  };
}

function validateImport(row, expectedState) {
  if (!isPlainObject(row) || !isPositiveDatabaseId(row.order_id) ||
      row.state !== expectedState || !STATE_VALUES.has(row.state) ||
      !isNonEmptyString(row.ext_order_id) ||
      !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 ||
      !isNullableString(row.lease_token) || !isNullableString(row.lease_expires_at)) {
    throw new ShippingImportRepositoryError();
  }
}

function validateClaim(row, leaseToken) {
  validateImport(row, SHIPPING_IMPORT_STATES.PROCESSING);
  const positiveIntegerFields = ["weight_grams", "height_cm", "width_cm", "length_cm"];
  const requiredStrings = [
    "customer_first_name", "customer_last_name", "customer_email", "customer_phone",
    "shipping_country_code", "shipping_province", "shipping_locality",
    "shipping_postal_code", "shipping_street", "shipping_street_number",
    "shipping_delivery_type", "shipping_service",
  ];
  if (row.lease_token !== leaseToken || !isNonEmptyString(row.lease_expires_at) ||
      !positiveIntegerFields.every((field) => Number.isSafeInteger(row[field]) && row[field] > 0) ||
      !Number.isFinite(Number(row.declared_value)) || Number(row.declared_value) < 0 ||
      !requiredStrings.every((field) => isNonEmptyString(row[field])) ||
      !isNullableString(row.shipping_apartment) || !isNullableString(row.shipping_notes) ||
      !isNullableString(row.shipping_agency_code)) {
    throw new ShippingImportRepositoryError();
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveDatabaseId(value) {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^[1-9][0-9]*$/.test(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

const ShippingImportsRepository = createShippingImportsRepository();

module.exports = {
  SHIPPING_IMPORT_STATES,
  ShippingImportRepositoryError,
  createShippingImportsRepository,
  ...ShippingImportsRepository,
};
