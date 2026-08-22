const CHECKOUT_ENDPOINT = "/crear-preferencia";
const PURCHASE_SKUS = new Set([
  "LEM-REM-001-S",
  "LEM-REM-001-M",
  "LEM-REM-001-L",
  "LEM-REM-001-XL",
]);
const PURCHASE_QUANTITY = 1;

async function crearPreferencia({ sku, quantity, customer, delivery }) {
  if (!PURCHASE_SKUS.has(sku) || quantity !== PURCHASE_QUANTITY) {
    throw new Error("invalid_product");
  }

  const response = await fetch(CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku,
      quantity,
      customer,
      delivery,
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

export async function iniciarCheckout({
  sku,
  quantity,
  customer,
  delivery,
  button,
  statusElement,
}) {
  const originalLabel = button.textContent;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Preparando pago…";
  if (statusElement) statusElement.textContent = "";

  try {
    const checkoutUrl = await crearPreferencia({
      sku,
      quantity,
      customer,
      delivery,
    });
    button.textContent = "Redirigiendo…";
    if (statusElement) statusElement.textContent = "Redirigiendo a Mercado Pago…";
    window.location.assign(checkoutUrl);
  } catch (error) {
    if (statusElement) {
      statusElement.textContent = error.message === "invalid_product"
        ? "Este producto no está disponible para comprar."
        : "No pudimos iniciar el pago. Intentá nuevamente.";
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
  }
}
