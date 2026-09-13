# Mercado Pago Checkout Pro + Supabase

Aplicación mínima de comercio electrónico para probar un pago de una Remera LEMONT mediante Mercado Pago Checkout Pro. El servidor registra primero un pedido pendiente en Supabase, crea la preferencia de pago y procesa el webhook de Mercado Pago. Un pedido solo pasa a `paid` después de consultar el pago en la API y confirmar que está aprobado y que el importe y la moneda coinciden.

## Tecnologías

- Node.js y CommonJS.
- Express 5.
- SDK oficial de Mercado Pago para Node.js.
- Supabase JavaScript SDK.
- HTML, CSS y JavaScript vanilla con ES modules en `public/js/`.
- `dotenv` para configuración local.
- ngrok como opción para exponer webhooks durante el desarrollo.

## Requisitos previos

- Node.js y npm compatibles con las dependencias del proyecto.
- Una cuenta y credencial de prueba de Mercado Pago.
- Un proyecto Supabase con `orders`, `order_items` y la RPC de las migraciones 001–004.
- Una URL pública HTTPS para recibir webhooks; en desarrollo puede utilizarse ngrok.

## Instalación

```powershell
npm.cmd install
```

En shells donde `npm` funcione normalmente también puede usarse `npm install`.

## Variables de entorno

Crear `.env` a partir de `.env.example`. No copiar valores reales en documentación, código, commits, capturas ni mensajes a agentes.

```env
MERCADOPAGO_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_SECRET=
BASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LOG_LEVEL=info
```

- `MERCADOPAGO_ACCESS_TOKEN`: credencial privada de Mercado Pago, exclusiva del backend.
- `MERCADO_PAGO_WEBHOOK_SECRET`: secreto privado para validar la firma del webhook, exclusivo del backend.
- `BASE_URL`: origen público HTTPS, sin la ruta `/webhook`. En desarrollo puede ser la URL temporal de ngrok.
- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: clave privilegiada, exclusiva del backend.
- `LOG_LEVEL`: nivel mínimo de logs estructurados; usar `info` por defecto.

`.env` está ignorado por Git y nunca debe compartirse. `.env.example` debe contener únicamente el contrato de nombres, sin secretos.

## Base de datos

Las migraciones `supabase/migrations/001` a `004` definen `orders`, variantes, cliente/entrega, `order_items` y la RPC `create_pending_order_with_items`. La RPC crea atómicamente una orden `pending` y sus líneas, calcula el total y genera `external_reference`; Node reutiliza esa referencia en Mercado Pago. El backend conserva la autoridad comercial. Las migraciones ya están aplicadas; no ejecutar cambios de esquema sin autorización.

## Ejecución

```powershell
npm.cmd run dev
```

La aplicación queda disponible en `http://localhost:3003`.

Para webhooks en desarrollo:

```powershell
ngrok http 3003
```

Copiar el origen HTTPS generado a `BASE_URL`, reiniciar el servidor y abrir `http://localhost:3003`.

## Deploy a staging

El primer deploy definido es staging en EasyPanel sobre el VPS existente, usando la URL HTTPS gratuita de EasyPanel, `NODE_ENV=production`, `BASE_URL` con la URL pública sin barra final, Mercado Pago sandbox y el mismo proyecto Supabase actual. Las variables se cargan solo en EasyPanel y se documentan por nombre, nunca con valores reales.

EasyPanel debe usar la opción de compilación `Dockerfile` para construir con Node.js 22. No usar Nixpacks para este deploy.

Ver [docs/SKILLS.md](docs/SKILLS.md) para los pasos operativos y checklists de staging/producción real. Ver [docs/DECISIONS.md](docs/DECISIONS.md) (DEC-016) para la decisión completa de entornos y rollback.

## Comandos útiles

