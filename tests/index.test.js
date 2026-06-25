const crypto = require("crypto");

const requiredEnv = {
  MERCADOPAGO_ACCESS_TOKEN: "configured",
  MERCADO_PAGO_WEBHOOK_SECRET: "test-only-secret",
  BASE_URL: "https://example.test",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "configured",
  LOG_LEVEL: "info",
};

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function parseLogEntries(...spies) {
  return spies
    .flatMap((spy) => spy.mock.calls.map(([message]) => JSON.parse(message)))
    .filter(Boolean);
}

function serializedLogOutput(...spies) {
  return spies.flatMap((spy) => spy.mock.calls.flat()).join(" ");
}

function makeSignature({
  dataId = "PAYMENTTEST",
  requestId = "request-test",
  timestamp = "1700000000",
  secret = requiredEnv.MERCADO_PAGO_WEBHOOK_SECRET,
} = {}) {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const digest = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  return `ts=${timestamp},v1=${digest}`;
}

function makeWebhookRequest({ headers = {}, paymentId = "PAYMENTTEST" } = {}) {
  return {
    method: "POST",
    originalUrl: "/webhook",
    headers,
    query: {
      type: "payment",
      "data.id": paymentId,
    },
    body: {
      type: "payment",
      data: { id: paymentId },
    },
  };
}

function makePreferenceRequest(body = {}) {
  return { body };
}

const validPreferenceBody = {
  sku: "REMERA-LEMONT-001",
  quantity: 1,
};

function createQueryBuilder(supabaseMock) {
  return class QueryBuilder {
    constructor() {
      this.mode = "base";
      this.filters = [];
      this.payload = undefined;
    }

    insert(payload) {
      this.mode = "insert";
      this.payload = payload;
      return this;
    }

    update(payload) {
      this.mode = "update";
      this.payload = payload;
      return this;
    }

    select() {
      this.mode = this.mode === "update" ? "update-select" : this.mode === "insert" ? "insert-select" : "find";
      return this;
    }

    eq(field, value) {
      this.filters.push([field, value]);
      return this;
    }

    single() {
      if (this.mode !== "insert-select") {
        throw new Error("Unexpected single() query in test double");
      }

      return supabaseMock.insertOrder(this.payload);
    }

    maybeSingle() {
      if (this.mode === "find") {
        return supabaseMock.findOrder(this.filters);
      }

      if (this.mode === "update-select") {
        return supabaseMock.updateOrder(this.filters, this.payload);
      }

      throw new Error("Unexpected maybeSingle() query in test double");
    }
  };
}

function loadApp({ env = {}, supabase = {}, mercadoPago = {} } = {}) {
  jest.resetModules();

  for (const name of [...Object.keys(requiredEnv), "NODE_ENV"]) {
    delete process.env[name];
  }

  Object.assign(process.env, requiredEnv, env);

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[name];
    }
  }

  const routes = { get: {}, post: {} };
  const errorMiddlewares = [];
  const app = {
    use: jest.fn((handler) => {
      if (typeof handler === "function" && handler.length === 4) {
        errorMiddlewares.push(handler);
      }
    }),
    get: jest.fn((route, handler) => {
      routes.get[route] = handler;
    }),
    post: jest.fn((route, handler) => {
      routes.post[route] = handler;
    }),
    listen: jest.fn(),
  };
  const expressMock = jest.fn(() => app);
  expressMock.json = jest.fn(() => jest.fn());
  expressMock.static = jest.fn(() => jest.fn());

  const paymentGet = jest.fn(
    mercadoPago.paymentGet ||
      (async () => ({
        id: "PAYMENTTEST",
        status: "pending",
        transaction_amount: 100,
        currency_id: "ARS",
        external_reference: "ORDERTEST",
      }))
  );
  const preferenceCreate = jest.fn(
    mercadoPago.preferenceCreate ||
      (async () => ({
        id: "preference-test",
        init_point: "https://checkout.example/init",
        sandbox_init_point: "https://checkout.example/sandbox",
      }))
  );

  const supabaseMock = {
    insertOrder: jest.fn(supabase.insertOrder || (async () => ({ data: { id: 1 }, error: null }))),
    findOrder: jest.fn(supabase.findOrder || (async () => ({ data: { status: "pending", amount: 100, currency: "ARS" }, error: null }))),
    updateOrder: jest.fn(supabase.updateOrder || (async () => ({ data: { status: "paid" }, error: null }))),
  };
  const QueryBuilder = createQueryBuilder(supabaseMock);

  jest.doMock("dotenv", () => ({ config: jest.fn() }));
  jest.doMock("express", () => expressMock);
  jest.doMock("mercadopago", () => ({
    MercadoPagoConfig: jest.fn(),
    Payment: jest.fn(() => ({ get: paymentGet })),
    Preference: jest.fn(() => ({ create: preferenceCreate })),
  }));
  jest.doMock("@supabase/supabase-js", () => ({
    createClient: jest.fn(() => ({
      from: jest.fn(() => new QueryBuilder()),
    })),
  }));

  require("../index.js");

  return {
    app,
    routes,
    errorMiddlewares,
    paymentGet,
    preferenceCreate,
    supabaseMock,
  };
}

