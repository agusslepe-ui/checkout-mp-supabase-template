// Imágenes provistas por la referencia visual de Stitch. Deben reemplazarse por
// archivos locales optimizados en public/assets/images antes del lanzamiento.
export const productos = [
  {
    id: "remera-lemont",
    nombre: "Remera LEMONT",
    categoria: "Remeras",
    precio: 1000,
    descripcion: "Una pieza esencial de líneas limpias, pensada para acompañar el uso cotidiano y sostener una identidad simple.",
    material: "La composición y ficha técnica definitiva se encuentran pendientes de confirmación.",
    cuidados: [
      "Seguir las indicaciones de la etiqueta interior.",
      "Las instrucciones específicas se incorporarán con la ficha técnica definitiva.",
    ],
    guiaTalles: "Las medidas específicas de cada talle se publicarán cuando la ficha técnica esté confirmada.",
    variantes: [
      { talle: "S", sku: "LEM-REM-001-S" },
      { talle: "M", sku: "LEM-REM-001-M" },
      { talle: "L", sku: "LEM-REM-001-L" },
      { talle: "XL", sku: "LEM-REM-001-XL" },
    ],
    imagenes: [
      {
        src: "https://lh3.googleusercontent.com/aida-public/AB6AXuDHCxf1h4YvNcj68nqIv9JMGZvUvMFj8ltfr0Fiu46C9fyKEPBJg90CrGO-R9JNEeoVYxI2JDSB6XqXrn3QZesq7jxRygPBBzlFmom3Fjpf1fHNQ1ah4xlMXmacRuhTlKiJPeS0Ju-ZVK_aSXfR8LloTzVcU8jhhxul2oajp7JSmtzw2ldOciQjVx8xg-pnG_n8ie2fzcj1NJVkDw-cmG2BVrWnW3vhuh27vM2P21nkk7sn5hQQW0zM7A",
        alt: "Remera LEMONT",
      },
    ],
    detalle: "producto.html?id=remera-lemont",
    destacado: true,
  },
  { id: "buzo-minimal", nombre: "Buzo Minimal", categoria: "Buzos", precio: 24000, destacado: true, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuAcijaNykbF3PlxAuMvq2KRw68L4FrH2I0DnQYQn_cngdCPqYwRW8pgT6F0-IgcbUbhX4Lzy8F1q01Yp9GaRM8Sa7FrWb4vTc9qmyIaGEGPxWwrBA2DozkPgz4ieoiicUbjl-sbBDGXqf35RdTxLYWZW8CAvOV_8Y5chIRWxqmnY0yyD0vyU8SPvqbYjk4OAMuOske43TIdrhdoUQwLiKDR-IxeKOzJ1cPtgaD0Cnsd6nXkghvp_7CPDw" },
  { id: "pantalon-classic", nombre: "Pantalón Classic", categoria: "Pantalones", precio: 30000, destacado: true, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuDMfCkHgf3otWUExPnXGTqXE862S3mvuhzOdZB0g8IfACItM8bGHYrgrnOOrdjoC-SNyJOPSdqYdHqx__tkPxguIVUfzg4RjB7mHcRkeLvIinl0Q-K-STuqpLqEhilo2AZx2uoAtv3HtL2xHtGWrZzTwd7ORGVSecCLvpFVqFWl0yeDaWQ0raJWeaUb2sXkZMUII-f8-pHTj0k_nYVrKyfYfgdsKbw4nqzlzPvSFkr7WXAx0sxW03OLXw" },
  { id: "gorra-origen", nombre: "Gorra Origen", categoria: "Accesorios", precio: 18000, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuD25_N8Ui-PseNdPncNvs8H-QUKuvIWOd8KTqhG-Q_hPxshfrRBKGRGcCuZfkOb8fJozca8p4IfOxutYCxDuoDWnqU7zKqc2p5YTFBipvz2KpUtlzFx5iy0KKZlDAU2-QDWuDZobEwG54j4ZRJvaNs_R1tLVFm96TsXu8ZCHmuWWJF-FTzEHyP5afuBAzy57KKiWuVsXTwRfk_cLoe6DlZf2Ru0mwHs3kUaU6t5ptT8NJV7mari-hZsyA" },
  { id: "buzo-structure", nombre: "Buzo Structure", categoria: "Buzos", precio: 55000, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuCRb8oAhUDesQVcqTTR-IYu9zagyVBJbFrTz5mMJgESnHjPGgbgsE4--nCX8vnAbQPArtwf5tcHYCFZ5NXke2DWj34pylJnvn3XdvML5QzQsF0nGKlIDPJjKouzZko3J9Lp7nkb-3z0wKw9ApS0bppk1d5Kpj49rzE2AvV5pTjaLVe56O3c4S-Rv6RLSVyywvQSbKL0ACIltcLa3xEoNjiXopTPY4hmMfH8y3lJpvu49hAWHHgNg5Z5fQ" },
  { id: "tote-canvas", nombre: "Tote Canvas", categoria: "Accesorios", precio: 9500, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuBXPbFDcLusSpoBA_qHz-d9qF_U9XB-u7frdsBgyHsYGqpoN0X9Hw_2uJkn6AVHq0EkKymlH95TPyYSGllHkjdO_OMz-lZ1hWRxU2Qb_crtg3Z3_H37fHeHyOfBGZLFE3w5mOjTGIwked17gIypyt4TkIJNG4PaQSoIRlNTMR9fEchQLpZXHIjVijJcE3pYUoXxEFyxOX-YQooi5g1ryNhijvLfRVQdTgdawo0gKNdSD-4290awbnrh3g" },
  { id: "pantalon-relaxed", nombre: "Pantalón Relaxed", categoria: "Pantalones", precio: 38000, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuDFK4LMr5SQgMVJmIfeJRW4xXATEbskEI08OfSDGa_cYywRbOo2u2Q6kYmhSiybcGCZv5-F_LmRcUrteAI4j8LflRYSWYqotBzKMQghcVpcX_AZtW4iT0x6M_sFOOu9G9ffjpSzIiqnNZiQxe1y2tNTIjozrDYMMzPl6VTBtPKgZzeCPNE9Y5oMHX9pdp-XPVk1mYLmEbuZ9xfgbv_Zpa35W3jPnKbnsTp0y6H-K_B4C2aA_Yy_njDoIQ" },
  { id: "remera-heavyweight", nombre: "Remera Heavyweight", categoria: "Remeras", precio: 15000, imagen: "https://lh3.googleusercontent.com/aida-public/AB6AXuDQZv0EK4iaaP-o5H1YTKIPOjfUpAyBcF9B01HwLkx8G9njF398Jna75xmyDdnSRMHj-ct9-Dd_YeIjU1EEDJV9MR0C1tMiF7Ayc6EgOZjmSLKLyMaABXfdLQP2ahAoGFnmcbVtvw4A-03UD32nUqSpNGNecL0dFxQ7RZPDfr5m9Zoh98yxOjNT08B-NgjpRVkIxx9F4_bNgzM4WGQkSmMtoAd_iENw6muZaKpPwKSVKcs7lST5BAsJ5A" }
];

const moneda = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const formatearPrecio = (precio) => moneda.format(precio);

export function crearTarjetaProducto(producto) {
  const article = document.createElement("article");
  article.className = "product-card";
  const imagenPrincipal = producto.imagenes?.[0] || {
    src: producto.imagen,
    alt: producto.nombre,
  };
  const productAction = producto.detalle
    ? `<a class="product-card__detail" href="${producto.detalle}">Ver producto</a>`
    : `<span class="product-card__unavailable">Próximamente</span>`;

  article.innerHTML = `
    <div class="product-card__image">
      <img src="${imagenPrincipal.src}" alt="${imagenPrincipal.alt}" loading="lazy">
    </div>
    <div class="product-card__meta">
      <div>
        <span class="product-card__category">${producto.categoria}</span>
        <h3>${producto.nombre}</h3>
      </div>
      <span class="product-card__price">${formatearPrecio(producto.precio)}</span>
    </div>
    <div class="product-card__actions">
      ${productAction}
    </div>`;
  return article;
}