```powershell
# Iniciar el servidor
npm.cmd run dev

# Inicio equivalente definido para producción
npm.cmd start

# Crear una preferencia sin usar la interfaz
$checkoutBody = @'
{
  "items": [{ "sku": "LEM-REM-001-S", "quantity": 1 }],
  "customer": { "firstName": "Ana", "lastName": "Perez", "email": "ana.cliente@example.test", "phone": "541123456789" },
  "delivery": { "province": "AR-B", "locality": "La Plata", "postalCode": "B1900ABC", "street": "Calle 12", "streetNumber": "345", "apartment": "", "notes": "" }
}
'@
$checkoutBody | curl.exe -X POST http://localhost:3003/crear-preferencia -H "Content-Type: application/json" --data-binary '@-'

# Comprobar recepción del webhook con un ID ilustrativo
curl.exe -X POST "http://localhost:3003/webhook?id=123456789&topic=payment" -H "Content-Type: application/json" -d "{\"resource\":\"123456789\",\"topic\":\"payment\"}"

# Revisar cambios locales
git status --short
git diff
```

El ID ilustrativo no representa un pago real: la consulta a Mercado Pago fallará salvo que se use un `payment_id` válido de la cuenta configurada.

El ejemplo usa datos ficticios y requiere un entorno de prueba autorizado. Sin `customer` y `delivery` válidos no se persiste el pedido, incluso en el contrato legacy.

## Flujo principal

1. Producto permite **Agregar al carrito** tras seleccionar talle. Guarda en `lemont.cart` únicamente `{ version: 1, items: [{ sku, quantity }] }`, sin PII.
2. Carrito y entrega consultan `POST /carrito/resumen`. El backend agrupa, valida y calcula importes en centavos desde el catálogo, sin persistir ni cobrar.
3. Entrega envía `POST /crear-preferencia` con `{ items, customer, delivery }`.
4. El backend crea una orden `pending` y N `order_items` mediante una RPC; luego una preferencia MP con N ítems y el único `external_reference` devuelto por la RPC.
5. El navegador redirige a Checkout Pro. El webhook valida HMAC, consulta `Payment.get` y confirma `pending → paid` contra `orders.amount` y `orders.currency` persistidos.

**Comprar ahora (D1-A)** conserva el camino temporal `entrega.html?id=…&sku=…&quantity=1` y el contrato `{ sku, quantity, customer, delivery }`, sin agregar al carrito. Ambos botones requieren talle. Mezclar `items` con `sku` o `quantity` raíz devuelve HTTP 400 `{ "error": "Carrito inválido" }`.

**D2-A:** el carrito solo se vacía por acción manual. Crear una preferencia, redirigir o visitar `/success`, `/failure` o `/pending` no lo vacía. Esos retornos no confirman el pago.

## Documentación para personas y agentes

- [AGENTS.md](AGENTS.md): reglas de trabajo para agentes de IA.
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): alcance y requisitos.
- [docs/DESIGN.md](docs/DESIGN.md): arquitectura y flujos.
- [docs/TASKS.md](docs/TASKS.md): trabajo pendiente verificable.
- [docs/PROGRESS.md](docs/PROGRESS.md): estado y bitácora.
- [docs/DECISIONS.md](docs/DECISIONS.md): decisiones técnicas.
- [docs/SKILLS.md](docs/SKILLS.md): procedimientos operativos.
- [docs/SECURITY.md](docs/SECURITY.md): controles y riesgos.

## Limitaciones actuales

Remera LEMONT tiene variantes S/M/L/XL, precio ARS 1.000 temporal y `maxQuantity: 4` transitorio: no es stock. No hay stock real, envío incluido en el total ni idempotencia durable del checkout (DEC-022 propuesta). La cotización informativa admite solo 1 SKU × quantity 1.

T-016 COMPLETADA (Pasos 1–4). `npm.cmd test`: **158/158**, 1 suite; frontend del carrito validado por QA manual, sin tests DOM a propósito.

No hay autenticación de compradores ni panel administrativo. El catálogo está definido en backend como un módulo versionado; no existe interfaz de administración de productos. El deploy productivo fue ejecutado y el flujo `pending → paid` verificado con un pago real (2026-06-26). Ver `docs/SKILLS.md` y `docs/DECISIONS.md` (DEC-016) para la estrategia de entornos y rollback.

Para el estado completo del proyecto, decisiones técnicas y próximos pasos, ver `docs/DECISIONS.md`, `docs/TASKS.md` y `docs/PROGRESS.md`.