describe("configuración inicial", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("termina el proceso si faltan variables obligatorias o están vacías", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      loadApp({
        env: {
          BASE_URL: undefined,
          SUPABASE_URL: "   ",
        },
      })
    ).toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const [entry] = parseLogEntries(errorSpy);
    expect(entry).toEqual(
      expect.objectContaining({
        level: "error",
        event: "configuracion invalida",
        request_id: "startup",
        route: "startup",
        method: "STARTUP",
        error_type: "missing_environment",
      })
    );
    expect(entry.timestamp).toEqual(expect.any(String));
    const errorMessage = serializedLogOutput(errorSpy);
    expect(errorMessage).not.toContain(requiredEnv.MERCADOPAGO_ACCESS_TOKEN);
    expect(errorMessage).not.toContain(requiredEnv.SUPABASE_SERVICE_ROLE_KEY);
  });
});

describe("errores de entrada HTTP", () => {
  test("responde JSON inválido con status 400 y charset utf-8", () => {
    const { errorMiddlewares } = loadApp();
    const response = createResponse();
    const next = jest.fn();
    const error = new SyntaxError("Unexpected token");
    error.status = 400;
    error.body = "{";

    errorMiddlewares[0](error, {}, response, next);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "JSON inválido" });
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8"
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe("diagnostico GET /webhook", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("registra GET /webhook en test y responde como diagnostico", () => {
    const { routes } = loadApp({ env: { NODE_ENV: "test" } });
    const response = createResponse();

    routes.get["/webhook"]({}, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(parseLogEntries(logSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          event: "webhook get recibido",
          route: "/webhook",
          method: "GET",
          status_code: 200,
        }),
      ])
    );
  });

  test("registra GET /webhook en development", () => {
    const { routes } = loadApp({ env: { NODE_ENV: "development" } });

    expect(routes.get["/webhook"]).toEqual(expect.any(Function));
  });

  test("no registra GET /webhook en production y conserva POST /webhook", () => {
    const { routes } = loadApp({ env: { NODE_ENV: "production" } });

    expect(routes.get["/webhook"]).toBeUndefined();
    expect(routes.post["/webhook"]).toEqual(expect.any(Function));
  });
});

