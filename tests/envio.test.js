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
function setup(selection, fetchImpl) {
  const button = node(), status = node(), options = node(), postalCode = node();
  const fetch = jest.fn(fetchImpl || (async () => ({ ok: true, json: async () => ({ options: [] }) })));
  const context = vm.createContext({ fetch, AbortController, Intl, document: { createElement: node } });
  const source = fs.readFileSync(path.join(__dirname, "../public/js/envio.js"), "utf8");
  vm.runInContext(source.replace("export function", "function"), context);
  const dispose = context.inicializarCotizacionEnvio({
    form: { elements: { postalCode }, querySelector: (selector) => ({
      "[data-shipping-button]": button, "[data-shipping-status]": status, "[data-shipping-options]": options,
    })[selector] }, ...selection,
  });
  return { button, status, options, postalCode, fetch, dispose };
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

test("envio muestra sucursal/Express como texto e informa que no se cobra", async () => {
  const label = "<img src=x onerror=alert(1)> — Express";
  const ui = setup({ items: [{ sku: "LEM-REM-001-S", quantity: 2, price: 999 }] }, async () => ({
    ok: true, json: async () => ({ options: [{ type: "agency", label, price: 12 }] }),
  }));
  await ui.button.emit("click");
  expect(JSON.parse(ui.fetch.mock.calls[0][1].body).items[0]).not.toHaveProperty("price");
  expect(ui.options.children[0].children[0].textContent).toBe(label);
  expect(ui.options.children[0].children[2].textContent).toContain("próxima etapa");
  expect(ui.status.textContent).toContain("no se suma al total");
});
