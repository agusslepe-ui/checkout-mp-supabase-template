const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const CHECKOUT_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";

// DOM mínimo y fetch aislado: no se inicia servidor ni navegador/red real.
function node() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    children: [], textContent: "", value: "", disabled: false,
    set innerHTML(value) { throw new Error("API data must use textContent"); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(event, handler) { listeners.set(event, handler); },
    removeEventListener(event, handler) { if (listeners.get(event) === handler) listeners.delete(event); },
    emit(event) { return listeners.get(event)?.(); },
    setAttribute(key, value) { attributes.set(key, value); },
    getAttribute(key) { return attributes.get(key); },
    removeAttribute(key) { attributes.delete(key); },
    focus() {},
  };
}
function setup(selection, fetchImpl, onSelectionChange = jest.fn()) {
  const button = node(), status = node(), options = node(), postalCode = node(), province = node();
  postalCode.value = "5400";
  province.value = "AR-J";
  const fetch = jest.fn(fetchImpl || (async () => ({ ok: true, json: async () => ({ options: [] }) })));
  const context = vm.createContext({ fetch, AbortController, Intl, document: { createElement: node } });
  const source = fs.readFileSync(path.join(__dirname, "../public/js/envio.js"), "utf8");
  vm.runInContext(source.replace("export function", "function"), context);
  const dispose = context.inicializarCotizacionEnvio({
    form: { elements: { postalCode, province }, querySelector: (selector) => ({
      "[data-shipping-button]": button, "[data-shipping-status]": status, "[data-shipping-options]": options,
    })[selector] }, ...selection, onSelectionChange,
  });
  return { button, status, options, postalCode, province, fetch, dispose, onSelectionChange };
}

test.each([
  { sku: "LEM-REM-001-S", quantity: 1 },
  { items: [{ sku: "LEM-REM-001-S", quantity: 2 }, { sku: "LEM-REM-001-M", quantity: 1 }] },
])("envio conserva contrato y envia solo seleccion + CP %j", async (selection) => {
  const ui = setup(selection);
  await ui.button.emit("click");
  expect(ui.fetch.mock.calls[0][0]).toBe("/cotizar-envio");
  expect(JSON.parse(ui.fetch.mock.calls[0][1].body)).toEqual({ ...selection, postalCodeDestination: "5400" });
});

test("oculta HOME Express y renderiza sólo HOME Classic", async () => {
  const ui = setup({ sku: "LEM-REM-001-S", quantity: 1 }, async () => ({
    ok: true,
    json: async () => ({ options: [
      {
        id: "micorreo:home:classic", type: "home", deliveryType: "home",
        label: "Envío a domicilio — Clásico", price: 500,
      },
      {
        id: "micorreo:home:express", type: "home", deliveryType: "home",
        label: "Envío a domicilio — Express", price: 900,
      },
    ] }),
  }));

  await ui.button.emit("click");
  expect(ui.options.children).toHaveLength(1);
  expect(ui.options.children[0].children[0].children[0].value)
    .toBe("micorreo:home:classic");
  expect(ui.options.children[0].children[0].children[1].textContent)
    .toBe("Envío a domicilio — Clásico");
  expect(ui.options.children[0].children[1].textContent).not.toContain("900");
});

test("oculta AGENCY Express y renderiza sólo AGENCY Classic", async () => {
  const ui = setup({ sku: "LEM-REM-001-S", quantity: 1 }, async () => ({
    ok: true,
    json: async () => ({ options: [
      {
        id: "micorreo:agency:classic", type: "agency", deliveryType: "agency",
        label: "Retiro en sucursal — Clásico", price: 400,
      },
      {
        id: "micorreo:agency:express", type: "agency", deliveryType: "agency",
        label: "Retiro en sucursal — Express", price: 700,
      },
    ] }),
  }));

  await ui.button.emit("click");
  expect(ui.options.children).toHaveLength(1);
  expect(ui.options.children[0].children[0].children[0].value)
    .toBe("micorreo:agency:classic");
  expect(ui.options.children[0].children[0].children[1].textContent)
    .toBe("Retiro en sucursal — Clásico");
  expect(ui.options.children[0].children[1].textContent).not.toContain("700");
});

test("si sólo llegan opciones Express no las renderiza y muestra ausencia pública", async () => {
  const ui = setup({ sku: "LEM-REM-001-S", quantity: 1 }, async () => ({
    ok: true,
    json: async () => ({ options: [
      {
        id: "micorreo:home:express", type: "home", deliveryType: "home",
        label: "Envío a domicilio — Express", price: 900,
      },
      {
        id: "micorreo:agency:express", type: "agency", deliveryType: "agency",
        label: "Retiro en sucursal — Express", price: 700,
      },
    ] }),
  }));

  await ui.button.emit("click");
  expect(ui.options.children).toHaveLength(0);
  expect(ui.status.textContent)
    .toBe("No encontramos opciones de envío para ese código postal.");
  expect(ui.fetch).toHaveBeenCalledTimes(1);
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith(null);
});