describe("creación de preferencias", () => {
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("no crea preferencia si Supabase falla al crear el pedido pending", async () => {
    const { routes, preferenceCreate } = loadApp({
      supabase: {
        insertOrder: async () => ({ data: null, error: new Error("database detail") }),
      },
    });
    const response = createResponse();

    await routes.post["/crear-preferencia"](makePreferenceRequest(validPreferenceBody), response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: "No se pudo iniciar el pago" });
    expect(preferenceCreate).not.toHaveBeenCalled();
  });

  test("rechaza SKU inexistente sin llamar a Supabase ni Mercado Pago", async () => {
    const { routes, preferenceCreate, supabaseMock } = loadApp();
    const response = createResponse();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest({ sku: "SKU-INEXISTENTE", quantity: 1 }),
      response
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Producto no encontrado" });
    expect(supabaseMock.insertOrder).not.toHaveBeenCalled();
    expect(preferenceCreate).not.toHaveBeenCalled();
    expect(serializedLogOutput(logSpy, warnSpy, errorSpy)).not.toContain("100");
    expect(serializedLogOutput(logSpy, warnSpy, errorSpy)).not.toContain(
      "REMERA-LEMONT-001"
    );
  });

  test.each([
    ["cero", 0],
    ["negativa", -1],
    ["mayor al maximo", 11],
    ["no entera", 1.5],
  ])("rechaza cantidad %s sin crear preferencia", async (caseName, quantity) => {
    const { routes, preferenceCreate, supabaseMock } = loadApp();
    const response = createResponse();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest({ sku: "REMERA-LEMONT-001", quantity }),
      response
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Cantidad inválida" });
    expect(supabaseMock.insertOrder).not.toHaveBeenCalled();
    expect(preferenceCreate).not.toHaveBeenCalled();
    expect(serializedLogOutput(logSpy, warnSpy, errorSpy)).not.toContain("100");
    expect(serializedLogOutput(logSpy, warnSpy, errorSpy)).not.toContain(
      "REMERA-LEMONT-001"
    );
  });

  test("calcula amount desde catalogo para cantidad valida", async () => {
    const { routes, supabaseMock, preferenceCreate } = loadApp();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest({ sku: "REMERA-LEMONT-001", quantity: 3 }),
      createResponse()
    );

    const insertedOrder = supabaseMock.insertOrder.mock.calls[0][0];
    expect(insertedOrder).toEqual(
      expect.objectContaining({
        product_name: "Remera LEMONT",
        quantity: 3,
        amount: 300,
        currency: "ARS",
        status: "pending",
      })
    );
    expect(preferenceCreate.mock.calls[0][0].body.items).toEqual([
      {
        title: "Remera LEMONT",
        quantity: 3,
        unit_price: 100,
        currency_id: "ARS",
      },
    ]);
  });

  test("ignora amount y currency enviados por el cliente", async () => {
    const { routes, supabaseMock, preferenceCreate } = loadApp();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest({
        sku: "REMERA-LEMONT-001",
        quantity: 2,
        amount: 1,
        currency: "USD",
        price: 1,
      }),
      createResponse()
    );

    const insertedOrder = supabaseMock.insertOrder.mock.calls[0][0];
    expect(insertedOrder.amount).toBe(200);
    expect(insertedOrder.currency).toBe("ARS");
    expect(preferenceCreate.mock.calls[0][0].body.items[0]).toEqual(
      expect.objectContaining({
        quantity: 2,
        unit_price: 100,
        currency_id: "ARS",
      })
    );
  });

  test("genera external_reference con prefijo trazable", async () => {
    const randomUUIDSpy = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");
    const { routes, supabaseMock, preferenceCreate } = loadApp();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest(validPreferenceBody),
      createResponse()
    );

    const insertedOrder = supabaseMock.insertOrder.mock.calls[0][0];
    expect(insertedOrder.external_reference).toBe(
      "LEMONT-ORDER-11111111-1111-4111-8111-111111111111"
    );
    expect(preferenceCreate.mock.calls[0][0].body.external_reference).toBe(
      insertedOrder.external_reference
    );
    expect(serializedLogOutput(logSpy, warnSpy, errorSpy)).not.toContain(
      insertedOrder.external_reference
    );
    randomUUIDSpy.mockRestore();
  });

  test("la referencia no depende solo de Date.now", async () => {
    const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(1700000000000);
    const randomUUIDSpy = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("22222222-2222-4222-8222-222222222222");
    const { routes, supabaseMock } = loadApp();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest(validPreferenceBody),
      createResponse()
    );

    const insertedOrder = supabaseMock.insertOrder.mock.calls[0][0];
    expect(insertedOrder.external_reference).toBe(
      "LEMONT-ORDER-22222222-2222-4222-8222-222222222222"
    );
    expect(insertedOrder.external_reference).not.toBe("LEMONT-ORDER-1700000000000");
    expect(dateNowSpy).not.toHaveBeenCalled();
    randomUUIDSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  test("dos pedidos generados en el mismo instante no repiten external_reference", async () => {
    const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(1700000000000);
    const randomUUIDSpy = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("request-33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("request-44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444");
    const { routes, supabaseMock } = loadApp();

    await routes.post["/crear-preferencia"](
      makePreferenceRequest(validPreferenceBody),
      createResponse()
    );
    await routes.post["/crear-preferencia"](
      makePreferenceRequest(validPreferenceBody),
      createResponse()
    );

    const references = supabaseMock.insertOrder.mock.calls.map(
      ([payload]) => payload.external_reference
    );
    expect(references).toEqual([
      "LEMONT-ORDER-33333333-3333-4333-8333-333333333333",
      "LEMONT-ORDER-44444444-4444-4444-8444-444444444444",
    ]);
    expect(new Set(references).size).toBe(2);
    randomUUIDSpy.mockRestore();
    dateNowSpy.mockRestore();
  });
});

