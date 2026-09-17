const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const attemptClient = require("../public/js/checkoutAttemptClient.js");

const STORAGE_KEY = "lemont.checkoutAttempt.v1";
const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "660e8400-e29b-41d4-a716-446655440000";

function memoryStorage(initialValue, initialKey = STORAGE_KEY) {
  const values = new Map();
  if (initialValue !== undefined) values.set(initialKey, initialValue);
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key)),
    raw: (key = STORAGE_KEY) => values.get(key) ?? null,
  };
}

function cryptoWith(...uuids) {
  return {
    subtle: webcrypto.subtle,
    randomUUID: jest.fn(() => uuids.shift() || UUID_B),
  };
}

function baseBody(overrides = {}) {
  return {
    items: [
      { sku: "LEM-REM-001-M", quantity: 1 },
      { sku: "LEM-REM-001-S", quantity: 2 },
    ],
    customer: {
      firstName: "  Ana   María ",
      lastName: " Pérez ",
      email: " ANA@EXAMPLE.TEST ",
      phone: "+54 11 2345-6789",
    },
    delivery: {
      province: " ar-b ",
      locality: " La   Plata ",
      postalCode: " b1900abc ",
      street: " Calle   12 ",
      streetNumber: " 345 ",
      apartment: " ",
      notes: " Portón negro ",
    },
    shippingOptionId: "micorreo:home:classic",
    ...overrides,
  };
}

async function digest(body) {
  return attemptClient.createIntentDigest(body, {
    cryptoApi: webcrypto,
    TextEncoderApi: TextEncoder,
  });
}

function element() {
  const attributes = new Map();
  return {
    textContent: "Iniciar pago",
    disabled: false,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    getAttribute: (key) => attributes.get(key),
  };
}

function checkoutInput(overrides = {}) {
  return {
    ...baseBody({ items: [{ sku: "LEM-REM-001-S", quantity: 1 }] }),
    button: element(),
    statusElement: element(),
    onShippingInvalidated: jest.fn(),
    ...overrides,
  };
}

function setupCheckout({
  fetchImpl,
  storage = memoryStorage(),
  cartStorage = memoryStorage(),
  cryptoApi = cryptoWith(UUID_A),
} = {}) {
  const fetch = jest.fn(fetchImpl || (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ preference_id: "PREF-1", init_point: "https://checkout.test/1" }),
  })));
  const assign = jest.fn();
  const contextValues = {
    fetch,
    window: { location: { assign } },
    sessionStorage: storage,
    localStorage: cartStorage,
    TextEncoder,
    Uint8Array,
    Set,
    Error,
    JSON,
  };
  if (cryptoApi) contextValues.crypto = cryptoApi;
  const context = vm.createContext(contextValues);
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, "../public/js/checkoutAttemptClient.js"), "utf8"
  ), context);
  const checkoutSource = fs.readFileSync(
    path.join(__dirname, "../public/js/checkout.js"), "utf8"
  );
  vm.runInContext(
    checkoutSource.replace('import "./checkoutAttemptClient.js";', "")
      .replace("export async function", "async function"),
    context
  );
  return { context, fetch, assign, storage, cartStorage, cryptoApi };
}

describe("identidad frontend de checkout", () => {
  test("normaliza, agrupa y ordena productos de forma determinista", async () => {
    const reordered = baseBody({
      items: [
        { sku: "LEM-REM-001-S", quantity: 1 },
        { sku: "LEM-REM-001-M", quantity: 1 },
        { sku: "LEM-REM-001-S", quantity: 1 },
      ],
    });
    expect(await digest(reordered)).toBe(await digest(baseBody()));
    expect(attemptClient.buildCanonicalIntent(reordered).products).toEqual([
      { sku: "LEM-REM-001-M", quantity: 1 },
      { sku: "LEM-REM-001-S", quantity: 2 },
    ]);
  });

  test("HOME ignora agency code y AGENCY lo incorpora", async () => {
    expect(await digest(baseBody({ shippingAgencyCode: "EXTRA" })))
      .toBe(await digest(baseBody()));
    const agency = baseBody({
      shippingOptionId: "micorreo:agency:classic",
      shippingAgencyCode: "AG-1",
    });
    expect(await digest(agency)).not.toBe(await digest({ ...agency, shippingAgencyCode: "AG-2" }));
  });

  test.each([
    ["carrito", { items: [{ sku: "LEM-REM-001-S", quantity: 1 }] }],
    ["customer", { customer: { ...baseBody().customer, email: "otra@example.test" } }],
    ["delivery", { delivery: { ...baseBody().delivery, streetNumber: "999" } }],
    ["shipping", { shippingOptionId: "micorreo:home:express" }],
  ])("cambiar %s cambia el digest", async (_field, override) => {
    expect(await digest(baseBody(override))).not.toBe(await digest(baseBody()));
  });
});