test("envio no cotiza carrito vacio", async () => {
  const ui = setup({ items: [] });
  await ui.button.emit("click");
  expect(ui.fetch).not.toHaveBeenCalled();
});

test.each(["postalCode", "dispose"])("envio descarta respuesta tardia tras %s", async (change) => {
  let resolve;
  const ui = setup({ items: [{ sku: "LEM-REM-001-S", quantity: 2 }] }, () => new Promise((done) => { resolve = done; }));
  const pending = ui.button.emit("click");
  if (change === "postalCode") ui.postalCode.emit("input");
  else ui.dispose();
  expect(ui.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  resolve({ ok: true, json: async () => ({ options: [{ type: "home", label: "old", price: 1 }] }) });
  await pending;
  expect(ui.options.children).toHaveLength(0);
  expect(ui.status.textContent).toBe("");
  expect(ui.button.disabled).toBe(false);
  if (change === "dispose") {
    await ui.button.emit("click");
    expect(ui.fetch).toHaveBeenCalledTimes(1);
  }
});

test("selecciona home por ID e invalida la selección al cambiar el CP", async () => {
  const ui = setup({ items: [{ sku: "LEM-REM-001-S", quantity: 1 }] }, async () => ({
    ok: true,
    json: async () => ({
      options: [{
        id: "micorreo:home:classic",
        type: "home",
        deliveryType: "home",
        label: "Envío a domicilio — Clásico",
        price: 8500,
      }],
    }),
  }));

  await ui.button.emit("click");
  const choice = ui.options.children[0].children[0];
  const radio = choice.children[0];
  radio.emit("change");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith({
    id: "micorreo:home:classic",
    price: 8500,
    agencyCode: null,
  });

  ui.postalCode.emit("input");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith(null);
});

test("agency es seleccionable, lista segura, filtra localmente y entrega solo code", async () => {
  const unsafeName = "<img src=x onerror=alert(1)> Sucursal";
  const ui = setup({ items: [{ sku: "LEM-REM-001-S", quantity: 1 }] }, async (url) => {
    if (url === "/cotizar-envio") return {
      ok: true, json: async () => ({ options: [{
        id: "micorreo:agency:classic", type: "agency", deliveryType: "agency",
        label: "Retiro en sucursal — Clásico", price: 500,
      }] }),
    };
    return { ok: true, json: async () => ({ agencies: [{
      code: "J0001", name: unsafeName, streetName: "Mitre", streetNumber: "123",
      locality: "San Juan", city: "Capital", postalCode: "J5400ABC",
    }] }) };
  });

  await ui.button.emit("click");
  const article = ui.options.children[0];
  const shippingRadio = article.children[0].children[0];
  await shippingRadio.emit("change");
  expect(ui.fetch.mock.calls[1][0]).toBe("/sucursales-envio");
  expect(JSON.parse(ui.fetch.mock.calls[1][1].body)).toEqual({ province: "AR-J" });
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith({
    id: "micorreo:agency:classic", price: 500, agencyCode: null,
  });
  const panel = article.children[2];
  const search = panel.children[2];
  const list = panel.children[3];
  const agencyChoice = list.children[0];
  expect(agencyChoice.children[1].children[0].textContent).toBe(unsafeName);
  await agencyChoice.children[0].emit("change");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith({
    id: "micorreo:agency:classic", price: 500, agencyCode: "J0001",
  });
  search.value = "inexistente";
  search.emit("input");
  expect(list.children).toHaveLength(0);
  expect(panel.children[1].textContent).toContain("No encontramos");
});

test("lista vacía muestra mensaje seguro y no habilita agency", async () => {
  const ui = setup({ sku: "LEM-REM-001-S", quantity: 1 }, async (url) => url === "/cotizar-envio"
    ? { ok: true, json: async () => ({ options: [{
      id: "micorreo:agency:classic", type: "agency", deliveryType: "agency",
      label: "Retiro en sucursal — Clásico", price: 700,
    }] }) }
    : { ok: true, json: async () => ({ agencies: [] }) });
  await ui.button.emit("click");
  await ui.options.children[0].children[0].children[0].emit("change");
  expect(ui.options.children[0].children[2].children[1].textContent)
    .toBe("No hay sucursales disponibles para esa provincia.");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith({
    id: "micorreo:agency:classic", price: 700, agencyCode: null,
  });
});

test("cambiar provincia aborta agencies y una respuesta tardía no revive selección", async () => {
  let resolveAgencies;
  const ui = setup({ sku: "LEM-REM-001-S", quantity: 1 }, async (url) => {
    if (url === "/cotizar-envio") return { ok: true, json: async () => ({ options: [{
      id: "micorreo:agency:classic", type: "agency", deliveryType: "agency",
      label: "Agency", price: 500,
    }] }) };
    return new Promise((resolve) => { resolveAgencies = resolve; });
  });
  await ui.button.emit("click");
  const pending = ui.options.children[0].children[0].children[0].emit("change");
  ui.province.value = "AR-B";
  ui.province.emit("change");
  expect(ui.fetch.mock.calls[1][1].signal.aborted).toBe(true);
  resolveAgencies({ ok: true, json: async () => ({ agencies: [{ code: "OLD" }] }) });
  await pending;
  expect(ui.options.children).toHaveLength(0);
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith(null);
});

test("cambiar de agency a HOME limpia el code y habilita la selección home", async () => {
  const ui = setup({ sku: "LEM-REM-001-S", quantity: 1 }, async (url) => {
    if (url === "/cotizar-envio") return { ok: true, json: async () => ({ options: [
      { id: "micorreo:agency:classic", type: "agency", deliveryType: "agency", label: "Agency", price: 500 },
      { id: "micorreo:home:classic", type: "home", deliveryType: "home", label: "Home", price: 700 },
    ] }) };
    return { ok: true, json: async () => ({ agencies: [{
      code: "J0001", name: "Centro", streetName: "Mitre", streetNumber: "123",
      locality: "San Juan", city: "Capital", postalCode: "J5400ABC",
    }] }) };
  });
  await ui.button.emit("click");
  await ui.options.children[0].children[0].children[0].emit("change");
  await ui.options.children[0].children[2].children[3].children[0].children[0].emit("change");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ agencyCode: "J0001" }));
  await ui.options.children[1].children[0].children[0].emit("change");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith({
    id: "micorreo:home:classic", price: 700, agencyCode: null,
  });
});

