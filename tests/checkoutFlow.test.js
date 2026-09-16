jest.mock("../src/checkoutAttempts", () => ({}));
jest.mock("../src/payments", () => ({
  createPreference: jest.fn(),
  searchPreferencesByExternalReference: jest.fn(),
}));

const {
  CHECKOUT_LEASE_MS,
  CheckoutFlowError,
  buildPreferenceFromSnapshot,
  isCheckoutAttemptUniqueViolation,
  processCheckoutAttempt,
} = require("../src/checkoutFlow");

const ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const LEASE_ID = "660e8400-e29b-41d4-a716-446655440000";

function snapshot(overrides = {}) {
  const orderOverrides = overrides.order || {};
  return {
    checkout_attempt_id: ATTEMPT_ID,
    order_id: 1,
    state: "reserved",
    mercadopago_preference_id: null,
    checkout_url: null,
    lease_token: null,
    lease_expires_at: null,
    ...overrides,
    order: {
      id: 1,
      external_reference: "LEMONT-ORDER-SNAPSHOT",
      products_subtotal: 2000,
      shipping_amount: 500,
      amount: 2500,
      currency: "ARS",
      status: "pending",
      customer_first_name: "Ana María",
      customer_last_name: "O'Connor",
      customer_email: "ana@example.test",
      customer_phone: "541123456789",
      shipping_province: "AR-B",
      shipping_locality: "La Plata",
      shipping_postal_code: "B1900ABC",
      shipping_street: "Calle 12",
      shipping_street_number: "345",
      shipping_apartment: null,
      shipping_notes: "Portón negro",
      shipping_option_id: "micorreo:home:classic",
      shipping_delivery_type: "home",
      shipping_service: "classic",
      shipping_agency_code: null,
      items: [{
        product_sku: "LEM-REM-001-S",
        product_name: "Nombre histórico",
        quantity: 2,
        unit_price: 1000,
      }],
      ...orderOverrides,
    },
  };
}

function identity(overrides = {}) {
  return {
    products: [{ sku: "LEM-REM-001-S", quantity: 2 }],
    customer: {
      firstName: "Ana María",
      lastName: "O'Connor",
      email: "ana@example.test",
      phone: "541123456789",
    },
    delivery: {
      province: "AR-B",
      locality: "La Plata",
      postalCode: "B1900ABC",
      street: "Calle 12",
      streetNumber: "345",
      apartment: null,
      notes: "Portón negro",
    },
    shippingOptionId: "micorreo:home:classic",
    shippingAgencyCode: null,
    ...overrides,
  };
}

function dependencies({ currentAttempt = snapshot(), searchResult, createResult } = {}) {
  const repository = {
    claimCheckoutAttempt: jest.fn(async ({ leaseToken, leaseExpiresAt }) => ({
      ...currentAttempt,
      state: "creating_preference",
      lease_token: leaseToken,
      lease_expires_at: leaseExpiresAt,
    })),
    findCheckoutAttempt: jest.fn(async () => currentAttempt),
    markCheckoutAttemptReady: jest.fn(async ({ preferenceId, checkoutUrl }) => ({
      ...currentAttempt,
      state: "ready",
      mercadopago_preference_id: preferenceId,
      checkout_url: checkoutUrl,
      lease_token: null,
      lease_expires_at: null,
    })),
    markCheckoutAttemptUnknown: jest.fn(async () => ({
      ...currentAttempt,
      state: "unknown",
      lease_token: null,
      lease_expires_at: null,
    })),
  };
  const paymentGateway = {
    createPreference: jest.fn(async () => createResult || ({
      id: "PREF-NEW",
      init_point: "https://checkout.example/new",
    })),
    searchPreferencesByExternalReference: jest.fn(async () => searchResult || ({
      count: 0,
      preference: null,
    })),
  };
  return { repository, paymentGateway };
}

async function run(attempt, deps, overrides = {}) {
  return processCheckoutAttempt({
    attempt,
    identity: identity(),
    baseUrl: "https://example.test",
    now: () => 1_700_000_000_000,
    randomUUID: () => LEASE_ID,
    ...deps,
    ...overrides,
  });
}

