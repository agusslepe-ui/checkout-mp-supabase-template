const config = {
  micorreoBaseUrl: "https://micorreo.test/v1",
  micorreoUser: "fixture-user",
  micorreoPassword: "fixture-password",
};
const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: jest.fn().mockResolvedValue(body),
});

function load() {
  jest.doMock("../src/config", () => config);
  return require("../src/micorreo");
}

function payload() {
  return {
    customerId: "backend-customer",
    extOrderId: "ORDER-42",
    recipient: { name: "Ana Pérez", email: "ana@example.test", phone: "111" },
    shipping: { deliveryType: "S", agency: "J0001", weight: 300,
      declaredValue: 2000, height: 5, length: 35, width: 25 },
  };
}

describe("T-022.3 MiCorreoProvider.importShipment", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn().mockRejectedValue(new Error("unexpected request"));
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  test("POST autenticado acepta sólo createdAt válido y no propaga el body", async () => {
    const { importShipment, MiCorreoProvider } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockResolvedValueOnce(response(200, {
        createdAt: "2026-09-18T12:00:00.000-03:00",
        trackingNumber: "no-propagar",
      }));
    await expect(importShipment(payload())).resolves.toEqual({
      createdAt: "2026-09-18T12:00:00.000-03:00",
    });
    expect(MiCorreoProvider.importShipment).toBe(importShipment);
    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toBe(`${config.micorreoBaseUrl}/shipping/import`);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer token");
    expect(JSON.parse(options.body)).toEqual(payload());
  });

  test.each([
    {},
    { createdAt: null },
    { createdAt: 123 },
    { createdAt: {} },
    { createdAt: "" },
    { createdAt: "not-a-date" },
    { createdAt: "01/02/2026" },
    { createdAt: "2026-02-30T12:00:00Z" },
    { createdAt: "2025-02-29T12:00:00Z" },
    { createdAt: "2026-13-01T12:00:00Z" },
    { createdAt: "2026-00-01T12:00:00Z" },
    { createdAt: "2026-01-32T12:00:00Z" },
    { createdAt: "2026-01-01T25:00:00Z" },
    { createdAt: "2026-01-01T12:60:00Z" },
    { createdAt: "2026-01-01T12:00:60Z" },
    { createdAt: "2026-01-01T12:00:00+24:00" },
    { createdAt: "2026-01-01T12:00:00+03:60" },
  ])(
    "2xx sin createdAt válido es ambiguo %#",
    async (body) => {
      const { importShipment } = load();
      global.fetch
        .mockResolvedValueOnce(response(200, { token: "token" }))
        .mockResolvedValueOnce(response(200, body));
      await expect(importShipment(payload())).rejects.toMatchObject({
        type: "AMBIGUOUS_RESPONSE", ambiguous: true, requestAttempted: true,
      });
    }
  );

  test.each([
    "2028-02-29T12:00:00Z",
    "2026-09-18T12:00:00Z",
    "2026-09-18T12:00:00.123-03:00",
  ])("acepta createdAt calendario válido %s", async (createdAt) => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockResolvedValueOnce(response(200, { createdAt }));
    await expect(importShipment(payload())).resolves.toEqual({ createdAt });
  });

  test("JSON inválido tras 2xx es ambiguo", async () => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockResolvedValueOnce({ status: 200, ok: true, json: jest.fn().mockRejectedValue(new Error("raw")) });
    await expect(importShipment(payload())).rejects.toMatchObject({
      type: "AMBIGUOUS_RESPONSE", ambiguous: true,
    });
  });

  test.each([
    [204, jest.fn().mockRejectedValue(new SyntaxError("empty"))],
    [200, jest.fn().mockResolvedValue(undefined)],
  ])("HTTP %s sin body útil es ambiguo", async (status, json) => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockResolvedValueOnce({ status, ok: true, json });
    await expect(importShipment(payload())).rejects.toMatchObject({
      type: "AMBIGUOUS_RESPONSE", ambiguous: true, requestAttempted: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("fallo de auth inicial ocurre antes del POST", async () => {
    const { importShipment } = load();
    global.fetch.mockResolvedValueOnce(response(401, {}));
    await expect(importShipment(payload())).rejects.toMatchObject({
      type: "AUTH", status: 401, requestAttempted: false, ambiguous: false,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(`${config.micorreoBaseUrl}/token`);
  });

  test("401 renueva token una sola vez y preserva exactamente el payload", async () => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "old" }))
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { token: "new" }))
      .mockResolvedValueOnce(response(200, { createdAt: "2026-09-18T12:00:00Z" }));
    await importShipment(payload());
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(global.fetch.mock.calls[1][1].body).toBe(global.fetch.mock.calls[3][1].body);
  });

  test("segundo 401 se clasifica AUTH y no vuelve a intentar", async () => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "old" }))
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { token: "new" }))
      .mockResolvedValueOnce(response(401, {}));
    await expect(importShipment(payload())).rejects.toMatchObject({ type: "AUTH", status: 401 });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith("/shipping/import")))
      .toHaveLength(2);
  });

  test("fallo renovando tras primer POST 401 conserva antecedente ambiguo", async () => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "old" }))
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(500, {}));
    await expect(importShipment(payload())).rejects.toMatchObject({
      type: "AUTH",
      requestAttempted: false,
      previousRequestAttempted: true,
      ambiguous: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith("/shipping/import")))
      .toHaveLength(1);
  });

  test.each([
    [408, "TIMEOUT", true, false],
    [429, "RATE_LIMIT", false, true],
    [402, "PROVIDER_REJECTED", false, false],
    [400, "PROVIDER_REJECTED", false, false],
    [500, "SERVER", true, false],
    [503, "SERVER", true, false],
  ])("HTTP %s => %s", async (status, type, ambiguous, retryable) => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockResolvedValueOnce(response(status, { private: "do not expose" }));
    await expect(importShipment(payload())).rejects.toMatchObject({
      type, status, ambiguous, retryable, requestAttempted: true,
    });
  });

  test("error de red después del POST queda ambiguo y no se reintenta", async () => {
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockRejectedValueOnce(new Error("private"));
    await expect(importShipment(payload())).rejects.toMatchObject({
      type: "NETWORK", ambiguous: true, requestAttempted: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("timeout después del POST queda ambiguo y no se reintenta", async () => {
    jest.useFakeTimers();
    const { importShipment } = load();
    global.fetch
      .mockResolvedValueOnce(response(200, { token: "token" }))
      .mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("private")));
      }));
    const result = expect(importShipment(payload())).rejects.toMatchObject({
      type: "TIMEOUT", ambiguous: true, requestAttempted: true,
    });
    await jest.advanceTimersByTimeAsync(8000);
    await result;
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
