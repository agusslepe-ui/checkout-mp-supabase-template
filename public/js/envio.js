export function inicializarCotizacionEnvio({ form, sku, quantity }) {
  const button = form.querySelector("[data-shipping-button]");
  const statusElement = form.querySelector("[data-shipping-status]");
  const optionsElement = form.querySelector("[data-shipping-options]");
  const postalCodeInput = form.elements.postalCode;

  postalCodeInput.addEventListener("input", clearQuotes);
  button.addEventListener("click", async () => {
    const postalCodeDestination = postalCodeInput.value.trim();
    if (!postalCodeDestination || postalCodeInput.getAttribute("aria-invalid") === "true") {
      statusElement.textContent = "Ingresá un código postal válido.";
      postalCodeInput.focus();
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Calculando…";
    statusElement.textContent = "";
    optionsElement.replaceChildren();

    try {
      const response = await fetch("/cotizar-envio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, quantity, postalCodeDestination }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.options)) throw new Error("shipping_unavailable");

      renderQuotes(body.options, optionsElement, statusElement);
    } catch (error) {
      statusElement.textContent = "No pudimos calcular el envío. Intentá nuevamente.";
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Calcular envío";
    }
  });

  function clearQuotes() {
    optionsElement.replaceChildren();
    statusElement.textContent = "";
  }
}

function renderQuotes(options, container, statusElement) {
  if (options.length === 0) {
    statusElement.textContent = "No encontramos opciones de envío para ese código postal.";
    return;
  }

  for (const option of options) {
    const article = document.createElement("article");
    article.className = "shipping-option";
    const label = document.createElement("strong");
    label.textContent = option.label;
    const price = document.createElement("span");
    price.textContent = formatPrice(option.price);
    article.append(label, price);

    if (option.type === "agency") {
      const note = document.createElement("small");
      note.textContent = "La selección de sucursal estará disponible en una próxima etapa.";
      article.append(note);
    }
    container.append(article);
  }

  statusElement.textContent = "Cotización informativa. Todavía no se suma al total de la compra.";
}

function formatPrice(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value);
}
