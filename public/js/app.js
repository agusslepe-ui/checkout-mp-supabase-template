import { productos, crearTarjetaProducto } from "./productos.js";

const page = document.body.dataset.page;
const links = [{ key: "inicio", label: "Inicio", href: "index.html" }, { key: "catalogo", label: "Catálogo", href: "catalogo.html" }, { key: "contacto", label: "Contacto", href: "contacto.html" }];
const linkMarkup = links.map(({ key, label, href }) => `<li><a href="${href}"${page === key ? ' aria-current="page"' : ""}>${label}</a></li>`).join("");

document.querySelector("[data-site-header]")?.replaceChildren(createFragment(`<header class="site-header"><div class="site-header__inner shell"><a class="brand" href="index.html" aria-label="LEMONT, inicio"><span class="brand-mark" aria-hidden="true"></span>LEMONT</a><nav class="site-nav" id="site-nav" aria-label="Navegación principal"><ul>${linkMarkup}</ul></nav><span class="header-action" aria-hidden="true">L</span><button class="menu-button" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="Abrir menú"><span></span></button></div></header>`));

document.querySelectorAll("[data-values-strip]").forEach((node) => node.replaceChildren(createFragment(`<aside class="values-strip" aria-label="Valores de LEMONT"><ul class="shell"><li>Diseño atemporal</li><li>Materiales nobles</li><li>Series pequeñas</li><li>Hecho con intención</li><li>Buenos Aires</li></ul></aside>`)));
document.querySelector("[data-site-footer]")?.replaceChildren(createFragment(`<footer class="site-footer"><div class="shell"><div class="site-footer__top"><div><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"></span>LEMONT</a><p>Diseño honesto, prendas esenciales y una identidad que perdura.</p></div><div><h2>Explorar</h2><ul class="footer-nav">${linkMarkup}</ul></div><div><h2>Seguinos</h2><ul class="footer-nav"><li><a href="#" aria-label="Instagram de LEMONT, pendiente de vincular">Instagram</a></li><li><a href="#" aria-label="Pinterest de LEMONT, pendiente de vincular">Pinterest</a></li></ul></div></div><div class="site-footer__bottom"><span>© ${new Date().getFullYear()} LEMONT</span><span>Sitio en etapa de desarrollo</span></div></div></footer>`));

const menuButton = document.querySelector(".menu-button");
const menu = document.querySelector(".site-nav");
menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open)); menuButton.setAttribute("aria-label", open ? "Abrir menú" : "Cerrar menú");
  menu?.classList.toggle("is-open", !open); document.body.classList.toggle("menu-open", !open);
});
menu?.addEventListener("click", (event) => { if (event.target.closest("a")) { menuButton?.setAttribute("aria-expanded", "false"); menu.classList.remove("is-open"); document.body.classList.remove("menu-open"); } });

const featured = document.querySelector("[data-featured-products]");
productos.filter(({ destacado }) => destacado).forEach((producto) => featured?.append(crearTarjetaProducto(producto)));

function createFragment(markup) { const template = document.createElement("template"); template.innerHTML = markup.trim(); return template.content; }
