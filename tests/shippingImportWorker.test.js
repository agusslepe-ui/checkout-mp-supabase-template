jest.mock("../src/config", () => ({
  supabaseUrl: "https://supabase.test",
  supabaseServiceRoleKey: "not-a-real-key",
  micorreoBaseUrl: "https://micorreo.test/v1",
  micorreoUser: "fixture-user",
  micorreoPassword: "fixture-password",
  micorreoCustomerId: "backend-customer",
  shippingOriginPostalCode: "1000",
}));
jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn(() => ({})) }));

const fs = require("fs");
const path = require("path");
const { ShippingProviderError } = require("../src/shippingProvider");
const {
  SHIPPING_IMPORT_LEASE_MS,
  RETRY_BACKOFF_MS,
  createShippingImportWorker,
  normalizeDeclaredValue,
} = require("../src/shippingImportWorker");

const NOW = "2030-01-01T00:00:00.000Z";
const LEASE_TOKEN = "660e8400-e29b-41d4-a716-446655440000";

function claim(overrides = {}) {
  return {
    order_id: 42,
    ext_order_id: "LEMONT-ORDER-42",
    state: "processing",
    attempt_count: 1,
    lease_token: LEASE_TOKEN,
    lease_expires_at: "2030-01-01T00:01:00.000Z",
    weight_grams: 300,
    height_cm: 5,
    width_cm: 25,
    length_cm: 35,
    declared_value: 2000,
    customer_first_name: "Ana",
    customer_last_name: "Perez",
    customer_email: "ana@example.test",
    customer_phone: "541123456789",
    shipping_country_code: "AR",
    shipping_province: "AR-J",
    shipping_locality: "San Juan",
    shipping_postal_code: "5400",
    shipping_street: "Mitre",
    shipping_street_number: "123",
    shipping_apartment: null,
    shipping_notes: null,
    shipping_delivery_type: "home",
    shipping_service: "classic",
    shipping_agency_code: null,
    ...overrides,
  };
}

function repository(claimResult = claim()) {
  return {
    claimNextShippingImport: jest.fn().mockResolvedValue(claimResult),
    completeShippingImport: jest.fn().mockResolvedValue({ state: "created" }),
    retryShippingImport: jest.fn().mockResolvedValue({ state: "retryable" }),
    markShippingImportUnknown: jest.fn().mockResolvedValue({ state: "unknown" }),
    failShippingImport: jest.fn().mockResolvedValue({ state: "failed" }),
    expireShippingImportLeases: jest.fn().mockResolvedValue([]),
  };
}

function worker({ repo = repository(), service, ...overrides } = {}) {
  const resolvedService = service || {
    importShipment: jest.fn().mockResolvedValue({ createdAt: "2030-01-01T00:00:05.000Z" }),
  };
  return {
    repo,
    service: resolvedService,
    instance: createShippingImportWorker({
      repository: repo,
      service: resolvedService,
      createLeaseToken: () => LEASE_TOKEN,
      now: () => new Date(NOW),
      ...overrides,
    }),
  };
}

function providerError(type, details = {}) {
  return new ShippingProviderError(type, details.status ?? null, details);
}

