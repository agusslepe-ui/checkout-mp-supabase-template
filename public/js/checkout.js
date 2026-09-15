const CHECKOUT_ENDPOINT = "/crear-preferencia";
const PURCHASE_SKUS = new Set([
  "LEM-REM-001-S",
  "LEM-REM-001-M",
  "LEM-REM-001-L",
  "LEM-REM-001-XL",
]);
const PURCHASE_QUANTITY = 1;
const PAYABLE_SHIPPING_OPTIONS = new Set([
  "micorreo:home:classic",
  "micorreo:home:express",
]);
const CONTROLLED_SHIPPING_ERRORS = new Set([
  "Elegí una opción de envío",
  "No pudimos calcular el envío",
]);

async function getControlledShippingError(response) {
  if (response.status !== 400) return null;

  try {
    const body = await response.json();
    return CONTROLLED_SHIPPING_ERRORS.has(body?.error) ? body.error : null;
  } catch {
    return null;
  }
}

async function crearPreferencia(input) {
  const { sku, quantity, customer, delivery, shippingOptionId } = input;
  if (!PAYABLE_SHIPPING_OPTIONS.has(shippingOptionId)) {
    throw new Error("invalid_shipping");
  }
  const hasItems = Object.prototype.hasOwnProperty.call(input, "items");
  let body;
  if (hasItems) {
    if (Object.prototype.hasOwnProperty.call(input, "sku") ||
        Object.prototype.hasOwnProperty.call(input, "quantity") ||
        !Array.isArray(input.items) || !input.items.length) throw new Error("invalid_cart");
    body = {
      items: input.items.map(({ sku, quantity }) => ({ sku, quantity })),
      customer,
      delivery,
      shippingOptionId,
    };
  } else {
    if (!PURCHASE_SKUS.has(sku) || quantity !== PURCHASE_QUANTITY) throw new Error("invalid_product");
    body = { sku, quantity, customer, delivery, shippingOptionId };
  }

  const response = await fetch(CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 409) throw new Error("shipping_changed");
    const controlledShippingError = await getControlledShippingError(response);
    if (controlledShippingError) throw new Error(controlledShippingError);
    throw new Error(response.status === 400
      ? (hasItems ? "invalid_cart" : "invalid_product")
      : "checkout_unavailable");
  }

  const preference = await response.json();
  const checkoutUrl = preference.init_point || preference.sandbox_init_point;

  if (!checkoutUrl) {
    throw new Error("checkout_unavailable");
  }

  return checkoutUrl;
}

export async function iniciarCheckout(input) {
  const { button, statusElement } = input;
  // Mitigación visual, no idempotencia durable.
  if (button.disabled) return;
  const originalLabel = button.textContent;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Preparando pago…";
  if (statusElement) statusElement.textContent = "";

  try {
    const checkoutUrl = await crearPreferencia(input);
    button.textContent = "Redirigiendo…";
    if (statusElement) statusElement.textContent = "Redirigiendo a Mercado Pago…";
    window.location.assign(checkoutUrl);
  } catch (error) {
    if (error.message === "shipping_changed" &&
        typeof input.onShippingInvalidated === "function") {
      input.onShippingInvalidated();
    }
    if (statusElement) {
      statusElement.textContent = CONTROLLED_SHIPPING_ERRORS.has(error.message)
        ? error.message
        : error.message === "invalid_product"
        ? "Este producto no está disponible para comprar."
        : error.message === "invalid_shipping"
          ? "Elegí una opción de envío a domicilio."
          : error.message === "shipping_changed"
            ? "La opción de envío cambió. Volvé a calcular y elegir el envío."
        : error.message === "invalid_cart"
          ? "No pudimos validar el carrito. Volvé al carrito para revisarlo."
          : "No pudimos iniciar el pago. Intentá nuevamente.";
    }
    button.disabled = ["invalid_shipping", "shipping_changed"].includes(error.message);
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
  }
}
