const fs = require("fs");
const path = require("path");

const {
  ShippingReconciliationRepositoryError,
  createShippingReconciliationRepository,
} = require("../src/shippingReconciliation");

const RECONCILIATION_ID = "660e8400-e29b-41d4-a716-446655440000";
const RECONCILED_AT = "2030-01-01T00:00:00.000Z";

function fakeClient(results = {}) {
  const rpc = jest.fn((name) => ({
    maybeSingle: jest.fn(async () => results[name] || { data: null, error: null }),
  }));
  return { client: { rpc }, rpc };
}

function repositoryFor(fake) {
  return createShippingReconciliationRepository(fake.client, {
    randomUUID: () => RECONCILIATION_ID,
    now: () => RECONCILED_AT,
  });
}

describe("shipping reconciliation repository", () => {
  test.each([
    ["markUnknownAsCreated", "reconcile_order_shipping_import_created", "created", "created"],
    ["requeueUnknown", "requeue_order_shipping_import_unknown", "queued", "requeued"],
  ])("%s genera evidencia y llama exactamente una RPC", async (
    method, rpcName, state, outcome
  ) => {
    const fake = fakeClient({
      [rpcName]: {
        data: { order_id: "123", state, attempt_count: 2 },
        error: null,
      },
    });

    await expect(repositoryFor(fake)[method]({ orderId: "123" })).resolves.toEqual({
      outcome,
      orderId: "123",
      attemptCount: 2,
    });
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith(rpcName, {
      p_order_id: "123",
      p_reconciliation_id: RECONCILIATION_ID,
      p_reconciled_at: RECONCILED_AT,
    });
  });

  test.each(["markUnknownAsCreated", "requeueUnknown"])(
    "%s traduce cero filas a no_change sin segunda operaciÃ³n",
    async (method) => {
      const fake = fakeClient();
      await expect(repositoryFor(fake)[method]({ orderId: "123" })).resolves.toEqual({
        outcome: "no_change",
        orderId: "123",
      });
      expect(fake.rpc).toHaveBeenCalledTimes(1);
    }
  );

  test("requeue humana de unknown preserva attempt_count 4", async () => {
    const fake = fakeClient({
      requeue_order_shipping_import_unknown: {
        data: { order_id: "123", state: "queued", attempt_count: 4 },
        error: null,
      },
    });

    await expect(repositoryFor(fake).requeueUnknown({ orderId: "123" })).resolves.toEqual({
      outcome: "requeued",
      orderId: "123",
      attemptCount: 4,
    });
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });

  test.each([
    {},
    { orderId: 0 },
    { orderId: "01" },
    { orderId: "9223372036854775808" },
    { orderId: "123", extOrderId: "forbidden" },
    { orderId: "123", providerCreatedAt: RECONCILED_AT },
    { orderId: "123", payload: {} },
  ])("rechaza argumentos no mÃ­nimos %# antes de RPC", async (options) => {
    const fake = fakeClient();
    await expect(repositoryFor(fake).markUnknownAsCreated(options))
      .rejects.toBeInstanceOf(ShippingReconciliationRepositoryError);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  test("rechaza respuesta con estado, order o attempt inesperado", async () => {
    const fake = fakeClient({
      reconcile_order_shipping_import_created: {
        data: { order_id: "999", state: "queued", attempt_count: -1 },
        error: null,
      },
    });
    await expect(repositoryFor(fake).markUnknownAsCreated({ orderId: "123" }))
      .rejects.toBeInstanceOf(ShippingReconciliationRepositoryError);
  });

  test("propaga error Supabase sin intentar update directo", async () => {
    const databaseError = new Error("database unavailable");
    const fake = fakeClient({
      reconcile_order_shipping_import_created: { data: null, error: databaseError },
    });
    await expect(repositoryFor(fake).markUnknownAsCreated({ orderId: "123" }))
      .rejects.toBe(databaseError);
    expect(fake.rpc).toHaveBeenCalledTimes(1);

    const source = fs.readFileSync(
      path.join(__dirname, "../src/shippingReconciliation.js"),
      "utf8"
    );
    expect(source).not.toMatch(/\.from\s*\(|update\s+public\./i);
    expect(source).not.toMatch(/micorreo|\/shipping\/import|\bfetch\s*\(/i);
  });
});