describe("T-022.4 shipping import worker", () => {
  test("sin trabajo devuelve idle y no llama service ni transiciones", async () => {
    const setup = worker({ repo: repository(null) });
    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({ outcome: "idle" });
    expect(setup.repo.claimNextShippingImport).toHaveBeenCalledWith({
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2030-01-01T00:01:00.000Z",
    });
    expect(setup.service.importShipment).not.toHaveBeenCalled();
    expect(setup.repo.completeShippingImport).not.toHaveBeenCalled();
  });

  test("claim → service → created conserva snapshot, lease y attempt_count", async () => {
    const row = claim({ declared_value: "2000.00", attempt_count: 2 });
    const setup = worker({ repo: repository(row) });
    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "created", orderId: 42, attemptCount: 2,
    });
    expect(setup.repo.claimNextShippingImport).toHaveBeenCalledTimes(1);
    expect(setup.service.importShipment).toHaveBeenCalledTimes(1);
    expect(setup.service.importShipment).toHaveBeenCalledWith({
      ...row,
      declared_value: 2000,
    });
    expect(setup.repo.completeShippingImport).toHaveBeenCalledWith({
      orderId: 42,
      leaseToken: LEASE_TOKEN,
      providerCreatedAt: "2030-01-01T00:00:05.000Z",
      importedAt: NOW,
    });
  });

  test.each([
    [1, 60 * 1000],
    [2, 5 * 60 * 1000],
    [3, 15 * 60 * 1000],
  ])("RATE_LIMIT attempt %s usa backoff determinista", async (attemptCount, delay) => {
    const repo = repository(claim({ attempt_count: attemptCount }));
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("RATE_LIMIT")) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "retryable", orderId: 42, attemptCount,
    });
    expect(repo.retryShippingImport).toHaveBeenCalledWith({
      orderId: 42,
      leaseToken: LEASE_TOKEN,
      nextAttemptAt: new Date(Date.parse(NOW) + delay).toISOString(),
      errorType: "rate_limit",
    });
    expect(service.importShipment).toHaveBeenCalledTimes(1);
  });

  test("límite del cuarto attempt convierte retryable en failed", async () => {
    const repo = repository(claim({ attempt_count: 4 }));
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("RATE_LIMIT")) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "failed", orderId: 42, attemptCount: 4,
    });
    expect(repo.failShippingImport).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "rate_limit_attempt_limit",
    });
    expect(repo.retryShippingImport).not.toHaveBeenCalled();
  });

  test("requeue humana tras attempt 4 permite claim 5 pero no renueva retries automáticos", async () => {
    const repo = repository(claim({ attempt_count: 5 }));
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("RATE_LIMIT")) };
    const setup = worker({ repo, service });

    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "failed", orderId: 42, attemptCount: 5,
    });
    expect(service.importShipment).toHaveBeenCalledTimes(1);
    expect(repo.failShippingImport).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "rate_limit_attempt_limit",
    });
    expect(repo.retryShippingImport).not.toHaveBeenCalled();
  });

  test("claim 5 ambiguo vuelve a unknown y requiere otra confirmación humana", async () => {
    const repo = repository(claim({ attempt_count: 5 }));
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("TIMEOUT", {
      requestAttempted: true,
      ambiguous: true,
    })) };
    const setup = worker({ repo, service });

    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "unknown", orderId: 42, attemptCount: 5,
    });
    expect(service.importShipment).toHaveBeenCalledTimes(1);
    expect(repo.markShippingImportUnknown).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "timeout",
    });
    expect(repo.retryShippingImport).not.toHaveBeenCalled();
  });

  test("AUTH inicial es retryable porque no hubo POST", async () => {
    const repo = repository();
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("AUTH", {
      requestAttempted: false,
    })) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toMatchObject({
      outcome: "retryable",
    });
    expect(repo.retryShippingImport).toHaveBeenCalledWith(expect.objectContaining({
      errorType: "auth",
    }));
  });

  test("AUTH tras POST 401 y fallo de renovación queda unknown", async () => {
    const repo = repository();
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("AUTH", {
      requestAttempted: false,
      previousRequestAttempted: true,
      ambiguous: true,
    })) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toMatchObject({
      outcome: "unknown",
    });
    expect(repo.markShippingImportUnknown).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "auth",
    });
    expect(repo.retryShippingImport).not.toHaveBeenCalled();
  });

  test("segundo POST 401 confirmado produce unknown sin retry ni segunda transición", async () => {
    const repo = repository();
    const service = { importShipment: jest.fn().mockRejectedValue(providerError("AUTH", {
      status: 401,
      requestAttempted: true,
    })) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "unknown", orderId: 42, attemptCount: 1,
    });
    expect(service.importShipment).toHaveBeenCalledTimes(1);
    expect(repo.markShippingImportUnknown).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "auth",
    });
    expect(repo.retryShippingImport).not.toHaveBeenCalled();
    expect(repo.failShippingImport).not.toHaveBeenCalled();
  });

  test.each(["NETWORK", "TIMEOUT"])(
    "%s durante auth inicial es retryable porque no hubo POST",
    async (type) => {
      const repo = repository();
      const service = { importShipment: jest.fn().mockRejectedValue(providerError(type, {
        requestAttempted: false,
        retryable: true,
      })) };
      const setup = worker({ repo, service });
      await expect(setup.instance.processNextShippingImport()).resolves.toMatchObject({
        outcome: "retryable",
      });
      expect(repo.retryShippingImport).toHaveBeenCalledWith(expect.objectContaining({
        errorType: type.toLowerCase(),
      }));
    }
  );

  test.each(["NETWORK", "TIMEOUT", "SERVER", "AMBIGUOUS_RESPONSE"])(
    "%s produce unknown sin retry automático",
    async (type) => {
      const repo = repository();
      const service = { importShipment: jest.fn().mockRejectedValue(providerError(type, {
        requestAttempted: true,
        ambiguous: true,
        ...(type === "TIMEOUT" ? { status: 408 } : {}),
      })) };
      const setup = worker({ repo, service });
      await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
        outcome: "unknown", orderId: 42, attemptCount: 1,
      });
      expect(repo.markShippingImportUnknown).toHaveBeenCalledWith({
        orderId: 42, leaseToken: LEASE_TOKEN, errorType: type.toLowerCase(),
      });
      expect(repo.retryShippingImport).not.toHaveBeenCalled();
      expect(service.importShipment).toHaveBeenCalledTimes(1);
    }
  );

  test.each(["VALIDATION", "UNSUPPORTED_SERVICE", "PROVIDER_REJECTED"])(
    "%s produce failed",
    async (type) => {
      const repo = repository();
      const service = { importShipment: jest.fn().mockRejectedValue(providerError(type)) };
      const setup = worker({ repo, service });
      await expect(setup.instance.processNextShippingImport()).resolves.toMatchObject({
        outcome: "failed",
      });
      expect(repo.failShippingImport).toHaveBeenCalledWith({
        orderId: 42, leaseToken: LEASE_TOKEN, errorType: type.toLowerCase(),
      });
    }
  );

  test("error inesperado iniciado el service produce unknown con código corto", async () => {
    const repo = repository();
    const service = { importShipment: jest.fn().mockRejectedValue(new Error("PII private stack")) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toMatchObject({
      outcome: "unknown",
    });
    expect(repo.markShippingImportUnknown).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "internal_error",
    });
  });

  test("snapshot inválido antes del service produce failed/internal sin PII", async () => {
    const repo = repository(claim({ declared_value: "1e3" }));
    const setup = worker({ repo });
    await expect(setup.instance.processNextShippingImport()).resolves.toMatchObject({
      outcome: "failed",
    });
    expect(setup.service.importShipment).not.toHaveBeenCalled();
    expect(repo.failShippingImport).toHaveBeenCalledWith({
      orderId: 42, leaseToken: LEASE_TOKEN, errorType: "invalid_snapshot",
    });
  });

  test.each([
    [2000, 2000], ["2000", 2000], ["2000.00", 2000], ["0", 0], [0, 0],
  ])("normaliza declared_value %# → %s", (value, expected) => {
    expect(normalizeDeclaredValue(value)).toBe(expected);
  });

  test.each([
    undefined, "", " ", "1e3", "-1", "abc", false, true, null, [], {}, NaN, Infinity, -1,
  ])("rechaza declared_value %#", (value) => {
    expect(() => normalizeDeclaredValue(value)).toThrow("invalid_snapshot");
  });

  test.each([
    ["created", "completeShippingImport", { createdAt: "2030-01-01T00:00:05Z" }],
    ["unknown", "markShippingImportUnknown", providerError("TIMEOUT", { ambiguous: true })],
    ["failed", "failShippingImport", providerError("VALIDATION")],
  ])("lease perdido en salida %s no intenta segunda transición", async (outcome, method, result) => {
    const repo = repository();
    repo[method].mockResolvedValue(null);
    const service = outcome === "created"
      ? { importShipment: jest.fn().mockResolvedValue(result) }
      : { importShipment: jest.fn().mockRejectedValue(result) };
    const setup = worker({ repo, service });
    await expect(setup.instance.processNextShippingImport()).resolves.toEqual({
      outcome: "lease_lost", orderId: 42,
    });
    const transitionCalls = [
      repo.completeShippingImport,
      repo.retryShippingImport,
      repo.markShippingImportUnknown,
      repo.failShippingImport,
    ].reduce((total, fn) => total + fn.mock.calls.length, 0);
    expect(transitionCalls).toBe(1);
  });

  test("error persistiendo created se propaga sin transición alternativa", async () => {
    const repo = repository();
    const persistenceError = new Error("supabase unavailable");
    repo.completeShippingImport.mockRejectedValue(persistenceError);
    const setup = worker({ repo });
    await expect(setup.instance.processNextShippingImport()).rejects.toBe(persistenceError);
    expect(repo.markShippingImportUnknown).not.toHaveBeenCalled();
    expect(repo.failShippingImport).not.toHaveBeenCalled();
  });

  test("expire stale leases sólo delega en la RPC y resume cantidad", async () => {
    const repo = repository(null);
    repo.expireShippingImportLeases.mockResolvedValue([{ order_id: 1 }, { order_id: 2 }]);
    const setup = worker({ repo });
    await expect(setup.instance.expireStaleShippingImportLeases()).resolves.toEqual({
      outcome: "expired", count: 2,
    });
    expect(repo.expireShippingImportLeases).toHaveBeenCalledTimes(1);
    expect(repo.claimNextShippingImport).not.toHaveBeenCalled();
  });

  test("dos workers concurrentes dependen del claim DB: uno procesa y otro queda idle", async () => {
    const repo = repository();
    repo.claimNextShippingImport
      .mockResolvedValueOnce(claim())
      .mockResolvedValueOnce(null);
    const setup = worker({ repo });
    const results = await Promise.all([
      setup.instance.processNextShippingImport(),
      setup.instance.processNextShippingImport(),
    ]);
    expect(results.map(({ outcome }) => outcome).sort()).toEqual(["created", "idle"]);
    expect(setup.service.importShipment).toHaveBeenCalledTimes(1);
    expect(repo.claimNextShippingImport).toHaveBeenCalledTimes(2);
  });

  test("constantes documentan lease y backoff", () => {
    expect(SHIPPING_IMPORT_LEASE_MS).toBe(60_000);
    expect(RETRY_BACKOFF_MS).toEqual([60_000, 300_000, 900_000]);
  });

  test("worker permanece invocable pero inactivo en el runtime", () => {
    for (const relativePath of ["../index.js", "../src/app.js", "../src/shippingImports.js"]) {
      const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
      expect(source).not.toContain("shippingImportWorker");
      expect(source).not.toContain("processNextShippingImport");
    }
    const workerSource = fs.readFileSync(
      path.join(__dirname, "../src/shippingImportWorker.js"),
      "utf8"
    );
    expect(workerSource).not.toContain("setInterval(");
    expect(workerSource).not.toContain("setTimeout(");
    expect(workerSource).not.toMatch(/process\.env\./);
  });
});
