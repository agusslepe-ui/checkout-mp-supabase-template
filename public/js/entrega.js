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

if (!producto || !variante || quantity !== 1) {
  renderInvalidSelection();
} else {
  renderDeliveryForm();
}

function renderDeliveryForm() {
  document.title = `Entrega — ${producto.nombre} — LEMONT`;
  deliveryRoot.innerHTML = `
    <a class="product-page__back" href="producto.html?id=${encodeURIComponent(producto.id)}"><span aria-hidden="true">←</span> Volver al producto</a>
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
        <dl>
          <div><dt>Producto</dt><dd>${producto.nombre}</dd></div>
          <div><dt>Talle</dt><dd>${variante.talle}</dd></div>
          <div><dt>Cantidad</dt><dd>${quantity}</dd></div>
          <div><dt>Precio informativo</dt><dd>${formatearPrecio(producto.precio)}</dd></div>
        </dl>
        <p>El backend determina el precio y la moneda finales. El envío todavía no se cotiza en esta etapa.</p>
      </aside>
    </div>`;

  initializeForm();
}

function initializeForm() {
  const form = deliveryRoot.querySelector("[data-delivery-form]");
  const submitButton = form.querySelector("[data-delivery-submit]");
  const statusElement = form.querySelector("[data-delivery-status]");

  inicializarCotizacionEnvio({ form, sku, quantity });

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
      sku,
      quantity,
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
  deliveryRoot.innerHTML = `<section class="product-not-found" aria-labelledby="invalid-title"><p class="eyebrow eyebrow--accent">Entrega</p><h1 id="invalid-title">Compra no disponible</h1><p>Volvé al producto y seleccioná un talle válido.</p><a class="button button--accent" href="producto.html?id=remera-lemont">Volver al producto</a></section>`;
}
