const crypto = require("crypto");

const RECONCILIATION_STATES = Object.freeze({
  CREATED: "created",
  QUEUED: "queued",
});

class ShippingReconciliationRepositoryError extends Error {
  constructor(message = "invalid shipping reconciliation repository result") {
    super(message);
    this.name = "ShippingReconciliationRepositoryError";
  }
}

function createShippingReconciliationRepository(client, {
  randomUUID = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  if (!client || typeof client.rpc !== "function") {
    throw new ShippingReconciliationRepositoryError();
  }

  async function markUnknownAsCreated(options) {
    const orderId = readOrderId(options);
    return reconcile({
      rpcName: "reconcile_order_shipping_import_created",
      orderId,
      expectedState: RECONCILIATION_STATES.CREATED,
      outcome: "created",
    });
  }

  async function requeueUnknown(options) {
    const orderId = readOrderId(options);
    return reconcile({
      rpcName: "requeue_order_shipping_import_unknown",
      orderId,
      expectedState: RECONCILIATION_STATES.QUEUED,
      outcome: "requeued",
    });
  }

  async function reconcile({ rpcName, orderId, expectedState, outcome }) {
    if (!isPositiveDatabaseId(orderId)) {
      throw new ShippingReconciliationRepositoryError();
    }

    const normalizedOrderId = String(orderId);
    const reconciliationId = randomUUID();
    const reconciledAt = now();
    if (!isUuid(reconciliationId) || !isIsoTimestamp(reconciledAt)) {
      throw new ShippingReconciliationRepositoryError();
    }

    const { data, error } = await client.rpc(rpcName, {
      p_order_id: normalizedOrderId,
      p_reconciliation_id: reconciliationId,
      p_reconciled_at: reconciledAt,
    }).maybeSingle();
    if (error) throw error;
    if (!data) return { outcome: "no_change", orderId: normalizedOrderId };

    validateResult(data, expectedState, normalizedOrderId);
    return {
      outcome,
      orderId: data.order_id,
      attemptCount: data.attempt_count,
    };
  }

  return { markUnknownAsCreated, requeueUnknown };
}

let defaultRepository;

function getDefaultRepository() {
  if (!defaultRepository) {
    const { createClient } = require("@supabase/supabase-js");
    const { supabaseUrl, supabaseServiceRoleKey } = require("./config");
    defaultRepository = createShippingReconciliationRepository(
      createClient(supabaseUrl, supabaseServiceRoleKey)
    );
  }
  return defaultRepository;
}

function markUnknownAsCreated(args) {
  return getDefaultRepository().markUnknownAsCreated(args);
}

function requeueUnknown(args) {
  return getDefaultRepository().requeueUnknown(args);
}

function validateResult(row, expectedState, expectedOrderId) {
  if (!isPlainObject(row) || !isPositiveDatabaseId(row.order_id) ||
      String(row.order_id) !== expectedOrderId || row.state !== expectedState ||
      !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0) {
    throw new ShippingReconciliationRepositoryError();
  }
}

function readOrderId(options) {
  if (!isPlainObject(options) || Object.keys(options).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(options, "orderId") ||
      !isPositiveDatabaseId(options.orderId)) {
    throw new ShippingReconciliationRepositoryError();
  }
  return options.orderId;
}

function isPositiveDatabaseId(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
}

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  RECONCILIATION_STATES,
  ShippingReconciliationRepositoryError,
  createShippingReconciliationRepository,
  markUnknownAsCreated,
  requeueUnknown,
};
