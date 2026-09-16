jest.mock("../src/config", () => ({
  supabaseUrl: "https://supabase.test",
  supabaseServiceRoleKey: "not-a-real-key",
}));
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}));

const {
  CheckoutAttemptRepositoryError,
  createCheckoutAttemptsRepository,
} = require("../src/checkoutAttempts");

const ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const LEASE_ID = "660e8400-e29b-41d4-a716-446655440000";

function validAttempt(overrides = {}) {
  return {
    checkout_attempt_id: ATTEMPT_ID,
    order_id: 7,
    state: "reserved",
    mercadopago_preference_id: null,
    checkout_url: null,
    lease_token: null,
    lease_expires_at: null,
    ...overrides,
  };
}

function validOrder(overrides = {}) {
  return {
    id: 7,
    external_reference: "LEMONT-ORDER-7",
    products_subtotal: 1000,
    shipping_amount: 500,
    amount: 1500,
    currency: "ARS",
    status: "pending",
    customer_first_name: "Ana",
    customer_last_name: "Pérez",
    customer_email: "ana@example.test",
    customer_phone: "541123456789",
    shipping_province: "AR-B",
    shipping_locality: "La Plata",
    shipping_postal_code: "1900",
    shipping_street: "Calle 12",
    shipping_street_number: "345",
    shipping_apartment: null,
    shipping_notes: null,
    shipping_option_id: "micorreo:home:classic",
    shipping_delivery_type: "home",
    shipping_service: "classic",
    shipping_agency_code: null,
    ...overrides,
  };
}

function createClient({
  attempt = validAttempt(),
  order = validOrder(),
  items = [{
    product_sku: "SKU-1", product_name: "Snapshot", product_size: "S",
    quantity: 1, unit_price: 1000,
  }],
  claimed = validAttempt({ state: "creating_preference", lease_token: LEASE_ID,
    lease_expires_at: "2030-01-01T00:00:30.000Z" }),
} = {}) {
  const updates = [];
  const reads = [];
  const rpc = jest.fn(() => ({
    maybeSingle: jest.fn(async () => ({ data: claimed, error: null })),
  }));
  const from = jest.fn((table) => {
    const query = {
      mode: "read",
      filters: [],
      select(columns) {
        reads.push({ table, columns });
        return this;
      },
      update(values) {
        this.mode = "update";
        this.values = values;
        updates.push({ table, values, filters: this.filters });
        return this;
      },
      eq(field, value) {
        this.filters.push([field, value]);
        return this;
      },
      maybeSingle: async function maybeSingle() {
        if (this.mode === "update") {
          const data = this.values.state === "ready"
            ? validAttempt({
              state: "ready",
              mercadopago_preference_id: this.values.mercadopago_preference_id,
              checkout_url: this.values.checkout_url,
            })
            : validAttempt({ state: "unknown" });
          return { data, error: null };
        }
        return { data: table === "checkout_attempts" ? attempt : order, error: null };
      },
      then(resolve, reject) {
        return Promise.resolve({ data: items, error: null }).then(resolve, reject);
      },
    };
    return query;
  });
  return { client: { from, rpc }, from, rpc, updates, reads };
}

describe("checkoutAttempts repository", () => {
  test("lee attempt, order e items y valida el snapshot", async () => {
    const fake = createClient();
    const repository = createCheckoutAttemptsRepository(fake.client);
    const result = await repository.findCheckoutAttempt(ATTEMPT_ID);

    expect(result.order.external_reference).toBe("LEMONT-ORDER-7");
    expect(result.order.items).toEqual([
      {
        product_sku: "SKU-1", product_name: "Snapshot", product_size: "S",
        quantity: 1, unit_price: 1000,
      },
    ]);
    expect(fake.from).toHaveBeenCalledWith("checkout_attempts");
    expect(fake.from).toHaveBeenCalledWith("orders");
    expect(fake.from).toHaveBeenCalledWith("order_items");
  });

  test("rechaza shapes Supabase incompletos", async () => {
    const fake = createClient({ attempt: validAttempt({ state: "invented" }) });
    const repository = createCheckoutAttemptsRepository(fake.client);
    await expect(repository.findCheckoutAttempt(ATTEMPT_ID))
      .rejects.toBeInstanceOf(CheckoutAttemptRepositoryError);
  });

  test("claim usa la RPC atómica con los tres parámetros", async () => {
    const fake = createClient();
    const repository = createCheckoutAttemptsRepository(fake.client);
    await repository.claimCheckoutAttempt({
      checkoutAttemptId: ATTEMPT_ID,
      leaseToken: LEASE_ID,
      leaseExpiresAt: "2030-01-01T00:00:30.000Z",
    });
    expect(fake.rpc).toHaveBeenCalledWith("claim_checkout_attempt", {
      p_checkout_attempt_id: ATTEMPT_ID,
      p_lease_token: LEASE_ID,
      p_lease_expires_at: "2030-01-01T00:00:30.000Z",
    });
  });

  test.each([
    ["ready", "markCheckoutAttemptReady", {
      checkoutAttemptId: ATTEMPT_ID,
      leaseToken: LEASE_ID,
      preferenceId: "PREF-1",
      checkoutUrl: "https://checkout.example/1",
      updatedAt: "2030-01-01T00:00:01.000Z",
    }],
    ["unknown", "markCheckoutAttemptUnknown", {
      checkoutAttemptId: ATTEMPT_ID,
      leaseToken: LEASE_ID,
      updatedAt: "2030-01-01T00:00:02.000Z",
    }],
  ])("transición %s es holder-only, actualiza updated_at y nunca IDs", async (
    _state, method, args
  ) => {
    const fake = createClient();
    const repository = createCheckoutAttemptsRepository(fake.client);
    await repository[method](args);

    expect(fake.updates).toHaveLength(1);
    const update = fake.updates[0];
    expect(update.values.updated_at).toBe(args.updatedAt);
    expect(update.values).not.toHaveProperty("checkout_attempt_id");
    expect(update.values).not.toHaveProperty("order_id");
    expect(update.filters).toEqual(expect.arrayContaining([
      ["checkout_attempt_id", ATTEMPT_ID],
      ["state", "creating_preference"],
      ["lease_token", LEASE_ID],
    ]));
  });
});