function setupCheckout(response = {
  ok: true,
  status: 200,
  json: async () => ({ init_point: "https://checkout.test/init" }),
}) {
  const fetch = jest.fn(async () => response);
  const assign = jest.fn();
  const values = new Map();
  const sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const crypto = { subtle: webcrypto.subtle, randomUUID: () => CHECKOUT_ATTEMPT_ID };
  const context = vm.createContext({
    fetch, window: { location: { assign } }, sessionStorage, crypto,
    TextEncoder, Uint8Array, Set, Error, JSON,
  });
  const attemptSource = fs.readFileSync(
    path.join(__dirname, "../public/js/checkoutAttemptClient.js"), "utf8"
  );
  vm.runInContext(attemptSource, context);
  const source = fs.readFileSync(path.join(__dirname, "../public/js/checkout.js"), "utf8");
  vm.runInContext(
    source.replace('import "./checkoutAttemptClient.js";', "")
      .replace("export async function", "async function"),
    context
  );
  return { context, fetch, assign };
}

test("checkout envía solo shippingOptionId y omite precios/totales del navegador", async () => {
  const { context, fetch, assign } = setupCheckout();
  const button = node();
  button.textContent = "Iniciar pago";
  const statusElement = node();

  await context.iniciarCheckout({
    items: [{ sku: "LEM-REM-001-S", quantity: 1, price: 1 }],
    customer: { firstName: "Ana" },
    delivery: { postalCode: "5400" },
    shippingOptionId: "micorreo:home:classic",
    shippingPrice: 1,
    price: 1,
    amount: 1,
    total: 1,
    button,
    statusElement,
  });

  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    items: [{ sku: "LEM-REM-001-S", quantity: 1 }],
    customer: { firstName: "Ana" },
    delivery: { postalCode: "5400" },
    shippingOptionId: "micorreo:home:classic",
    checkoutAttemptId: CHECKOUT_ATTEMPT_ID,
  });
  expect(assign).toHaveBeenCalledWith("https://checkout.test/init");
});

test("checkout agency envía solo shippingAgencyCode como identidad", async () => {
  const { context, fetch } = setupCheckout();
  const button = node();
  button.textContent = "Iniciar pago";
  await context.iniciarCheckout({
    sku: "LEM-REM-001-S", quantity: 1, customer: {}, delivery: {},
    shippingOptionId: "micorreo:agency:classic", shippingAgencyCode: "J0001",
    shippingAgencyName: "Manipulada", shippingAgencyAddress: "Manipulada",
    button, statusElement: node(),
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    sku: "LEM-REM-001-S", quantity: 1, customer: {}, delivery: {},
    shippingOptionId: "micorreo:agency:classic", shippingAgencyCode: "J0001",
    checkoutAttemptId: CHECKOUT_ATTEMPT_ID,
  });
});

