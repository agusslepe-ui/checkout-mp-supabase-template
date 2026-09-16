import "./checkoutAttemptClient.js";

const CHECKOUT_ENDPOINT = "/crear-preferencia";
const checkoutAttemptClient = globalThis.LemontCheckoutAttempt;
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
  "micorreo:agency:classic",
  "micorreo:agency:express",
]);
const CONTROLLED_SHIPPING_ERRORS = new Set([
  "Elegí una opción de envío",
  "No pudimos calcular el envío",
  "Elegí una sucursal",
  "La sucursal ya no está disponible",
]);

async function getBackendError(response) {
  if (![400, 409].includes(response.status)) return null;

  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

async function crearPreferencia(input) {
  const { sku, quantity, customer, delivery, shippingOptionId, shippingAgencyCode } = input;
  if (!PAYABLE_SHIPPING_OPTIONS.has(shippingOptionId)) {
    throw new Error("invalid_shipping");
  }
  if (shippingOptionId.startsWith("micorreo:agency:") &&
      (typeof shippingAgencyCode !== "string" || !shippingAgencyCode.trim())) {
    throw new Error("invalid_agency");
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
      ...(shippingOptionId.startsWith("micorreo:agency:") ? { shippingAgencyCode } : {}),
    };
  } else {
    if (!PURCHASE_SKUS.has(sku) || quantity !== PURCHASE_QUANTITY) throw new Error("invalid_product");
    body = {
      sku, quantity, customer, delivery, shippingOptionId,
      ...(shippingOptionId.startsWith("micorreo:agency:") ? { shippingAgencyCode } : {}),
    };
  }

  let checkoutAttemptId;
  try {
    const intentDigest = await checkoutAttemptClient.createIntentDigest(body);
    checkoutAttemptId = checkoutAttemptClient.getOrCreateCheckoutAttempt(intentDigest);
  } catch {
    throw new Error("checkout_attempt_unavailable");
  }
  body.checkoutAttemptId = checkoutAttemptId;

  const response = await fetch(CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const backendError = await getBackendError(response);
    if (response.status === 409) {
      if (backendError === "La opción de envío ya no está disponible") {
        throw new Error("shipping_changed");
      }
      if (backendError === "La sucursal ya no está disponible") {
        throw new Error("agency_changed");
      }
      if (backendError === "El checkout está siendo preparado. Intentá nuevamente") {
        throw new Error("checkout_busy");
      }
      if (backendError === "El intento de pago no coincide con la compra original") {
        checkoutAttemptClient.clearCheckoutAttempt();
        throw new Error("checkout_mismatch");
      }
      throw new Error("checkout_unavailable");
    }
    if (response.status === 400 && backendError === "Intento de pago inválido") {
      checkoutAttemptClient.clearCheckoutAttempt();
      throw new Error("checkout_attempt_invalid");
    }
    if (CONTROLLED_SHIPPING_ERRORS.has(backendError)) throw new Error(backendError);
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
    if (["shipping_changed", "agency_changed"].includes(error.message) &&
        typeof input.onShippingInvalidated === "function") {
      input.onShippingInvalidated();
    }
    if (statusElement) {
      statusElement.textContent = CONTROLLED_SHIPPING_ERRORS.has(error.message)
        ? error.message
        : error.message === "invalid_product"
        ? "Este producto no está disponible para comprar."
        : error.message === "invalid_shipping"
          ? "Elegí una opción de envío."
          : error.message === "invalid_agency"
            ? "Elegí una sucursal."
          : error.message === "shipping_changed"
            ? "La opción de envío cambió. Volvé a calcular y elegir el envío."
          : error.message === "agency_changed"
            ? "La sucursal ya no está disponible. Volvé a elegir una sucursal."
          : error.message === "checkout_busy"
            ? "El pago se está preparando. Intentá nuevamente en unos segundos."
          : error.message === "checkout_mismatch"
            ? "Los datos de la compra cambiaron. Intentá nuevamente."
        : error.message === "invalid_cart"
          ? "No pudimos validar el carrito. Volvé al carrito para revisarlo."
          : "No pudimos iniciar el pago. Intentá nuevamente.";
    }
    button.disabled = ["invalid_shipping", "invalid_agency", "shipping_changed", "agency_changed"]
      .includes(error.message);
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
  }
}
