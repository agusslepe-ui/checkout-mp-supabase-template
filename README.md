# Mercado Pago Checkout Pro + Supabase

## T-021 — selección de sucursal IMPLEMENTADA LOCALMENTE / PENDIENTE DE AUDITORÍA

`POST /sucursales-envio` recibe `{ province: "AR-J" }`; el backend traduce la provincia, consulta MiCorreo `GET /agencies` y devuelve solo sucursales ACTIVE normalizadas. Checkout AGENCY exige `shippingAgencyCode`, vuelve a validar rate y sucursal, y prepara un snapshot autoritativo. HOME sigue sin consultar ni persistir agencia.

La migración `006_add_order_shipping_agency.sql` fue creada pero **NO aplicada**. Suite local: **276/276**. DEC-026 continúa PROPUESTA y T-021 no está COMPLETADA. Sin `/shipping/import`; perfiles TEMPORAL/QA y tienda no lista para público.

## T-020 — IMPLEMENTADA Y DESPLEGADA / PAID QA PENDIENTE SEPARADO

`POST /crear-preferencia` exige `shippingOptionId`, vuelve a cotizar MiCorreo y cobra el precio actual. HOME Classic/Express está desplegado; `/rates`, subtotal, shipping, total e ítem `Envío` fueron confirmados en QA operativo. El paid QA completo de T-020 sigue siendo una tarea separada.

La migración 005 forma parte del despliegue T-020 informado por el usuario. Su cierre documental y paid QA no se mezclan con T-021. Los perfiles 300 g / 5 × 25 × 35 cm continúan TEMPORAL/QA.

## T-019 — cotización multítem COMPLETADA (DEC-024 ACEPTADA)

`POST /cotizar-envio` acepta items[] o legacy sku+quantity (sin mezcla), hasta **4 unidades totales**. Perfiles editables en `src/packageProfiles.js`: **TEMPORAL/QA**, todos 300 g / 5 × 25 × 35 cm; **no** están aprobados como packaging de producción. Origen: **CP 5465 — Rodeo, San Juan**, mediante `SHIPPING_ORIGIN_POSTAL_CODE`.

En ese cierre histórico, el frontend mostraba domicilio/sucursal y Clásico/Express solo según respuesta de MiCorreo, sin elegir agencia, y el envío permanecía fuera del pago. La suite era **211/211**. `POST /rates` PROD: `micorreo_rates_ok options=4` (destino QA 5400). Sin `/shipping/import`.

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
- Un proyecto Supabase con `orders`, `order_items` y las migraciones 001–005 aplicadas. La 006 debe aplicarse de forma controlada después de la auditoría de T-021.
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

Las migraciones `supabase/migrations/001` a `005` están aplicadas según el handoff de T-021: definen `orders`, variantes, cliente/entrega, `order_items` y el snapshot de shipping HOME. La migración 006 agrega el snapshot de agencia y reemplaza la firma de `create_pending_order_with_items`; está creada localmente y **no fue aplicada**. La RPC crea atómicamente una orden `pending` y sus líneas, valida subtotal + envío = total y genera `external_reference`; Node reutiliza esa referencia en Mercado Pago. No ejecutar cambios de esquema sin autorización.

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
  "delivery": { "province": "AR-B", "locality": "La Plata", "postalCode": "B1900ABC", "street": "Calle 12", "streetNumber": "345", "apartment": "", "notes": "" },
  "shippingOptionId": "micorreo:home:classic"
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
3. Entrega cotiza, exige una opción home y envía `POST /crear-preferencia` con `{ items, customer, delivery, shippingOptionId }`.
4. El backend recotiza, crea una orden `pending` con N `order_items` y shipping snapshot mediante una RPC; luego una preferencia MP con N productos + ítem `Envío` y el único `external_reference` devuelto por la RPC.
5. El navegador redirige a Checkout Pro. El webhook valida HMAC, consulta `Payment.get` y confirma `pending → paid` contra `orders.amount` y `orders.currency` persistidos.

**Comprar ahora (D1-A)** conserva el camino temporal `entrega.html?id=…&sku=…&quantity=1` y el contrato `{ sku, quantity, customer, delivery, shippingOptionId }`, sin agregar al carrito. Ambos botones requieren talle y una opción home cobrable. Mezclar `items` con `sku` o `quantity` raíz devuelve HTTP 400 `{ "error": "Carrito inválido" }`.

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

Remera LEMONT tiene variantes S/M/L/XL, precio ARS 1.000 temporal y `maxQuantity: 4` transitorio: no es stock. T-020/HOME está desplegada según el handoff; T-021/AGENCY está implementada solo localmente y la migración 006 no fue aplicada. Faltan auditoría, aplicación controlada y QA. No hay stock real ni idempotencia durable del checkout (DEC-022 propuesta).

T-016 COMPLETADA (Pasos 1–4). `npm.cmd test`: **158/158**, 1 suite; frontend del carrito validado por QA manual, sin tests DOM a propósito.

No hay autenticación de compradores ni panel administrativo. El catálogo está definido en backend como un módulo versionado; no existe interfaz de administración de productos. El deploy productivo histórico fue verificado con un pago real (2026-06-26), pero T-020 no fue desplegada ni probada contra servicios reales. Ver `docs/SKILLS.md` y `docs/DECISIONS.md` (DEC-016) para la estrategia de entornos y rollback.

Para el estado completo del proyecto, decisiones técnicas y próximos pasos, ver `docs/DECISIONS.md`, `docs/TASKS.md` y `docs/PROGRESS.md`.
