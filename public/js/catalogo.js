import { productos, crearTarjetaProducto } from "./productos.js";

const productGrid = document.querySelector("[data-catalog-products]");
const filterContainer = document.querySelector("[data-catalog-filters]");
const count = document.querySelector("[data-catalog-count]");
const empty = document.querySelector("[data-catalog-empty]");
const categories = ["Todos", ...new Set(productos.map(({ categoria }) => categoria))];

categories.forEach((category) => {
  const button = document.createElement("button");
  button.type = "button"; button.className = "filter-button"; button.textContent = category;
  button.dataset.category = category; button.setAttribute("aria-pressed", String(category === "Todos"));
  filterContainer?.append(button);
});

function renderProducts(category = "Todos") {
  const filtered = category === "Todos" ? productos : productos.filter((product) => product.categoria === category);
  productGrid?.replaceChildren(...filtered.map(crearTarjetaProducto));
  if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? "pieza" : "piezas"}`;
  if (empty) empty.hidden = filtered.length !== 0;
}

filterContainer?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]"); if (!button) return;
  filterContainer.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  renderProducts(button.dataset.category);
});
renderProducts();
