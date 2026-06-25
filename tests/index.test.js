const crypto = require("crypto");

const requiredEnv = {
  MERCADOPAGO_ACCESS_TOKEN: "configured",
  MERCADO_PAGO_WEBHOOK_SECRET: "test-only-secret",
  BASE_URL: "https://example.test",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "configured",
};

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
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

  for (const name of Object.keys(requiredEnv)) {
    delete process.env[name];
  }

  Object.assign(process.env, requiredEnv, env);

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[name];
    }
  }

  const routes = { get: {}, post: {} };
  const app = {
    use: jest.fn(),
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
    const errorMessage = errorSpy.mock.calls.flat().join(" ");
    expect(errorMessage).toContain("BASE_URL");
    expect(errorMessage).toContain("SUPABASE_URL");
    expect(errorMessage).not.toContain(requiredEnv.MERCADOPAGO_ACCESS_TOKEN);
    expect(errorMessage).not.toContain(requiredEnv.SUPABASE_SERVICE_ROLE_KEY);
  });
});

describe("creación de preferencias", () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("no crea preferencia si Supabase falla al crear el pedido pending", async () => {
    const { routes, preferenceCreate } = loadApp({
      supabase: {
        insertOrder: async () => ({ data: null, error: new Error("database detail") }),
      },
    });
    const response = createResponse();

    await routes.post["/crear-preferencia"]({}, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: "No se pudo iniciar el pago" });
    expect(preferenceCreate).not.toHaveBeenCalled();
  });
});

describe("webhook de pagos", () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
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
    expect(logSpy).toHaveBeenCalledWith("firma de webhook ausente");
  });

  test("rechaza webhooks con firma inválida", async () => {
    const { routes, paymentGet } = loadApp();
    const response = createResponse();

    await routes.post["/webhook"](
      makeWebhookRequest({
        headers: {
          "x-request-id": "request-test",
          "x-signature": `ts=1700000000,v1=${"0".repeat(64)}`,
        },
      }),
      response
    );

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Webhook inválido" });
    expect(paymentGet).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("firma de webhook inválida");
  });

  test("continúa el flujo con firma válida", async () => {
    const { routes, paymentGet } = loadApp();
    const response = createResponse();

    await routes.post["/webhook"](makeWebhookRequest({ headers: validHeaders() }), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(paymentGet).toHaveBeenCalledWith({ id: "PAYMENTTEST" });
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
    expect(logSpy).toHaveBeenCalledWith("Monto de pago no coincide con el pedido");
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
    expect(logSpy).toHaveBeenCalledWith("Pedido no encontrado para procesar pago");
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
    expect(logSpy).toHaveBeenCalledWith("Pedido ya estaba pagado, webhook duplicado ignorado");
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
    expect(logSpy).toHaveBeenCalledWith("Pedido ya procesado, webhook duplicado ignorado");
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
    expect(logSpy).toHaveBeenCalledWith("Moneda de pago no coincide con el pedido");
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

    const logOutput = logSpy.mock.calls.flat().join(" ");
    expect(logOutput).not.toContain("99.99");
    expect(logOutput).not.toContain("100.00");
    expect(logOutput).not.toContain("USD");
    expect(logOutput).not.toContain("ARS");
  });
});
