const CHECKOUT_ENDPOINT = "/crear-preferencia";
const PURCHASE_SKUS = new Set([
  "LEM-REM-001-S",
  "LEM-REM-001-M",
  "LEM-REM-001-L",
  "LEM-REM-001-XL",
]);
const PURCHASE_QUANTITY = 1;

async function crearPreferencia(sku) {
  if (!PURCHASE_SKUS.has(sku)) {
    throw new Error("invalid_product");
  }

  const response = await fetch(CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku,
      quantity: PURCHASE_QUANTITY,
    }),
  });

  if (!response.ok) {
    throw new Error(response.status === 400 ? "invalid_product" : "checkout_unavailable");
  }

  const preference = await response.json();
  const checkoutUrl = preference.init_point || preference.sandbox_init_point;

  if (!checkoutUrl) {
    throw new Error("checkout_unavailable");
  }

  return checkoutUrl;
}

async function iniciarCompra(button) {
  const checkoutScope = button.closest("[data-checkout-scope]");
  const status = checkoutScope?.querySelector("[data-checkout-status]");
  const sizeSelect = checkoutScope?.querySelector("[data-size-select]");
  const originalLabel = button.textContent;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Preparando pago…";
  if (sizeSelect) sizeSelect.disabled = true;
  if (status) status.textContent = "";

  try {
    const checkoutUrl = await crearPreferencia(button.dataset.checkoutSku);
    button.textContent = "Redirigiendo…";
    if (status) status.textContent = "Redirigiendo a Mercado Pago…";
    window.location.assign(checkoutUrl);
  } catch (error) {
    if (status) {
      status.textContent = error.message === "invalid_product"
        ? "Este producto no está disponible para comprar."
        : "No pudimos iniciar el pago. Intentá nuevamente.";
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
    if (sizeSelect) sizeSelect.disabled = false;
  }
}

export function inicializarCheckout() {
  document.addEventListener("change", (event) => {
    const sizeSelect = event.target.closest("select[data-size-select]");

    if (!sizeSelect) return;

    const checkoutScope = sizeSelect.closest("[data-checkout-scope]");
    const button = checkoutScope?.querySelector("button[data-checkout-button]");
    const status = checkoutScope?.querySelector("[data-checkout-status]");

    if (!button) return;

    button.dataset.checkoutSku = sizeSelect.value;
    button.disabled = !sizeSelect.value;
    if (status) status.textContent = "";
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-checkout-button]");

    if (!button || button.disabled) return;
    iniciarCompra(button);
  });
}
