const CHECKOUT_ENDPOINT = "/crear-preferencia";
const PURCHASE_SKU = "REMERA-LEMONT-001";
const PURCHASE_QUANTITY = 1;

async function crearPreferencia(sku) {
  if (sku !== PURCHASE_SKU) {
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
  const card = button.closest(".product-card");
  const status = card?.querySelector("[data-checkout-status]");
  const originalLabel = button.textContent;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Preparando pago…";
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
  }
}

export function inicializarCheckout() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-checkout-sku]");

    if (!button || button.disabled) return;
    iniciarCompra(button);
  });
}
