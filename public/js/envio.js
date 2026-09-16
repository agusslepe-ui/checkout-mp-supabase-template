const PAYABLE_OPTIONS = new Set([
  "micorreo:home:classic",
  "micorreo:home:express",
  "micorreo:agency:classic",
  "micorreo:agency:express",
]);

export function inicializarCotizacionEnvio({
  form,
  sku,
  quantity,
  items,
  onSelectionChange = () => {},
}) {
  const button = form.querySelector("[data-shipping-button]");
  const statusElement = form.querySelector("[data-shipping-status]");
  const optionsElement = form.querySelector("[data-shipping-options]");
  const postalCodeInput = form.elements.postalCode;
  const provinceInput = form.elements.province;
  const selection = items === undefined ? { sku, quantity } : {
    items: items.map(({ sku, quantity }) => ({ sku, quantity })),
  };
  let revision = 0;
  let agencyRevision = 0;
  let controller;
  let agencyController;

  postalCodeInput.addEventListener("input", clearQuotes);
  provinceInput.addEventListener("change", clearQuotes);
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
    invalidateSelection();
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
      renderQuotes(body.options);
    } catch (error) {
      if (current !== revision) return;
      statusElement.textContent = "No pudimos calcular el envío. Intentá nuevamente.";
    } finally {
      if (current === revision) resetButton();
    }
  }

  function renderQuotes(options) {
    if (options.length === 0) {
      statusElement.textContent = "No encontramos opciones de envío para ese código postal.";
      return;
    }

    for (const option of options) {
      const article = document.createElement("article");
      article.className = "shipping-option";
      const choice = document.createElement("label");
      choice.className = "shipping-option__choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "shippingOption";
      input.value = option.id;
      const label = document.createElement("strong");
      label.textContent = option.label;
      const price = document.createElement("span");
      price.textContent = formatPrice(option.price);
      const deliveryType = option.deliveryType || option.type;
      const isAgency = deliveryType === "agency";
      const isPayable = PAYABLE_OPTIONS.has(option.id) && ["home", "agency"].includes(deliveryType);

      if (isPayable) {
        input.addEventListener("change", async () => {
          invalidateAgencyRequest();
          optionsElement.querySelectorAll?.(".shipping-agencies")
            .forEach((panel) => panel.remove());
          if (isAgency) {
            onSelectionChange({ id: option.id, price: option.price, agencyCode: null });
            await loadAgencies(option, article);
          } else {
            onSelectionChange({ id: option.id, price: option.price, agencyCode: null });
            statusElement.textContent = "Opción de envío seleccionada.";
          }
        });
        choice.append(input, label);
        article.append(choice, price);
      } else {
        article.append(label, price);
      }
      optionsElement.append(article);
    }
    statusElement.textContent = "Elegí una opción de envío para continuar.";
  }

  async function loadAgencies(option, article) {
    const province = provinceInput.value.trim();
    if (!province || provinceInput.getAttribute("aria-invalid") === "true") {
      statusElement.textContent = "Seleccioná una provincia válida para buscar sucursales.";
      provinceInput.focus();
      return;
    }

    const panel = document.createElement("section");
    panel.className = "shipping-agencies";
    const heading = document.createElement("h3");
    heading.textContent = "Seleccioná una sucursal";
    const agencyStatus = document.createElement("p");
    agencyStatus.className = "form-status";
    agencyStatus.textContent = "Buscando sucursales…";
    panel.append(heading, agencyStatus);
    article.append(panel);

    const current = ++agencyRevision;
    agencyController = new AbortController();
    try {
      const response = await fetch("/sucursales-envio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ province }),
        signal: agencyController.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (current !== agencyRevision) return;
      if (!response.ok || !Array.isArray(body.agencies)) throw new Error("agencies_unavailable");
      renderAgencies(body.agencies, panel, agencyStatus, option);
    } catch (error) {
      if (current !== agencyRevision) return;
      agencyStatus.textContent = "No pudimos obtener las sucursales. Intentá nuevamente.";
    }
  }

  function renderAgencies(agencies, panel, agencyStatus, option) {
    if (agencies.length === 0) {
      agencyStatus.textContent = "No hay sucursales disponibles para esa provincia.";
      return;
    }

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Buscar por nombre o localidad";
    search.setAttribute("aria-label", "Buscar sucursal");
    const list = document.createElement("div");
    list.className = "shipping-agency-list";
    panel.append(search, list);

    const draw = () => {
      const query = search.value.trim().toLocaleLowerCase("es-AR");
      const visible = agencies.filter((agency) =>
        [agency.name, agency.locality, agency.city]
          .some((value) => String(value || "").toLocaleLowerCase("es-AR").includes(query))
      );
      list.replaceChildren(...visible.map((agency) => agencyChoice(agency, option)));
      agencyStatus.textContent = visible.length
        ? "Elegí una sucursal para continuar."
        : "No encontramos sucursales con esa búsqueda.";
    };
    search.addEventListener("input", draw);
    draw();
  }

  function agencyChoice(agency, option) {
    const label = document.createElement("label");
    label.className = "shipping-agency";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "shippingAgency";
    input.value = agency.code;
    const content = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = agency.name;
    const address = document.createElement("small");
    address.textContent = [agency.streetName, agency.streetNumber].filter(Boolean).join(" ");
    const locality = document.createElement("small");
    locality.textContent = [agency.locality, agency.city, agency.postalCode && `CP ${agency.postalCode}`]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(" · ");
    content.append(name, address, locality);
    input.addEventListener("change", () => {
      onSelectionChange({ id: option.id, price: option.price, agencyCode: agency.code });
      statusElement.textContent = "Sucursal seleccionada.";
    });
    label.append(input, content);
    return label;
  }

  function invalidateAgencyRequest() {
    agencyRevision += 1;
    agencyController?.abort();
  }

  function invalidateSelection() {
    invalidateAgencyRequest();
    onSelectionChange(null);
  }

  function resetButton() {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Calcular envío";
  }

  function clearQuotes() {
    revision += 1;
    controller?.abort();
    invalidateSelection();
    resetButton();
    optionsElement.replaceChildren();
    statusElement.textContent = "";
  }

  return () => {
    clearQuotes();
    postalCodeInput.removeEventListener("input", clearQuotes);
    provinceInput.removeEventListener("change", clearQuotes);
    button.removeEventListener("click", quote);
  };
}

function formatPrice(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value);
}
