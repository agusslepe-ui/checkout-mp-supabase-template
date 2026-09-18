jest.mock("../src/config", () => ({
  micorreoBaseUrl: "https://micorreo.test/v1",
  micorreoUser: "fixture-user",
  micorreoPassword: "fixture-password",
  micorreoCustomerId: "backend-customer",
  shippingOriginPostalCode: "1000",
}));

const fs = require("fs");
const path = require("path");

const {
  SHIPPING_IMPORT_ERROR_TYPES,
  ShippingImportError,
  buildImportPayload,
  createShippingImportService,
} = require("../src/shippingImportService");

function snapshot(overrides = {}) {
  return {
    order_id: 42,
    ext_order_id: "LEMONT-ORDER-42",
    weight_grams: 300,
    height_cm: 5,
    width_cm: 25,
    length_cm: 35,
    declared_value: 2000,
    customer_first_name: " Ana ",
    customer_last_name: " Pérez ",
    customer_email: "ana@example.test",
    customer_phone: "541123456789",
    shipping_country_code: "AR",
    shipping_province: "AR-J",
    shipping_locality: "San Juan",
    shipping_postal_code: "5400",
    shipping_street: "Mitre",
    shipping_street_number: "123",
    shipping_apartment: "Piso 2 depto B",
    shipping_delivery_type: "home",
    shipping_service: "classic",
    shipping_agency_code: null,
    ...overrides,
  };
}