describe("flujo durable de checkout", () => {
  test("READY devuelve la referencia durable sin claim ni Mercado Pago", async () => {
    const attempt = snapshot({
      state: "ready",
      mercadopago_preference_id: "PREF-READY",
      checkout_url: "https://checkout.example/ready",
    });
    const deps = dependencies({ currentAttempt: attempt });

    await expect(run(attempt, deps)).resolves.toEqual({
      preference_id: "PREF-READY",
      init_point: "https://checkout.example/ready",
    });
    expect(deps.repository.claimCheckoutAttempt).not.toHaveBeenCalled();
    expect(deps.paymentGateway.createPreference).not.toHaveBeenCalled();
    expect(deps.paymentGateway.searchPreferencesByExternalReference).not.toHaveBeenCalled();
  });

  test("un lease activo responde 409 y no toca Mercado Pago", async () => {
    const attempt = snapshot({
      state: "creating_preference",
      lease_token: LEASE_ID,
      lease_expires_at: new Date(1_700_000_001_000).toISOString(),
    });
    const deps = dependencies({ currentAttempt: attempt });

    await expect(run(attempt, deps)).rejects.toMatchObject({
      status: 409,
      type: "checkout_attempt_busy",
    });
    expect(deps.repository.claimCheckoutAttempt).not.toHaveBeenCalled();
    expect(deps.paymentGateway.createPreference).not.toHaveBeenCalled();
  });

  test("reserved adquiere lease de 30 segundos y persiste READY", async () => {
    const attempt = snapshot();
    const deps = dependencies({ currentAttempt: attempt });

    await expect(run(attempt, deps)).resolves.toEqual({
      preference_id: "PREF-NEW",
      init_point: "https://checkout.example/new",
    });
    expect(deps.repository.claimCheckoutAttempt).toHaveBeenCalledWith({
      checkoutAttemptId: ATTEMPT_ID,
      leaseToken: LEASE_ID,
      leaseExpiresAt: new Date(1_700_000_000_000 + CHECKOUT_LEASE_MS).toISOString(),
    });
    expect(deps.repository.markCheckoutAttemptReady).toHaveBeenCalledWith({
      checkoutAttemptId: ATTEMPT_ID,
      leaseToken: LEASE_ID,
      preferenceId: "PREF-NEW",
      checkoutUrl: "https://checkout.example/new",
    });
  });

  test("solo el ganador del claim crea una preferencia", async () => {
    const attempt = snapshot();
    let claimed = false;
    const deps = dependencies({ currentAttempt: attempt });
    deps.repository.claimCheckoutAttempt.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return { ...attempt, state: "creating_preference" };
    });
    deps.repository.findCheckoutAttempt.mockResolvedValue({
      ...attempt,
      state: "creating_preference",
      lease_token: LEASE_ID,
      lease_expires_at: new Date(1_700_000_030_000).toISOString(),
    });

    const first = run(attempt, deps);
    const second = run(attempt, deps);
    await expect(first).resolves.toEqual(expect.objectContaining({ preference_id: "PREF-NEW" }));
    await expect(second).rejects.toMatchObject({ status: 409 });
    expect(deps.paymentGateway.createPreference).toHaveBeenCalledTimes(1);
  });

  test.each(["unknown", "creating_preference"])(
    "%s recupera por external_reference antes de recrear", async (state) => {
      const attempt = snapshot({
        state,
        ...(state === "creating_preference" ? {
          lease_token: LEASE_ID,
          lease_expires_at: new Date(1_699_999_999_000).toISOString(),
        } : {}),
      });
      const deps = dependencies({ currentAttempt: attempt });

      await run(attempt, deps);
      expect(deps.paymentGateway.searchPreferencesByExternalReference)
        .toHaveBeenCalledWith("LEMONT-ORDER-SNAPSHOT");
      expect(deps.paymentGateway.searchPreferencesByExternalReference.mock.invocationCallOrder[0])
        .toBeLessThan(deps.paymentGateway.createPreference.mock.invocationCallOrder[0]);
    }
  );

  test("recovery único persiste READY y no crea otra preferencia", async () => {
    const attempt = snapshot({ state: "unknown" });
    const deps = dependencies({
      currentAttempt: attempt,
      searchResult: {
        count: 1,
        preference: {
          id: "PREF-RECOVERED",
          checkout_url: "https://checkout.example/recovered",
        },
      },
    });

    await expect(run(attempt, deps)).resolves.toEqual({
      preference_id: "PREF-RECOVERED",
      init_point: "https://checkout.example/recovered",
    });
    expect(deps.paymentGateway.createPreference).not.toHaveBeenCalled();
    expect(deps.repository.markCheckoutAttemptReady).toHaveBeenCalledWith(
      expect.objectContaining({ preferenceId: "PREF-RECOVERED" })
    );
  });

  test("recovery cero reclama y crea desde el snapshot", async () => {
    const attempt = snapshot({ state: "unknown" });
    const deps = dependencies({ currentAttempt: attempt });
    await run(attempt, deps);
    expect(deps.repository.claimCheckoutAttempt).toHaveBeenCalledTimes(1);
    expect(deps.paymentGateway.createPreference).toHaveBeenCalledTimes(1);
  });

  test("recovery múltiple deja UNKNOWN y no elige arbitrariamente", async () => {
    const attempt = snapshot({ state: "unknown" });
    const deps = dependencies({
      currentAttempt: attempt,
      searchResult: { count: 2, preference: null },
    });

    await expect(run(attempt, deps)).rejects.toMatchObject({ status: 503 });
    expect(deps.repository.markCheckoutAttemptUnknown).toHaveBeenCalledWith({
      checkoutAttemptId: ATTEMPT_ID,
      leaseToken: LEASE_ID,
    });
    expect(deps.paymentGateway.createPreference).not.toHaveBeenCalled();
  });

  test("un error ambiguo al crear deja UNKNOWN y no reintenta", async () => {
    const attempt = snapshot();
    const deps = dependencies({ currentAttempt: attempt });
    deps.paymentGateway.createPreference.mockRejectedValue(new Error("network detail"));

    await expect(run(attempt, deps)).rejects.toMatchObject({
      status: 503,
      type: "preference_creation_ambiguous",
    });
    expect(deps.repository.markCheckoutAttemptUnknown).toHaveBeenCalledTimes(1);
    expect(deps.paymentGateway.createPreference).toHaveBeenCalledTimes(1);
  });

  test("rechaza total persistido inconsistente antes de Mercado Pago", async () => {
    const attempt = snapshot({ order: { amount: 2499 } });
    const deps = dependencies({ currentAttempt: attempt });

    await expect(run(attempt, deps)).rejects.toMatchObject({
      status: 503,
      type: "persisted_snapshot_invalid",
    });
    expect(deps.paymentGateway.createPreference).not.toHaveBeenCalled();
    expect(deps.repository.markCheckoutAttemptUnknown).toHaveBeenCalledTimes(1);
  });

  test("reconstruye items, envío y external_reference solo desde el snapshot", () => {
    const body = buildPreferenceFromSnapshot(snapshot(), "https://example.test");
    expect(body).toEqual({
      items: [
        { title: "Nombre histórico", quantity: 2, unit_price: 1000, currency_id: "ARS" },
        { title: "Envío", quantity: 1, unit_price: 500, currency_id: "ARS" },
      ],
      external_reference: "LEMONT-ORDER-SNAPSHOT",
      notification_url: "https://example.test/webhook?source_news=webhooks",
      back_urls: {
        success: "https://example.test/success",
        failure: "https://example.test/failure",
        pending: "https://example.test/pending",
      },
      auto_return: "approved",
    });
  });
});

describe("detección acotada de carrera 23505", () => {
  test("acepta solo la constraint de checkout_attempt_id", () => {
    expect(isCheckoutAttemptUniqueViolation({
      code: "23505",
      constraint: "checkout_attempts_checkout_attempt_id_key",
    })).toBe(true);
    expect(isCheckoutAttemptUniqueViolation({
      code: "23505",
      message: "duplicate checkout_attempts_checkout_attempt_id_key",
    })).toBe(true);
  });

  test.each([
    { code: "23505", constraint: "orders_external_reference_key" },
    { code: "22023", constraint: "checkout_attempts_checkout_attempt_id_key" },
    new Error("checkout_attempts_checkout_attempt_id_key"),
  ])("no convierte conflictos ajenos en retry", (error) => {
    expect(isCheckoutAttemptUniqueViolation(error)).toBe(false);
  });
});