test("checkout HOME ignora shippingAgencyCode extra", async () => {
  const { context, fetch } = setupCheckout();
  const button = node();
  button.textContent = "Iniciar pago";
  await context.iniciarCheckout({
    sku: "LEM-REM-001-S", quantity: 1, customer: {}, delivery: {},
    shippingOptionId: "micorreo:home:classic", shippingAgencyCode: "J0001",
    button, statusElement: node(),
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("shippingAgencyCode");
});

test("checkout bloquea shipping ausente y agency sin sucursal", async () => {
  for (const shippingOptionId of [undefined, "micorreo:agency:classic"]) {
    const { context, fetch } = setupCheckout();
    const button = node();
    button.textContent = "Iniciar pago";
    const statusElement = node();
    await context.iniciarCheckout({
      sku: "LEM-REM-001-S",
      quantity: 1,
      customer: {},
      delivery: {},
      shippingOptionId,
      button,
      statusElement,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(statusElement.textContent).toContain(shippingOptionId ? "Elegí una sucursal" : "Elegí una opción de envío");
  }
});

test("checkout 409 invalida la selección y exige volver a cotizar", async () => {
  const { context } = setupCheckout({
    ok: false,
    status: 409,
    json: async () => ({ error: "La opción de envío ya no está disponible" }),
  });
  const button = node();
  button.textContent = "Iniciar pago";
  const statusElement = node();
  const onShippingInvalidated = jest.fn();

  await context.iniciarCheckout({
    sku: "LEM-REM-001-S",
    quantity: 1,
    customer: {},
    delivery: {},
    shippingOptionId: "micorreo:home:classic",
    onShippingInvalidated,
    button,
    statusElement,
  });

  expect(onShippingInvalidated).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  expect(statusElement.textContent).toContain("Volvé a calcular");
});

test("checkout 409 de agency invalida la selección con mensaje controlado", async () => {
  const { context } = setupCheckout({
    ok: false,
    status: 409,
    json: async () => ({ error: "La sucursal ya no está disponible" }),
  });
  const button = node();
  button.textContent = "Iniciar pago";
  const statusElement = node();
  const onShippingInvalidated = jest.fn();
  await context.iniciarCheckout({
    sku: "LEM-REM-001-S", quantity: 1, customer: {}, delivery: {},
    shippingOptionId: "micorreo:agency:classic", shippingAgencyCode: "J0001",
    onShippingInvalidated, button, statusElement,
  });
  expect(onShippingInvalidated).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  expect(statusElement.textContent).toContain("sucursal ya no está disponible");
});

test.each([
  "Elegí una opción de envío",
  "No pudimos calcular el envío",
])("checkout muestra el error 400 controlado del backend: %s", async (message) => {
  const { context } = setupCheckout({
    ok: false,
    status: 400,
    json: async () => ({ error: message }),
  });
  const button = node();
  button.textContent = "Iniciar pago";
  const statusElement = node();

  await context.iniciarCheckout({
    sku: "LEM-REM-001-S", quantity: 1, customer: {}, delivery: {},
    shippingOptionId: "micorreo:home:classic", button, statusElement,
  });

  expect(statusElement.textContent).toBe(message);
});

test("checkout no muestra errores 400 arbitrarios del backend", async () => {
  const unsafeMessage = "<img src=x onerror=alert(1)> detalle privado";
  const { context } = setupCheckout({
    ok: false,
    status: 400,
    json: async () => ({ error: unsafeMessage }),
  });
  const button = node();
  button.textContent = "Iniciar pago";
  const statusElement = node();

  await context.iniciarCheckout({
    sku: "LEM-REM-001-S", quantity: 1, customer: {}, delivery: {},
    shippingOptionId: "micorreo:home:classic", button, statusElement,
  });

  expect(statusElement.textContent).toBe("Este producto no está disponible para comprar.");
  expect(statusElement.textContent).not.toContain(unsafeMessage);
});

test("entrega exige shipping y muestra Subtotal, Envío y Total", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/entrega.js"), "utf8");
  expect(source).toContain("data-delivery-submit disabled");
  expect(source).toContain("(needsAgency && !selectedShippingAgencyCode)");
  expect(source).toContain("shippingAgencyCode: selectedShippingAgencyCode");
  expect(source).toContain('["Subtotal", "data-order-subtotal"]');
  expect(source).toContain('["Envío", "data-order-shipping"]');
  expect(source).toContain('["Total", "data-order-total"]');
  expect(source).toContain("cartStore.subscribe");
});
