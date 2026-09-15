import { cartStore } from "./cartStore.js";
import { requestCartSummary, summaryLine, element, formatCartPrice } from "./carrito.js";
import { iniciarCheckout } from "./checkout.js";
import { inicializarCotizacionEnvio } from "./envio.js";
import { productos, formatearPrecio } from "./productos.js";

const deliveryRoot = document.querySelector("[data-delivery-page]");
const params = new URLSearchParams(window.location.search);
const productId = params.get("id");
const sku = params.get("sku");
const quantity = Number(params.get("quantity"));
const producto = productos.find(({ id }) => id === productId);
const variante = producto?.variantes?.find((item) => item.sku === sku);

const cartMode = !["id", "sku", "quantity"].some((key) => params.has(key));
let checkoutItems = [];
let cartReady = false;

if (cartMode) {
  if (!cartStore.getItems().length) renderInvalidSelection();
  else renderDeliveryForm();
} else if (!producto || !variante || quantity !== 1) {
  renderInvalidSelection();
} else {
  renderDeliveryForm();
}

function renderDeliveryForm() {
  document.title = cartMode ? "Entrega — Carrito — LEMONT" : `Entrega — ${producto.nombre} — LEMONT`;
  deliveryRoot.innerHTML = `
    <a class="product-page__back" href="${cartMode ? "carrito.html" : "producto.html?id=" + encodeURIComponent(producto.id)}"><span aria-hidden="true">←</span> ${cartMode ? "Volver al carrito" : "Volver al producto"}</a>
    <div class="delivery-layout">
      <section class="delivery-form-section" aria-labelledby="delivery-title">
        <p class="eyebrow eyebrow--accent">Datos de entrega</p>
        <h1 id="delivery-title">Completá tu información</h1>
        <p class="delivery-intro">Usaremos estos datos únicamente para gestionar el pedido y su entrega.</p>

        <form class="delivery-form" data-delivery-form novalidate>
          <fieldset>
            <legend>Datos personales</legend>
            <div class="delivery-form__grid">
              ${fieldMarkup("firstName", "Nombre", "text", "given-name", true)}
              ${fieldMarkup("lastName", "Apellido", "text", "family-name", true)}
              ${fieldMarkup("email", "Email", "email", "email", true)}
              ${fieldMarkup("phone", "Teléfono", "tel", "tel", true)}
            </div>
          </fieldset>

          <fieldset>
            <legend>Dirección de entrega</legend>
            <div class="delivery-form__grid">
              <div class="field">
                <label for="province">Provincia</label>
                <select id="province" name="province" autocomplete="address-level1" required aria-describedby="province-error">
                  <option value="">Seleccioná una provincia</option>
                  ${provinceOptions()}
                </select>
                <span class="field-error" id="province-error" data-error-for="province"></span>
              </div>
              ${fieldMarkup("locality", "Localidad", "text", "address-level2", true)}
              ${fieldMarkup("postalCode", "Código postal", "text", "postal-code", true)}
              ${fieldMarkup("street", "Calle", "text", "address-line1", true)}
              ${fieldMarkup("streetNumber", "Número", "text", "off", true)}
              ${fieldMarkup("apartment", "Piso / departamento (opcional)", "text", "address-line2", false)}
            </div>
            <div class="field">
              <label for="notes">Referencia de entrega (opcional)</label>
              <textarea id="notes" name="notes" rows="3" maxlength="250" aria-describedby="notes-error"></textarea>
              <span class="field-error" id="notes-error" data-error-for="notes"></span>
            </div>
          </fieldset>

          <section class="shipping-quote" aria-labelledby="shipping-title">
            <h2 id="shipping-title">Cotización de envío</h2>
            <p>Calculá opciones informativas con tu código postal. El envío todavía no se suma al pago.</p>
            <button class="button button--secondary" type="button" data-shipping-button>Calcular envío</button>
            <div class="shipping-options" data-shipping-options></div>
            <p class="form-status" data-shipping-status aria-live="polite"></p>
          </section>

          <button class="button button--accent button--full" type="submit" data-delivery-submit>Iniciar pago</button>
          <p class="form-status" data-delivery-status aria-live="polite"></p>
        </form>
      </section>

      <aside class="delivery-summary" aria-labelledby="summary-title">
        <p class="eyebrow eyebrow--accent">Tu compra</p>
        <h2 id="summary-title">Resumen</h2>
        ${cartMode ? '<p>Validando carrito…</p>' : `
        <dl>
          <div><dt>Producto</dt><dd>${producto.nombre}</dd></div>
          <div><dt>Talle</dt><dd>${variante.talle}</dd></div>
          <div><dt>Cantidad</dt><dd>${quantity}</dd></div>
          <div><dt>Precio informativo</dt><dd>${formatearPrecio(producto.precio)}</dd></div>
        </dl>
        <p>El backend determina el precio y la moneda finales. El envío no se suma al pago.</p>`}
      </aside>
    </div>`;

  initializeForm();
}

