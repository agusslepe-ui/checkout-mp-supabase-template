import { cartStore } from "./cartStore.js";

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function formatCartPrice(value, currency) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(value);
}

export async function requestCartSummary(items) {
  const response = await fetch("/carrito/resumen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: items.map(({ sku, quantity }) => ({ sku, quantity })) }),
  });
  if (!response.ok) throw new Error(response.status === 400 ? "invalid_cart" : "summary_unavailable");
  const summary = await response.json();
  if (!Array.isArray(summary.items) || summary.items.length !== items.length ||
      typeof summary.currency !== "string" || !Number.isFinite(summary.subtotal) ||
      !summary.items.every((line) =>
        items.some((item) => item.sku === line.sku && item.quantity === line.quantity) &&
        typeof line.productName === "string" && Number.isFinite(line.unitPrice) &&
        Number.isFinite(line.lineSubtotal))) throw new Error("summary_unavailable");
  return summary;
}

export function summaryLine(line, currency) {
  const article = element("article", undefined, "cart-line");
  article.append(
    element("h3", line.productName),
    element("p", `Talle: ${line.variant ?? "—"} · Cantidad: ${line.quantity}`),
    element("p", `Precio unitario: ${formatCartPrice(line.unitPrice, currency)}`),
    element("strong", formatCartPrice(line.lineSubtotal, currency))
  );
  return article;
}

const root = document.querySelector("[data-cart-page]");
if (root) initializeCart();

function initializeCart() {
  const lines = root.querySelector("[data-cart-lines]");
  const total = root.querySelector("[data-cart-total]");
  const status = root.querySelector("[data-cart-status]");
  const continueButton = root.querySelector("[data-cart-continue]");
  const clearButton = root.querySelector("[data-cart-clear]");
  const retryButton = root.querySelector("[data-cart-retry]");
  let revision = 0;
  let summarizedItems = "";

  function mutate(action) {
    const result = action();
    if (!result.ok) status.textContent = result.message;
  }
  function controls(item, index) {
    const group = element("div", undefined, "cart-line__actions");
    for (const [label, action, accessible] of [
      ["−", () => item.quantity === 1 ? cartStore.remove(item.sku) : cartStore.setQuantity(item.sku, item.quantity - 1), "Reducir"],
      ["+", () => cartStore.setQuantity(item.sku, item.quantity + 1), "Incrementar"],
      ["Eliminar", () => cartStore.remove(item.sku), "Eliminar"],
    ]) {
      const button = element("button", label, "button button--secondary");
      button.type = "button";
      button.setAttribute("aria-label", `${accessible} línea ${index + 1}`);
      button.addEventListener("click", () => mutate(action));
      group.append(button);
    }
    return group;
  }
  function renderEditable(items, summary) {
    lines.replaceChildren(...items.map((item, index) => {
      const line = summary?.items.find(({ sku }) => sku === item.sku);
      const article = line ? summaryLine(line, summary.currency) : element("article", undefined, "cart-line");
      if (!line) article.append(element("h3", `Línea ${index + 1}`), element("p", `Cantidad guardada: ${item.quantity}`));
      article.append(controls(item, index));
      return article;
    }));
  }
  async function refresh() {
    const current = ++revision;
    const items = cartStore.getItems();
    summarizedItems = "";
    continueButton.disabled = true;
    clearButton.hidden = items.length === 0;
    retryButton.hidden = true;
    total.textContent = "";
    lines.replaceChildren();
    if (!items.length) {
      status.textContent = "Tu carrito está vacío.";
      const link = element("a", "Explorar el catálogo", "text-link");
      link.href = "catalogo.html";
      lines.replaceChildren(link);
      return;
    }
    status.textContent = "Actualizando importes…";
    try {
      const summary = await requestCartSummary(items);
      if (current !== revision) return;
      renderEditable(items, summary);
      total.textContent = `Subtotal: ${formatCartPrice(summary.subtotal, summary.currency)}`;
      status.textContent = "";
      summarizedItems = JSON.stringify(items);
      continueButton.disabled = false;
    } catch {
      if (current !== revision) return;
      renderEditable(items);
      status.textContent = "No pudimos validar el carrito. Editá o eliminá líneas y reintentá.";
      retryButton.hidden = false;
    }
  }
  clearButton.addEventListener("click", () => mutate(() => cartStore.clear()));
  retryButton.addEventListener("click", refresh);
  continueButton.addEventListener("click", () => {
    if (!summarizedItems || summarizedItems !== JSON.stringify(cartStore.getItems())) { refresh(); return; }
    window.location.assign("entrega.html");
  });
  cartStore.subscribe(refresh);
  window.addEventListener("pageshow", (event) => { if (event.persisted) refresh(); });
  refresh();
}
