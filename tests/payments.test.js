const mockCreate = jest.fn();
const mockGet = jest.fn();
const mockSearch = jest.fn();

jest.mock("../src/config", () => ({ mercadoPagoAccessToken: "TEST-TOKEN-NOT-REAL" }));
jest.mock("mercadopago", () => ({
  MercadoPagoConfig: jest.fn(),
  Payment: jest.fn(() => ({ get: jest.fn() })),
  Preference: jest.fn(() => ({
    create: mockCreate,
    get: mockGet,
    search: mockSearch,
  })),
}));

const { searchPreferencesByExternalReference } = require("../src/payments");

describe("recuperación de preferencias Mercado Pago", () => {
  beforeEach(() => jest.clearAllMocks());

  test("busca por external_reference exacta con timeout acotado", async () => {
    mockSearch.mockResolvedValue({ elements: [], total: 0 });
    await expect(searchPreferencesByExternalReference("LEMONT-ORDER-1"))
      .resolves.toEqual({ count: 0, preference: null });
    expect(mockSearch).toHaveBeenCalledWith({
      options: { external_reference: "LEMONT-ORDER-1", limit: 100 },
      requestOptions: { timeout: 8000 },
    });
  });

  test("completa el único resultado y devuelve solo campos seguros", async () => {
    mockSearch.mockResolvedValue({
      elements: [{ id: "PREF-1", external_reference: "LEMONT-ORDER-1" }],
      total: 1,
    });
    mockGet.mockResolvedValue({
      id: "PREF-1",
      external_reference: "LEMONT-ORDER-1",
      init_point: "https://checkout.example/recovered",
      access_token: "never-return-this",
    });

    await expect(searchPreferencesByExternalReference("LEMONT-ORDER-1"))
      .resolves.toEqual({
        count: 1,
        preference: {
          id: "PREF-1",
          external_reference: "LEMONT-ORDER-1",
          checkout_url: "https://checkout.example/recovered",
        },
      });
    expect(mockGet).toHaveBeenCalledWith({ preferenceId: "PREF-1" });
    expect(mockGet).not.toHaveBeenCalledWith({ id: "PREF-1" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("más de un resultado queda ambiguo y no consulta uno arbitrario", async () => {
    mockSearch.mockResolvedValue({
      elements: [
        { id: "PREF-1", external_reference: "LEMONT-ORDER-1" },
        { id: "PREF-2", external_reference: "LEMONT-ORDER-1" },
      ],
      total: 2,
    });
    await expect(searchPreferencesByExternalReference("LEMONT-ORDER-1"))
      .resolves.toEqual({ count: 2, preference: null });
    expect(mockGet).not.toHaveBeenCalled();
  });

  test.each([
    [{ elements: [{ id: "PREF-1", external_reference: "OTRA" }], total: 1 }],
    [{ elements: [{ id: "", external_reference: "LEMONT-ORDER-1" }], total: 1 }],
    [{ elements: [], total: 1 }],
    [{ elements: "invalid", total: 0 }],
  ])("rechaza respuestas de búsqueda no confiables %#", async (response) => {
    mockSearch.mockResolvedValue(response);
    await expect(searchPreferencesByExternalReference("LEMONT-ORDER-1"))
      .rejects.toThrow();
  });

  test.each([
    ["ID distinto", {
      id: "PREF-DISTINTA",
      external_reference: "LEMONT-ORDER-1",
      init_point: "https://checkout.example/recovered",
    }],
    ["external_reference distinta", {
      id: "PREF-1",
      external_reference: "LEMONT-ORDER-OTRA",
      init_point: "https://checkout.example/recovered",
    }],
    ["URL ausente", {
      id: "PREF-1",
      external_reference: "LEMONT-ORDER-1",
    }],
    ["URL no HTTPS", {
      id: "PREF-1",
      external_reference: "LEMONT-ORDER-1",
      init_point: "http://checkout.example/insecure",
    }],
  ])("rechaza get con %s antes de que pueda marcarse READY", async (_case, complete) => {
    mockSearch.mockResolvedValue({
      elements: [{ id: "PREF-1", external_reference: "LEMONT-ORDER-1" }],
      total: 1,
    });
    mockGet.mockResolvedValue(complete);

    await expect(searchPreferencesByExternalReference("LEMONT-ORDER-1"))
      .rejects.toThrow("invalid recovered preference");
    expect(mockGet).toHaveBeenCalledWith({ preferenceId: "PREF-1" });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
