import { productos, formatearPrecio } from "./productos.js";

const detailRoot = document.querySelector("[data-product-detail]");
const productId = new URLSearchParams(window.location.search).get("id");
const producto = productos.find(
  ({ id, detalle }) => id === productId && Boolean(detalle)
);

if (!producto) {
  renderNotFound();
} else {
  renderProduct(producto);
}

function renderProduct(product) {
  const images = product.imagenes || [];
  const mainImage = images[0];
  const sizeOptions = product.variantes
    .map(({ talle, sku }) => `<option value="${sku}">${talle}</option>`)
    .join("");
  const thumbnails = images
    .map(
      ({ src, alt }, index) => `
        <button class="product-gallery__thumbnail" type="button" data-gallery-image="${index}" aria-label="Ver imagen ${index + 1} de ${product.nombre}" aria-current="${index === 0}">
          <img src="${src}" alt="" loading="lazy">
        </button>`
    )
    .join("");
  const careItems = product.cuidados
    .map((care) => `<li>${care}</li>`)
    .join("");

  document.title = `${product.nombre} — LEMONT`;
  detailRoot.innerHTML = `
    <a class="product-page__back" href="catalogo.html"><span aria-hidden="true">←</span> Volver al catálogo</a>
    <article class="product-detail">
      <div class="product-gallery">
        <div class="product-gallery__main">
          <img src="${mainImage.src}" alt="${mainImage.alt}" data-gallery-main>
        </div>
        <div class="product-gallery__thumbnails" aria-label="Galería de ${product.nombre}">
          ${thumbnails}
        </div>
      </div>

      <div class="product-detail__info">
        <p class="eyebrow eyebrow--accent">${product.categoria}</p>
        <h1>${product.nombre}</h1>
        <p class="product-detail__price">${formatearPrecio(product.precio)}</p>
        <p class="product-detail__price-note">Precio informativo. El backend determina el importe final.</p>
        <p class="product-detail__description">${product.descripcion}</p>

        <div class="product-detail__fact">
          <h2>Material</h2>
          <p>${product.material}</p>
        </div>

        <div class="product-detail__purchase" data-checkout-scope>
          <label class="product-card__size" for="product-size">
            Talle
            <select id="product-size" data-size-select>
              <option value="">Elegí un talle</option>
              ${sizeOptions}
            </select>
          </label>
          <button class="product-card__buy" type="button" data-checkout-button disabled>Comprar</button>
          <p class="product-card__status" data-checkout-status aria-live="polite"></p>
        </div>

        <details class="product-detail__details">
          <summary>Guía de talles</summary>
          <p>${product.guiaTalles}</p>
        </details>

        <details class="product-detail__details">
          <summary>Cuidados</summary>
          <ul>${careItems}</ul>
        </details>
      </div>
    </article>`;

  detailRoot.addEventListener("click", handleGalleryClick);
}

function handleGalleryClick(event) {
  const thumbnail = event.target.closest("button[data-gallery-image]");

  if (!thumbnail) return;

  const image = producto.imagenes[Number(thumbnail.dataset.galleryImage)];
  const mainImage = detailRoot.querySelector("[data-gallery-main]");

  mainImage.src = image.src;
  mainImage.alt = image.alt;
  detailRoot.querySelectorAll("[data-gallery-image]").forEach((button) => {
    button.setAttribute("aria-current", String(button === thumbnail));
  });
}

function renderNotFound() {
  document.title = "Producto no disponible — LEMONT";
  detailRoot.innerHTML = `
    <section class="product-not-found" aria-labelledby="not-found-title">
      <p class="eyebrow eyebrow--accent">Catálogo</p>
      <h1 id="not-found-title">Producto no disponible</h1>
      <p>No encontramos el producto solicitado.</p>
      <a class="button button--accent" href="catalogo.html">Volver al catálogo</a>
    </section>`;
}