describe("webhook de pagos", () => {
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function validHeaders(paymentId = "PAYMENTTEST") {
    return {
      "x-request-id": "request-test",
      "x-signature": makeSignature({ dataId: paymentId, requestId: "request-test" }),
    };
  }

  test("rechaza webhooks sin firma", async () => {
    const { routes, paymentGet } = loadApp();
    const response = createResponse();

    await routes.post["/webhook"](makeWebhookRequest(), response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Webhook inválido" });
    expect(paymentGet).not.toHaveBeenCalled();
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: "firma de webhook ausente",
          route: "/webhook",
          method: "POST",
          status_code: 401,
        }),
      ])
    );
  });

  test("rechaza webhooks con firma inválida", async () => {
    const { routes, paymentGet } = loadApp();
    const response = createResponse();
    const invalidSignature = `ts=1700000000,v1=${"0".repeat(64)}`;

    await routes.post["/webhook"](
      makeWebhookRequest({
        headers: {
          "x-request-id": "request-test",
          "x-signature": invalidSignature,
        },
      }),
      response
    );

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Webhook inválido" });
    expect(paymentGet).not.toHaveBeenCalled();
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: "firma de webhook invalida",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
          status_code: 401,
        }),
      ])
    );
    expect(serializedLogOutput(logSpy, warnSpy, errorSpy)).not.toContain(invalidSignature);
  });

  test("continúa el flujo con firma válida", async () => {
    const { routes, paymentGet } = loadApp();
    const response = createResponse();

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(paymentGet).toHaveBeenCalledWith({ id: "PAYMENTTEST" });
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          event: "webhook recibido",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
          timestamp: expect.any(String),
        }),
      ])
    );
  });

  test("marca como paid un pago aprobado con importe correcto", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({
          id: "PAYMENTTEST",
          status: "approved",
          transaction_amount: 100,
          currency_id: "ARS",
          external_reference: "ORDERTEST",
        }),
      },
    });
    const response = createResponse();

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), response);

    expect(response.statusCode).toBe(200);
    expect(supabaseMock.updateOrder).toHaveBeenCalledTimes(1);
    const [filters, payload] = supabaseMock.updateOrder.mock.calls[0];
    expect(filters).toEqual(
      expect.arrayContaining([
        ["external_reference", "ORDERTEST"],
        ["status", "pending"],
      ])
    );
    expect(payload).toEqual(
      expect.objectContaining({
        status: "paid",
        mercadopago_payment_id: "PAYMENTTEST",
        mercadopago_status: "approved",
      })
    );
  });

  test("marca como paid un importe equivalente con decimal normalizado", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({
          id: "PAYMENTTEST",
          status: "approved",
          transaction_amount: 100.001,
          currency_id: "ARS",
          external_reference: "ORDERTEST",
        }),
      },
      supabase: {
        findOrder: async () => ({ data: { status: "pending", amount: "100.00", currency: "ARS" }, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.updateOrder).toHaveBeenCalledTimes(1);
  });

  test("no marca como paid si el importe no coincide", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({
          id: "PAYMENTTEST",
          status: "approved",
          transaction_amount: 99.99,
          currency_id: "ARS",
          external_reference: "ORDERTEST",
        }),
      },
      supabase: {
        findOrder: async () => ({ data: { status: "pending", amount: "100.00", currency: "ARS" }, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.updateOrder).not.toHaveBeenCalled();
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: "importe no coincide",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
        }),
      ])
    );
  });

  test("no marca como paid si el pago no está approved", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({ id: "PAYMENTTEST", status: "pending", transaction_amount: 100, external_reference: "ORDERTEST" }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.findOrder).not.toHaveBeenCalled();
    expect(supabaseMock.updateOrder).not.toHaveBeenCalled();
  });

  test("no crea pedido si el pedido no existe", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({ id: "PAYMENTTEST", status: "approved", transaction_amount: 100, external_reference: "ORDERTEST" }),
      },
      supabase: {
        findOrder: async () => ({ data: null, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.updateOrder).not.toHaveBeenCalled();
    expect(supabaseMock.insertOrder).not.toHaveBeenCalled();
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: "pedido no encontrado",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
        }),
      ])
    );
  });

  test("trata un pedido ya pagado como webhook duplicado", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({ id: "PAYMENTTEST", status: "approved", transaction_amount: 100, external_reference: "ORDERTEST" }),
      },
      supabase: {
        findOrder: async () => ({ data: { status: "paid", amount: 100 }, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.updateOrder).not.toHaveBeenCalled();
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          event: "webhook duplicado ignorado",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
          order_status: "paid",
        }),
      ])
    );
  });

  test("mantiene la transición atómica ante webhooks duplicados concurrentes", async () => {
    let sharedStatus = "pending";
    let readCount = 0;
    let releaseReads;
    const bothReadsStarted = new Promise((resolve) => {
      releaseReads = resolve;
    });
    let successfulUpdates = 0;

    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({ id: "PAYMENTTEST", status: "approved", transaction_amount: 100, external_reference: "ORDERTEST" }),
      },
      supabase: {
        findOrder: async () => {
          readCount += 1;
          if (readCount === 2) {
            releaseReads();
          }
          await bothReadsStarted;
          return { data: { status: "pending", amount: 100 }, error: null };
        },
        updateOrder: async (filters) => {
          const hasPendingCondition = filters.some(([field, value]) => field === "status" && value === "pending");

          if (hasPendingCondition && sharedStatus === "pending") {
            sharedStatus = "paid";
            successfulUpdates += 1;
            return { data: { status: "paid" }, error: null };
          }

          return { data: null, error: null };
        },
      },
    });

    await Promise.all([
      routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse()),
      routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse()),
    ]);

    expect(supabaseMock.updateOrder).toHaveBeenCalledTimes(2);
    expect(successfulUpdates).toBe(1);
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          event: "webhook duplicado ignorado",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
        }),
      ])
    );
  });

  test("no marca como paid si la moneda no coincide", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({
          id: "PAYMENTTEST",
          status: "approved",
          transaction_amount: 100,
          currency_id: "USD",
          external_reference: "ORDERTEST",
        }),
      },
      supabase: {
        findOrder: async () => ({ data: { status: "pending", amount: "100.00", currency: "ARS" }, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.updateOrder).not.toHaveBeenCalled();
    expect(parseLogEntries(logSpy, warnSpy, errorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: "moneda no coincide",
          request_id: "request-test",
          route: "/webhook",
          method: "POST",
        }),
      ])
    );
  });

  test("la moneda coincidente permite continuar el flujo de pago", async () => {
    const { routes, supabaseMock } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({
          id: "PAYMENTTEST",
          status: "approved",
          transaction_amount: 100,
          currency_id: "ARS",
          external_reference: "ORDERTEST",
        }),
      },
      supabase: {
        findOrder: async () => ({ data: { status: "pending", amount: "100.00", currency: "ARS" }, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    expect(supabaseMock.updateOrder).toHaveBeenCalledTimes(1);
  });

  test("no registra importes ni monedas reales cuando no coinciden", async () => {
    const { routes } = loadApp({
      mercadoPago: {
        paymentGet: async () => ({
          id: "PAYMENTTEST",
          status: "approved",
          transaction_amount: 99.99,
          currency_id: "USD",
          external_reference: "ORDERTEST",
        }),
      },
      supabase: {
        findOrder: async () => ({ data: { status: "pending", amount: "100.00", currency: "ARS" }, error: null }),
      },
    });

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), createResponse());

    const logOutput = serializedLogOutput(logSpy, warnSpy, errorSpy);
    expect(logOutput).not.toContain("99.99");
    expect(logOutput).not.toContain("100.00");
    expect(logOutput).not.toContain("USD");
    expect(logOutput).not.toContain("ARS");
    expect(logOutput).not.toContain("transaction_amount");
    expect(logOutput).not.toContain("order.amount");
    expect(logOutput).not.toContain("external_reference");
    expect(logOutput).not.toContain("ORDERTEST");
  });
});