function initializeForm() {
  const form = deliveryRoot.querySelector("[data-delivery-form]");
  const submitButton = form.querySelector("[data-delivery-submit]");
  const statusElement = form.querySelector("[data-delivery-status]");

  if (cartMode) initializeCartDelivery(form, submitButton, statusElement);
  else inicializarCotizacionEnvio({ form, sku, quantity });

  form.addEventListener("input", (event) => {
    if (event.target.matches("input, select, textarea")) {
      validateField(event.target, form);
    }
  });

  form.addEventListener("change", (event) => {
    if (event.target.matches("select")) validateField(event.target, form);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;
    if (cartMode && (!cartReady || JSON.stringify(checkoutItems) !== JSON.stringify(cartStore.getItems()))) {
      cartReady = false;
      submitButton.disabled = true;
      statusElement.textContent = "El carrito cambió. Volvé al carrito para revisar tu compra.";
      return;
    }
    const fields = [...form.querySelectorAll("input, select, textarea")];
    const valid = fields.every((field) => validateField(field, form));

    if (!valid) {
      statusElement.textContent = "Revisá los campos señalados.";
      fields.find((field) => field.getAttribute("aria-invalid") === "true")?.focus();
      return;
    }

    const values = new FormData(form);
    const customer = {
      firstName: values.get("firstName"),
      lastName: values.get("lastName"),
      email: values.get("email"),
      phone: values.get("phone"),
    };
    const delivery = {
      province: values.get("province"),
      locality: values.get("locality"),
      postalCode: values.get("postalCode"),
      street: values.get("street"),
      streetNumber: values.get("streetNumber"),
      apartment: values.get("apartment"),
      notes: values.get("notes"),
    };

    await iniciarCheckout({
      ...(cartMode ? { items: checkoutItems } : { sku, quantity }),
      customer,
      delivery,
      button: submitButton,
      statusElement,
    });
  });
}

function validateField(field, form) {
  const value = field.value.trim();
  const message = validationMessage(field.name, value, field.required);
  const error = form.querySelector(`[data-error-for="${field.name}"]`);

  field.setAttribute("aria-invalid", String(Boolean(message)));
  if (error) error.textContent = message;
  return !message;
}