describe("persistencia del checkoutAttemptId", () => {
  test("primer intento genera UUID y el mismo digest lo reutiliza", async () => {
    const storage = memoryStorage();
    const cryptoApi = cryptoWith(UUID_A, UUID_B);
    const intentDigest = await digest(baseBody());
    const first = attemptClient.getOrCreateCheckoutAttempt(intentDigest, { storage, cryptoApi });
    const retry = attemptClient.getOrCreateCheckoutAttempt(intentDigest, { storage, cryptoApi });
    expect(first).toBe(UUID_A);
    expect(retry).toBe(UUID_A);
    expect(cryptoApi.randomUUID).toHaveBeenCalledTimes(1);
  });

  test("un digest diferente genera UUID nuevo", async () => {
    const storage = memoryStorage();
    const cryptoApi = cryptoWith(UUID_A, UUID_B);
    attemptClient.getOrCreateCheckoutAttempt(await digest(baseBody()), { storage, cryptoApi });
    const changed = attemptClient.getOrCreateCheckoutAttempt(
      await digest(baseBody({ shippingOptionId: "micorreo:home:express" })),
      { storage, cryptoApi }
    );
    expect(changed).toBe(UUID_B);
  });

  test.each([
    ["JSON corrupto", "{broken"],
    ["UUID inválido", JSON.stringify({ version: 1, checkoutAttemptId: "bad", intentDigest: "a".repeat(64) })],
    ["versión inválida", JSON.stringify({ version: 2, checkoutAttemptId: UUID_A, intentDigest: "a".repeat(64) })],
    ["digest inválido", JSON.stringify({ version: 1, checkoutAttemptId: UUID_A, intentDigest: "bad" })],
  ])("%s se reemplaza por un UUID nuevo", (_case, stored) => {
    const storage = memoryStorage(stored);
    const result = attemptClient.getOrCreateCheckoutAttempt("b".repeat(64), {
      storage,
      cryptoApi: cryptoWith(UUID_B),
    });
    expect(result).toBe(UUID_B);
    expect(JSON.parse(storage.raw())).toEqual({
      version: 1,
      checkoutAttemptId: UUID_B,
      intentDigest: "b".repeat(64),
    });
  });

  test("sessionStorage contiene solo versión, UUID y digest, nunca PII", async () => {
    const storage = memoryStorage();
    const cryptoApi = cryptoWith(UUID_A);
    const body = baseBody();
    const intentDigest = await digest(body);
    attemptClient.getOrCreateCheckoutAttempt(intentDigest, { storage, cryptoApi });
    const raw = storage.raw();
    expect(Object.keys(JSON.parse(raw))).toEqual(["version", "checkoutAttemptId", "intentDigest"]);
    for (const privateValue of ["Ana", "Pérez", "ANA@EXAMPLE.TEST", "2345", "Calle", "Portón"]) {
      expect(raw).not.toContain(privateValue);
    }
  });
});

