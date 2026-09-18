const config = {
  micorreoBaseUrl: "https://micorreo.test/v1",
  micorreoUser: "fixture-user",
  micorreoPassword: "fixture-password",
  micorreoCustomerId: "fixture-customer",
  shippingOriginPostalCode: "1000",
};
const now = Date.parse("2026-09-14T12:00:00Z");
const response = (status, body) => ({
  status, ok: status >= 200 && status < 300, json: jest.fn().mockResolvedValue(body),
});
const jwt = (exp) => `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;

function load(overrides = {}) {
  jest.doMock("../src/config", () => ({ ...config, ...overrides }));
  return require("../src/micorreo");
}

describe("T-018 autenticacion interna y provider", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(Date, "now").mockReturnValue(now);
    global.fetch = jest.fn().mockRejectedValue(new Error("unexpected mock request"));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  test("contrato oficial, Basic POST sin body, cache y margen de 30 segundos", async () => {
    const { authenticate, MiCorreoProvider } = load();
    global.fetch.mockResolvedValue(response(200, {
      token: "fixture-token", expires: "2026-09-14T09:01:00-03:00", expires_in: 99999,
    }));
    expect(MiCorreoProvider.authenticate).toBe(authenticate);
    await expect(authenticate()).resolves.toBe("fixture-token");
    Date.now.mockReturnValue(now + 29999);
    await authenticate();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(`${config.micorreoBaseUrl}/token`);
    expect(options.method).toBe("POST");
    expect(options.body).toBeUndefined();
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    Date.now.mockReturnValue(now + 30000);
    await authenticate();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([undefined, "invalid-date"])("JWT exp fallback cuando expires es %s", async (expires) => {
    const { authenticate } = load();
    global.fetch.mockResolvedValue(response(200, {
      token: jwt(now / 1000 + 60), expires, expires_in: 99999,
    }));
    await authenticate();
    Date.now.mockReturnValue(now + 29999);
    await authenticate();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    Date.now.mockReturnValue(now + 30000);
    await authenticate();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    { token: "opaque", expires: "2026-09-14T11:00:00Z", expires_in: 3600 },
    { token: jwt(now / 1000 - 1), expires_in: 3600 },
    { token: "opaque" },
    { token: "opaque", expires: "2026-09-14T12:00:20Z" },
  ])("no cachea vigencia vencida, desconocida o dentro del margen %#", async (body) => {
    const { authenticate } = load();
    global.fetch.mockResolvedValue(response(200, body));
    await authenticate();
    await authenticate();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("comparte autenticacion simultanea en vuelo", async () => {
    const { authenticate } = load();
    let resolve;
    global.fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = [authenticate(), authenticate(), authenticate()];
    expect(global.fetch).toHaveBeenCalledTimes(1);
    resolve(response(200, { token: "fixture-token", expires: "2026-09-14T13:00:00Z" }));
    expect(await Promise.all(pending)).toEqual(Array(3).fill("fixture-token"));
  });

  test("libera la autenticacion en vuelo tras fallo y no reintenta /token automaticamente", async () => {
    const { authenticate } = load();
    global.fetch.mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { token: "new", expires: "2026-09-14T13:00:00Z" }));
    await expect(authenticate()).rejects.toMatchObject({ type: "micorreo_auth_error" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await expect(authenticate()).resolves.toBe("new");
  });

  test("un 401 tardio reutiliza la renovacion concurrente y reintenta solo una vez", async () => {
    const { quoteRates } = load();
    let releaseLateResponse;
    let oldCalls = 0;
    let tokenCalls = 0;
    global.fetch.mockImplementation(async (url, options) => {
      if (url.endsWith("/token")) {
        tokenCalls += 1;
        return response(200, { token: `fixture-${tokenCalls}`, expires: "2026-09-14T13:00:00Z" });
      }
      if (options.headers.Authorization === "Bearer fixture-1") {
        oldCalls += 1;
        if (oldCalls === 1) return new Promise((resolve) => { releaseLateResponse = resolve; });
        return response(401, {});
      }
      return response(200, { rates: [] });
    });
    const first = quoteRates({});
    const second = quoteRates({});
    await second;
    releaseLateResponse(response(401, {}));
    await first;
    expect(tokenCalls).toBe(2);
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith("/rates"))).toHaveLength(4);
  });

  test.each(["micorreoBaseUrl", "micorreoUser", "micorreoPassword"])("config ausente %s no hace fetch", async (key) => {
    const { authenticate } = load({ [key]: " " });
    await expect(authenticate()).rejects.toMatchObject({ type: "micorreo_config_error" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("autenticacion no necesita customerId ni origen", async () => {
    const { authenticate } = load({ micorreoCustomerId: "", shippingOriginPostalCode: "" });
    global.fetch.mockResolvedValue(response(200, { token: "fixture-token", expires: "2026-09-14T13:00:00Z" }));
    await expect(authenticate()).resolves.toBe("fixture-token");
  });

  test("timeout aborta a los 8 segundos sin exponer error externo", async () => {
    jest.useFakeTimers();
    const { authenticate } = load();
    global.fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("fixture-password")));
    }));
    const result = expect(authenticate()).rejects.toMatchObject({ message: "micorreo_network_error" });
    await jest.advanceTimersByTimeAsync(8000);
    await result;
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([null, {}, { token: " " }])("rechaza respuesta de autenticacion invalida %#", async (body) => {
    const { authenticate } = load();
    global.fetch.mockResolvedValue(response(200, body));
    await expect(authenticate()).rejects.toMatchObject({ type: "micorreo_auth_error" });
  });

  test("ShippingService usa el contrato inyectado y conserva payload autoritativo", async () => {
    load();
    const { createShippingService } = require("../src/shipping");
    const provider = { authenticate: jest.fn(), quoteRates: jest.fn().mockResolvedValue({ rates: [] }) };
    await createShippingService(provider).getShippingQuotes({
      sku: "LEM-REM-001-S", quantity: 1, postalCodeDestination: "b1900abc",
      customerId: "untrusted", dimensions: { weight: 999 },
    });
    expect(provider.quoteRates).toHaveBeenCalledWith({
      customerId: config.micorreoCustomerId, postalCodeOrigin: "1000", postalCodeDestination: "B1900ABC",
      dimensions: { weight: 300, height: 5, width: 25, length: 35 },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("listAgencies usa GET, Bearer y solo customerId + provinceCode", async () => {
    const { listAgencies, MiCorreoProvider } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "fixture-token", expires: "2026-09-14T13:00:00Z",
      }))
      .mockResolvedValueOnce(response(200, []));

    await expect(listAgencies({
      customerId: "fixture-customer", provinceCode: "J",
    })).resolves.toEqual([]);
    expect(MiCorreoProvider.listAgencies).toBe(listAgencies);
    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toBe(`${config.micorreoBaseUrl}/agencies?customerId=fixture-customer&provinceCode=J`);
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.headers).toEqual({
      Accept: "application/json", Authorization: "Bearer fixture-token",
    });
  });

  test("listAgencies renueva una vez ante 401", async () => {
    const { listAgencies } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "old", expires: "2026-09-14T13:00:00Z",
      }))
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, {
        token: "new", expires: "2026-09-14T13:00:00Z",
      }))
      .mockResolvedValueOnce(response(200, []));
    await expect(listAgencies({ customerId: "customer", provinceCode: "J" }))
      .resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test.each([402, 429, 500])("listAgencies clasifica HTTP %s sin exponer body", async (status) => {
    const { listAgencies } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "fixture-token", expires: "2026-09-14T13:00:00Z",
      }))
      .mockResolvedValueOnce(response(status, { message: "private" }));
    await expect(listAgencies({ customerId: "customer", provinceCode: "J" }))
      .rejects.toMatchObject({ type: "micorreo_agency_error", status });
  });

  test("listAgencies rechaza JSON inválido", async () => {
    const { listAgencies } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "fixture-token", expires: "2026-09-14T13:00:00Z",
      }))
      .mockResolvedValueOnce({ status: 200, ok: true, json: jest.fn().mockRejectedValue(new Error("raw")) });
    await expect(listAgencies({ customerId: "customer", provinceCode: "J" }))
      .rejects.toMatchObject({ type: "micorreo_invalid_agencies_response" });
  });

  test("listAgencies convierte network/timeout en error genérico", async () => {
    jest.useFakeTimers();
    const { listAgencies } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "fixture-token", expires: "2026-09-14T13:00:00Z",
      }))
      .mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("private timeout")));
      }));
    const result = expect(listAgencies({ customerId: "customer", provinceCode: "J" }))
      .rejects.toMatchObject({ type: "micorreo_network_error" });
    await jest.advanceTimersByTimeAsync(8000);
    await result;
  });

  test("listAgencies convierte un error de red inmediato en error genérico", async () => {
    const { listAgencies } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "fixture-token", expires: "2026-09-14T13:00:00Z",
      }))
      .mockRejectedValueOnce(new Error("private network detail"));
    await expect(listAgencies({ customerId: "customer", provinceCode: "J" }))
      .rejects.toMatchObject({ type: "micorreo_network_error" });
  });

  test("quoteRates conserva micorreo_network_error ante timeout", async () => {
    jest.useFakeTimers();
    const { quoteRates } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, {
        token: "fixture-token", expires: "2026-09-14T13:00:00Z",
      }))
      .mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("private timeout")));
      }));
    const result = expect(quoteRates({})).rejects.toMatchObject({
      type: "micorreo_network_error",
    });
    await jest.advanceTimersByTimeAsync(8000);
    await result;
  });

  test("ShippingService mapea provincia y filtra snapshot público", async () => {
    load();
    const { createShippingService } = require("../src/shipping");
    const provider = {
      authenticate: jest.fn(), quoteRates: jest.fn(),
      listAgencies: jest.fn().mockResolvedValue([
        {
          code: "J0001", name: "Centro", status: "ACTIVE",
          manager: "private", email: "private@example.test", phone: "000",
          services: { pickupAvailability: true },
          location: { latitude: 1, longitude: 2, address: {
            streetName: "Mitre", streetNumber: "123", locality: "San Juan",
            city: "Capital", postalCode: "J5400ABC",
          } },
        },
        { code: "J0002", name: "Inactiva", status: "INACTIVE" },
        { code: "J0003", name: "Sin retiro", status: "ACTIVE", services: { pickupAvailability: false } },
      ]),
    };
    const agencies = await createShippingService(provider).listShippingAgencies({
      province: "ar-j", provinceCode: "X", postalCode: "9999", customerId: "browser",
    });
    expect(provider.listAgencies).toHaveBeenCalledWith({
      customerId: config.micorreoCustomerId, provinceCode: "J",
    });
    expect(agencies).toEqual([{
      code: "J0001", name: "Centro", streetName: "Mitre", streetNumber: "123",
      locality: "San Juan", city: "Capital", postalCode: "J5400ABC",
    }]);
    expect(JSON.stringify(agencies)).not.toMatch(/manager|email|phone|latitude|longitude|customer/i);
  });
});
