const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CART_KEY = "lemont.cart";
const ATTEMPT_KEY = "lemont.checkoutAttempt.v1";
const html = fs.readFileSync(path.join(__dirname, "../public/success.html"), "utf8");
const source = fs.readFileSync(
  path.join(__dirname, "../public/js/successCleanup.js"),
  "utf8"
);

function memoryStorage(entries) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key)),
    value: (key) => values.get(key) ?? null,
  };
}

function runCleanup() {
  const localStorage = memoryStorage({
    [CART_KEY]: JSON.stringify({ version: 1, items: [{ sku: "LEM-REM-001-S", quantity: 1 }] }),
    "lemont.unrelated": "keep-local",
  });
  const sessionStorage = memoryStorage({
    [ATTEMPT_KEY]: JSON.stringify({ version: 1, checkoutAttemptId: "test", intentDigest: "test" }),
    "lemont.session.unrelated": "keep-session",
  });
  const fetch = jest.fn();
  const assign = jest.fn();
  const clearCart = jest.fn(() => localStorage.setItem(CART_KEY, JSON.stringify({ version: 1, items: [] })));
  const clearCheckoutAttempt = jest.fn((storage) => storage.removeItem(ATTEMPT_KEY));
  const context = vm.createContext({
    CART_KEY,
    cartStore: { clear: clearCart },
    localStorage,
    sessionStorage,
    fetch,
    window: { location: { assign } },
    LemontCheckoutAttempt: { clearCheckoutAttempt },
  });
  const executable = source
    .replace('import { CART_KEY, cartStore } from "./cartStore.js";', "")
    .replace('import "./checkoutAttemptClient.js";', "")
    .replace("export function cleanupSuccessState", "function cleanupSuccessState");

  vm.runInContext(executable, context);
  return { localStorage, sessionStorage, fetch, assign, clearCart, clearCheckoutAttempt };
}

describe("post-pago success", () => {
  test("limpia solo el carrito real y el checkoutAttempt", () => {
    const result = runCleanup();

    expect(result.localStorage.value(CART_KEY)).toBeNull();
    expect(result.sessionStorage.value(ATTEMPT_KEY)).toBeNull();
    expect(result.localStorage.value("lemont.unrelated")).toBe("keep-local");
    expect(result.sessionStorage.value("lemont.session.unrelated")).toBe("keep-session");
    expect(result.localStorage.removeItem).toHaveBeenCalledWith(CART_KEY);
    expect(result.clearCart).toHaveBeenCalledTimes(1);
    expect(result.clearCheckoutAttempt).toHaveBeenCalledWith(result.sessionStorage);
  });

  test("no llama backend ni redirige a Mercado Pago", () => {
    const result = runCleanup();
    expect(result.fetch).not.toHaveBeenCalled();
    expect(result.assign).not.toHaveBeenCalled();
  });

  test("presenta el mensaje esperado y un enlace al inicio", () => {
    expect(html).toContain("¡Gracias por tu compra!");
    expect(html).toContain("Tu pago fue aprobado.");
    expect(html).toContain("Estamos preparando tu pedido.");
    expect(html).toMatch(/<a\s+class="button button--accent"\s+href="\/">Volver al inicio<\/a>/);
    expect(html).toContain('aria-labelledby="success-title"');
    expect(html).not.toMatch(/external_reference|preference_id|payment_id/i);
  });
});