function validationMessage(name, value, required) {
  if (required && !value) return "Completá este campo.";
  if (!value) return "";

  if (["firstName", "lastName"].includes(name)) {
    return value.length >= 2 && value.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u.test(value)
      ? ""
      : "Ingresá un nombre válido.";
  }
  if (name === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 ? "" : "Ingresá un email válido.";
  if (name === "phone") {
    const digits = value.replace(/\D/g, "");
    return /^[+\d\s().-]+$/.test(value) && digits.length >= 10 && digits.length <= 15 ? "" : "Ingresá un teléfono válido.";
  }
  if (name === "postalCode") return /^\d{4}$|^[A-Za-z]\d{4}[A-Za-z]{3}$/.test(value) ? "" : "Ingresá un código postal válido.";
  if (name === "locality") return value.length >= 2 && value.length <= 80 ? "" : "Ingresá una localidad válida.";
  if (name === "street") return value.length >= 2 && value.length <= 100 ? "" : "Ingresá una calle válida.";
  if (name === "streetNumber") return value.length <= 12 ? "" : "Ingresá un número válido.";
  if (name === "apartment") return value.length <= 30 ? "" : "Usá hasta 30 caracteres.";
  if (name === "notes") return value.length <= 250 ? "" : "Usá hasta 250 caracteres.";
  return "";
}

function fieldMarkup(name, label, type, autocomplete, required) {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" autocomplete="${autocomplete}"${required ? " required" : ""} aria-describedby="${name}-error"><span class="field-error" id="${name}-error" data-error-for="${name}"></span></div>`;
}

function provinceOptions() {
  const provinces = [
    ["AR-C", "Ciudad Autónoma de Buenos Aires"], ["AR-B", "Buenos Aires"],
    ["AR-K", "Catamarca"], ["AR-H", "Chaco"], ["AR-U", "Chubut"],
    ["AR-X", "Córdoba"], ["AR-W", "Corrientes"], ["AR-E", "Entre Ríos"],
    ["AR-P", "Formosa"], ["AR-Y", "Jujuy"], ["AR-L", "La Pampa"],
    ["AR-F", "La Rioja"], ["AR-M", "Mendoza"], ["AR-N", "Misiones"],
    ["AR-Q", "Neuquén"], ["AR-R", "Río Negro"], ["AR-A", "Salta"],
    ["AR-J", "San Juan"], ["AR-D", "San Luis"], ["AR-Z", "Santa Cruz"],
    ["AR-S", "Santa Fe"], ["AR-G", "Santiago del Estero"],
    ["AR-V", "Tierra del Fuego"], ["AR-T", "Tucumán"],
  ];
  return provinces.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
}

function renderInvalidSelection() {
  document.title = "Compra no disponible — LEMONT";
  if (cartMode) {
    deliveryRoot.replaceChildren(element("h1", "Compra no disponible"), element("p", "Tu carrito está vacío."));
    const link = element("a", "Volver al carrito", "button button--accent");
    link.href = "carrito.html";
    deliveryRoot.append(link);
    return;
  }
  deliveryRoot.innerHTML = `<section class="product-not-found" aria-labelledby="invalid-title"><p class="eyebrow eyebrow--accent">Entrega</p><h1 id="invalid-title">Compra no disponible</h1><p>Volvé al producto y seleccioná un talle válido.</p><a class="button button--accent" href="producto.html?id=remera-lemont">Volver al producto</a></section>`;
}

function initializeCartDelivery(form, submitButton, statusElement) {
  const aside = deliveryRoot.querySelector(".delivery-summary");
  const shipping = form.querySelector(".shipping-quote");
  const originalShipping = shipping.cloneNode(true);
  let revision = 0;
  let disposeShipping;
  const back = element("a", "Editar carrito", "text-link");
  back.href = "carrito.html";

  async function refresh() {
    const current = ++revision;
    disposeShipping?.();
    disposeShipping = undefined;
    cartReady = false;
    submitButton.disabled = true;
    checkoutItems = cartStore.getItems();
    const items = checkoutItems;
    aside.replaceChildren(element("h2", "Resumen", "cart-summary-title"), element("p", "Validando carrito…"));
    aside.querySelector("h2").id = "summary-title";
    aside.append(back);
    shipping.replaceChildren(element("h2", "Envío informativo"), element("p", "El envío informativo se habilita después de validar la compra. No se suma al pago."));
    shipping.querySelector("h2").id = "shipping-title";
    if (!items.length) {
      aside.append(element("p", "Compra no disponible. Tu carrito está vacío."));
      statusElement.textContent = "Volvé al carrito para continuar.";
      return;
    }
    try {
      const summary = await requestCartSummary(items);
      if (current !== revision) return;
      aside.replaceChildren(element("h2", "Resumen"), ...summary.items.map((line) => summaryLine(line, summary.currency)),
        element("p", "Subtotal: " + formatCartPrice(summary.subtotal, summary.currency), "cart-total"),
        element("p", "El backend determina los importes. El límite de 4 por variante no es stock. El envío no está incluido."));
      aside.querySelector("h2").id = "summary-title";
      aside.append(back);
      const totalUnits = summary.items.reduce((total, line) => total + line.quantity, 0);
      if (totalUnits >= 1 && totalUnits <= 4) {
        shipping.replaceChildren(...[...originalShipping.childNodes].map((node) => node.cloneNode(true)));
        disposeShipping = inicializarCotizacionEnvio({ form, items });
      } else {
        shipping.replaceChildren(element("h2", "Envío informativo"), element("p", "La cotización informativa está disponible para compras de 1 a 4 unidades totales. El envío no se suma al pago."));
        shipping.querySelector("h2").id = "shipping-title";
      }
      cartReady = true;
      submitButton.disabled = false;
      statusElement.textContent = "";
    } catch {
      if (current !== revision) return;
      aside.replaceChildren(element("h2", "Resumen no disponible"), element("p", "No pudimos validar el carrito. Volvé al carrito para editarlo o eliminar líneas."));
      aside.querySelector("h2").id = "summary-title";
      aside.append(back);
      const retry = element("button", "Reintentar resumen", "button button--secondary");
      retry.type = "button";
      retry.addEventListener("click", refresh);
      aside.append(retry);
    }
  }
  // No reemplazar el formulario ni perder PII al cambiar el carrito en otra pestaña.
  cartStore.subscribe(() => {
    if (submitButton.getAttribute("aria-busy") === "true") return;
    refresh();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      submitButton.removeAttribute("aria-busy");
      submitButton.textContent = "Iniciar pago";
      refresh();
    }
  });
  refresh();
}
