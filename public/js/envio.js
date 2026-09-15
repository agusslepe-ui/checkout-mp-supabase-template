export function inicializarCotizacionEnvio({ form, sku, quantity, items }) {
  const button = form.querySelector("[data-shipping-button]");
  const statusElement = form.querySelector("[data-shipping-status]");
  const optionsElement = form.querySelector("[data-shipping-options]");
  const postalCodeInput = form.elements.postalCode;
  const selection = items === undefined ? { sku, quantity } : {
    items: items.map(({ sku, quantity }) => ({ sku, quantity })),
  };
  let revision = 0;
  let controller;

  postalCodeInput.addEventListener("input", clearQuotes);
  button.addEventListener("click", quote);
  async function quote() {
    if (selection.items && selection.items.length === 0) return;
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
    const current = ++revision;
    controller?.abort();
    controller = new AbortController();

    try {
      const response = await fetch("/cotizar-envio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, postalCodeDestination }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (current !== revision) return;
      if (!response.ok || !Array.isArray(body.options)) throw new Error("shipping_unavailable");

      renderQuotes(body.options, optionsElement, statusElement);
    } catch (error) {
      if (current !== revision) return;
      statusElement.textContent = "No pudimos calcular el envío. Intentá nuevamente.";
    } finally {
      if (current === revision) resetButton();
    }
  }

  function resetButton() {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Calcular envío";
  }

  function clearQuotes() {
    revision += 1;
    controller?.abort();
    resetButton();
    optionsElement.replaceChildren();
    statusElement.textContent = "";
  }
  return () => {
    clearQuotes();
    postalCodeInput.removeEventListener("input", clearQuotes);
    button.removeEventListener("click", quote);
  };
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
