const fs = require("fs");
const path = require("path");
const vm = require("vm");

// DOM mínimo y fetch aislado: no se inicia servidor ni navegador/red real.
function node() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    children: [], textContent: "", value: "5400", disabled: false,
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
  const button = node(), status = node(), options = node(), postalCode = node();
  const fetch = jest.fn(fetchImpl || (async () => ({ ok: true, json: async () => ({ options: [] }) })));
  const context = vm.createContext({ fetch, AbortController, Intl, document: { createElement: node } });
  const source = fs.readFileSync(path.join(__dirname, "../public/js/envio.js"), "utf8");
  vm.runInContext(source.replace("export function", "function"), context);
  const dispose = context.inicializarCotizacionEnvio({
    form: { elements: { postalCode }, querySelector: (selector) => ({
      "[data-shipping-button]": button, "[data-shipping-status]": status, "[data-shipping-options]": options,
    })[selector] }, ...selection, onSelectionChange,
  });
  return { button, status, options, postalCode, fetch, dispose, onSelectionChange };
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

test("envio muestra sucursal/Express como opción informativa no seleccionable", async () => {
  const label = "<img src=x onerror=alert(1)> — Express";
  const ui = setup({ items: [{ sku: "LEM-REM-001-S", quantity: 2, price: 999 }] }, async () => ({
    ok: true, json: async () => ({ options: [{ type: "agency", label, price: 12 }] }),
  }));
  await ui.button.emit("click");
  expect(JSON.parse(ui.fetch.mock.calls[0][1].body).items[0]).not.toHaveProperty("price");
  expect(ui.options.children[0].children[0].textContent).toBe(label);
  expect(ui.options.children[0].children[2].textContent).toContain("próxima etapa");
  expect(ui.status.textContent).toContain("Elegí una opción");
  expect(ui.options.children[0].children[0].children).toHaveLength(0);
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
  });

  ui.postalCode.emit("input");
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith(null);
});

function setupCheckout(response = {
  ok: true,
  status: 200,
  json: async () => ({ init_point: "https://checkout.test/init" }),
}) {
  const fetch = jest.fn(async () => response);
  const assign = jest.fn();
  const context = vm.createContext({ fetch, window: { location: { assign } }, Set, Error, JSON });
  const source = fs.readFileSync(path.join(__dirname, "../public/js/checkout.js"), "utf8");
  vm.runInContext(source.replace("export async function", "async function"), context);
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
  });
  expect(assign).toHaveBeenCalledWith("https://checkout.test/init");
});

test("checkout bloquea opciones agency o shipping ausente", async () => {
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
    expect(statusElement.textContent).toContain("Elegí una opción de envío");
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
  expect(source).toContain("submitButton.disabled = !cartReady || !selectedShippingOptionId");
  expect(source).toContain('["Subtotal", "data-order-subtotal"]');
  expect(source).toContain('["Envío", "data-order-shipping"]');
  expect(source).toContain('["Total", "data-order-total"]');
  expect(source).toContain("cartStore.subscribe");
});
