export const CART_KEY = "lemont.cart";
// Límites informativos, no stock. El backend vuelve a validar cada compra.
const MAX_QUANTITY = 4;
const MAX_ITEMS = 50;

function normalize(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.version !== 1 || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) {
    throw new Error("invalid_cart");
  }
  const grouped = new Map();
  for (const item of value.items) {
    if (!item || typeof item.sku !== "string" || !item.sku.trim() ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error("invalid_cart");
    }
    const quantity = (grouped.get(item.sku) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new Error("invalid_cart");
    grouped.set(item.sku, quantity);
  }
  return [...grouped].map(([sku, quantity]) => ({ sku, quantity }));
}

export function createCartStore({ storage = () => window.localStorage, events = globalThis.window } = {}) {
  const listeners = new Set();
  const getStorage = () => typeof storage === "function" ? storage() : storage;
  const load = () => {
    try {
      return { version: 1, items: normalize(JSON.parse(getStorage().getItem(CART_KEY))) };
    } catch {
      return { version: 1, items: [] };
    }
  };
  const getItems = () => load().items;
  const notify = () => listeners.forEach((listener) => listener(getItems()));
  function commit(items) {
    try {
      const clean = normalize({ version: 1, items });
      getStorage().setItem(CART_KEY, JSON.stringify({ version: 1, items: clean }));
      notify();
      return { ok: true };
    } catch {
      return { ok: false, message: "No pudimos guardar el carrito. Revisá el almacenamiento del navegador." };
    }
  }
  const limitError = () => ({ ok: false, message: "El límite temporal es 4 por variante y 50 líneas. No representa stock." });
  function save(value) {
    try {
      const items = normalize(value);
      if (items.some((item) => item.quantity > MAX_QUANTITY)) return limitError();
      return commit(items);
    } catch {
      return { ok: false, message: "No pudimos actualizar el carrito." };
    }
  }
  function setQuantity(sku, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return limitError();
    const items = getItems();
    const item = items.find((line) => line.sku === sku);
    if (!item) return { ok: false, message: "La línea ya no está en el carrito." };
    item.quantity = quantity;
    return commit(items);
  }
  function add(sku, quantity = 1) {
    const items = getItems();
    const item = items.find((line) => line.sku === sku);
    const next = (item?.quantity || 0) + quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || next > MAX_QUANTITY ||
        (!item && items.length >= MAX_ITEMS)) return limitError();
    if (item) item.quantity = next;
    else items.push({ sku, quantity });
    return commit(items);
  }
  events?.addEventListener("storage", (event) => {
    if (event.key === CART_KEY || event.key === null) notify();
  });
  return {
    load, save, add, setQuantity, getItems,
    getCount: () => getItems().reduce((total, item) => total + item.quantity, 0),
    remove: (sku) => commit(getItems().filter((item) => item.sku !== sku)),
    clear: () => commit([]),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const cartStore = createCartStore();