describe("T-022.3 mapping de importación", () => {
  test("HOME usa exclusivamente configuración y snapshot persistido", async () => {
    const provider = { importShipment: jest.fn().mockResolvedValue({
      createdAt: "2026-09-18T12:00:00.000-03:00",
    }) };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    const input = snapshot({
      customerId: "browser-customer",
      dimensions: { weight: 9999 },
      shipping_amount: 850,
    });

    await expect(service.importShipment(input)).resolves.toEqual({
      createdAt: "2026-09-18T12:00:00.000-03:00",
    });
    expect(provider.importShipment).toHaveBeenCalledWith({
      customerId: "backend-customer",
      extOrderId: "LEMONT-ORDER-42",
      recipient: {
        name: "Ana Pérez",
        email: "ana@example.test",
        phone: "541123456789",
      },
      shipping: {
        deliveryType: "D",
        address: {
          streetName: "Mitre",
          streetNumber: "123",
          city: "San Juan",
          provinceCode: "J",
          postalCode: "5400",
        },
        weight: 300,
        declaredValue: 2000,
        height: 5,
        length: 35,
        width: 25,
      },
    });
    const payload = provider.importShipment.mock.calls[0][0];
    expect(payload.shipping).not.toHaveProperty("agency");
    expect(payload.shipping.address).not.toHaveProperty("floor");
    expect(payload.shipping.address).not.toHaveProperty("apartment");
    expect(payload.shipping).not.toHaveProperty("productType");
    const source = fs.readFileSync(path.join(__dirname, "../src/shippingImportService.js"), "utf8");
    expect(source).not.toContain("getPackageProfile");
  });

  test("AGENCY usa sólo code y no incorpora domicilio", () => {
    const payload = buildImportPayload(snapshot({
      shipping_delivery_type: "agency",
      shipping_agency_code: "J0001",
      shipping_street: "domicilio que no debe salir",
    }), "backend-customer");
    expect(payload.shipping).toEqual({
      deliveryType: "S",
      agency: "J0001",
      weight: 300,
      declaredValue: 2000,
      height: 5,
      length: 35,
      width: 25,
    });
    expect(payload.shipping).not.toHaveProperty("address");
  });

  test.each([
    ["extOrderId", { ext_order_id: "" }],
    ["customerId", {}, ""],
    ["nombre", { customer_first_name: "" }],
    ["email", { customer_email: "invalid" }],
    ["teléfono", { customer_phone: "" }],
    ["delivery type", { shipping_delivery_type: "drone" }],
    ["HOME address", { shipping_street: "" }],
    ["AGENCY code", { shipping_delivery_type: "agency", shipping_agency_code: null }],
    ["weight", { weight_grams: 0 }],
    ["dimensions", { height_cm: 0 }],
    ["declaredValue", { declared_value: -1 }],
  ])("%s inválido es permanente y no llama provider", async (label, overrides, customerId = "backend-customer") => {
    const provider = { importShipment: jest.fn() };
    const service = createShippingImportService(provider, { customerId });
    await expect(service.importShipment(snapshot(overrides))).rejects.toMatchObject({
      type: SHIPPING_IMPORT_ERROR_TYPES.VALIDATION,
      retryable: false,
      ambiguous: false,
    });
    expect(provider.importShipment).not.toHaveBeenCalled();
  });

  test.each([
    null, undefined, "", " ", false, true, [], {}, NaN, Infinity, -Infinity, -1,
  ])("declaredValue inválido %# falla antes del provider", async (declaredValue) => {
    const provider = { importShipment: jest.fn() };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    await expect(service.importShipment(snapshot({ declared_value: declaredValue })))
      .rejects.toMatchObject({ type: SHIPPING_IMPORT_ERROR_TYPES.VALIDATION });
    expect(provider.importShipment).not.toHaveBeenCalled();
  });

  test.each([
    "weight_grams", "height_cm", "width_cm", "length_cm",
  ])("%s exige un entero positivo sin coerción", async (field) => {
    for (const value of [null, " ", "5", false, NaN, Infinity, 1.5, 0, -1]) {
      const provider = { importShipment: jest.fn() };
      const service = createShippingImportService(provider, { customerId: "backend-customer" });
      await expect(service.importShipment(snapshot({ [field]: value })))
        .rejects.toMatchObject({ type: SHIPPING_IMPORT_ERROR_TYPES.VALIDATION });
      expect(provider.importShipment).not.toHaveBeenCalled();
    }
  });

  test.each([
    "shipping_street",
    "shipping_street_number",
    "shipping_locality",
    "shipping_province",
    "shipping_postal_code",
  ])("HOME exige %s antes del provider", async (field) => {
    const provider = { importShipment: jest.fn() };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    await expect(service.importShipment(snapshot({ [field]: undefined })))
      .rejects.toMatchObject({ type: SHIPPING_IMPORT_ERROR_TYPES.VALIDATION });
    expect(provider.importShipment).not.toHaveBeenCalled();
  });

  test("HOME rechaza whitespace en un campo obligatorio", async () => {
    const provider = { importShipment: jest.fn() };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    await expect(service.importShipment(snapshot({ shipping_street_number: " " })))
      .rejects.toMatchObject({ type: SHIPPING_IMPORT_ERROR_TYPES.VALIDATION });
    expect(provider.importShipment).not.toHaveBeenCalled();
  });

  test("AGENCY rechaza agency code whitespace", async () => {
    const provider = { importShipment: jest.fn() };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    await expect(service.importShipment(snapshot({
      shipping_delivery_type: "agency",
      shipping_agency_code: " ",
    }))).rejects.toMatchObject({ type: SHIPPING_IMPORT_ERROR_TYPES.VALIDATION });
    expect(provider.importShipment).not.toHaveBeenCalled();
  });

  test("un error inesperado del provider se preserva sin inventar transporte", async () => {
    const unexpected = new Error("programming error");
    const provider = { importShipment: jest.fn().mockRejectedValue(unexpected) };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    await expect(service.importShipment(snapshot())).rejects.toBe(unexpected);
  });

  test("Express queda bloqueado antes del transporte", async () => {
    const provider = { importShipment: jest.fn() };
    const service = createShippingImportService(provider, { customerId: "backend-customer" });
    await expect(service.importShipment(snapshot({ shipping_service: "express" })))
      .rejects.toBeInstanceOf(ShippingImportError);
    await expect(service.importShipment(snapshot({ shipping_service: "express" })))
      .rejects.toMatchObject({ type: SHIPPING_IMPORT_ERROR_TYPES.UNSUPPORTED_SERVICE });
    expect(provider.importShipment).not.toHaveBeenCalled();
  });
});