describe("integración frontend del attempt", () => {
  test("request incluye UUID generado, no intentDigest ni UUID externo", async () => {
    const app = setupCheckout();
    await app.context.iniciarCheckout(checkoutInput({ checkoutAttemptId: UUID_B }));
    const requestBody = JSON.parse(app.fetch.mock.calls[0][1].body);
    expect(requestBody.checkoutAttemptId).toBe(UUID_A);
    expect(requestBody).not.toHaveProperty("intentDigest");
  });

  test.each([
    ["HTTP 503", async () => ({ ok: false, status: 503, json: async () => ({}) })],
    ["error de red", async () => { throw new Error("network detail"); }],
  ])("%s conserva el UUID para retry", async (_case, fetchImpl) => {
    const storage = memoryStorage();
    const cryptoApi = cryptoWith(UUID_A, UUID_B);
    const app = setupCheckout({ fetchImpl, storage, cryptoApi });
    await app.context.iniciarCheckout(checkoutInput());
    const firstRecord = storage.raw();
    await app.context.iniciarCheckout(checkoutInput());
    expect(storage.raw()).toBe(firstRecord);
    expect(cryptoApi.randomUUID).toHaveBeenCalledTimes(1);
  });

  test("checkout_busy conserva UUID, no invalida shipping y rehabilita botón", async () => {
    const app = setupCheckout({ fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "El checkout está siendo preparado. Intentá nuevamente" }),
    }) });
    const input = checkoutInput();
    await app.context.iniciarCheckout(input);
    expect(app.storage.raw()).not.toBeNull();
    expect(input.onShippingInvalidated).not.toHaveBeenCalled();
    expect(input.button.disabled).toBe(false);
    expect(input.button.getAttribute("aria-busy")).toBeUndefined();
    expect(input.statusElement.textContent).toBe(
      "El pago se está preparando. Intentá nuevamente en unos segundos."
    );
  });

  test("checkout_mismatch borra solo el record y permite un UUID nuevo", async () => {
    let calls = 0;
    const app = setupCheckout({
      cryptoApi: cryptoWith(UUID_A, UUID_B),
      fetchImpl: async () => (++calls === 1 ? {
        ok: false,
        status: 409,
        json: async () => ({ error: "El intento de pago no coincide con la compra original" }),
      } : {
        ok: true,
        status: 200,
        json: async () => ({ preference_id: "PREF-2", init_point: "https://checkout.test/2" }),
      }),
    });
    const first = checkoutInput();
    await app.context.iniciarCheckout(first);
    expect(app.storage.raw()).toBeNull();
    expect(first.button.disabled).toBe(false);
    expect(first.statusElement.textContent).toBe("Los datos de la compra cambiaron. Intentá nuevamente.");
    await app.context.iniciarCheckout(checkoutInput());
    expect(JSON.parse(app.fetch.mock.calls[1][1].body).checkoutAttemptId).toBe(UUID_B);
  });

  test("checkout_attempt_already_paid borra solo el attempt y no redirige", async () => {
    const cartRecord = JSON.stringify([{ sku: "LEM-REM-001-S", quantity: 1 }]);
    const cartStorage = memoryStorage(cartRecord, "lemont.cart");
    const app = setupCheckout({
      cartStorage,
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Esta compra ya fue pagada.",
          type: "checkout_attempt_already_paid",
        }),
      }),
    });
    const input = checkoutInput();

    await app.context.iniciarCheckout(input);

    expect(app.storage.raw()).toBeNull();
    expect(cartStorage.raw("lemont.cart")).toBe(cartRecord);
    expect(cartStorage.removeItem).not.toHaveBeenCalled();
    expect(app.assign).not.toHaveBeenCalled();
    expect(input.onShippingInvalidated).not.toHaveBeenCalled();
    expect(input.button.disabled).toBe(false);
    expect(input.statusElement.textContent).toBe("Esta compra ya fue pagada.");
  });

  test.each([
    ["shipping_changed", "La opción de envío ya no está disponible"],
    ["agency_changed", "La sucursal ya no está disponible"],
  ])("%s conserva invalidación anterior", async (_case, backendError) => {
    const app = setupCheckout({ fetchImpl: async () => ({
      ok: false, status: 409, json: async () => ({ error: backendError }),
    }) });
    const input = checkoutInput({
      ...(backendError.startsWith("La sucursal") ? {
        shippingOptionId: "micorreo:agency:classic",
        shippingAgencyCode: "AG-1",
      } : {}),
    });
    await app.context.iniciarCheckout(input);
    expect(input.onShippingInvalidated).toHaveBeenCalledTimes(1);
    expect(input.button.disabled).toBe(true);
  });

  test("409 desconocido no se clasifica como shipping_changed", async () => {
    const app = setupCheckout({ fetchImpl: async () => ({
      ok: false, status: 409, json: async () => ({ error: "Otro conflicto" }),
    }) });
    const input = checkoutInput();
    await app.context.iniciarCheckout(input);
    expect(input.onShippingInvalidated).not.toHaveBeenCalled();
    expect(input.button.disabled).toBe(false);
    expect(app.storage.raw()).not.toBeNull();
  });

  test("400 attempt inválido borra record sin retry automático", async () => {
    const app = setupCheckout({ fetchImpl: async () => ({
      ok: false, status: 400, json: async () => ({ error: "Intento de pago inválido" }),
    }) });
    const input = checkoutInput();
    await app.context.iniciarCheckout(input);
    expect(app.storage.raw()).toBeNull();
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(input.button.disabled).toBe(false);
  });

  test("success conserva record y redirige", async () => {
    const app = setupCheckout();
    const input = checkoutInput();
    await app.context.iniciarCheckout(input);
    expect(app.storage.raw()).not.toBeNull();
    expect(app.assign).toHaveBeenCalledWith("https://checkout.test/1");
    expect(input.button.textContent).toBe("Redirigiendo…");
  });

  test("sin Web Crypto no hace fetch y muestra error controlado", async () => {
    const app = setupCheckout({ cryptoApi: null });
    const input = checkoutInput();
    await app.context.iniciarCheckout(input);
    expect(app.fetch).not.toHaveBeenCalled();
    expect(input.button.disabled).toBe(false);
    expect(input.statusElement.textContent).toBe("No pudimos iniciar el pago. Intentá nuevamente.");
  });
});
