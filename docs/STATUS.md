# Estado vigente del proyecto

**Última actualización:** 2026-09-16

Este archivo es la referencia rápida del estado actual. Los bloques históricos en `TASKS.md`, `PROGRESS.md` o `DECISIONS.md` que describan T-021 como local, pendiente de auditoría o con la migración 006 sin aplicar deben leerse como antecedentes previos al cierre del 2026-09-16.

## Completado y validado

- **T-021 — Selección real de sucursal MiCorreo: COMPLETADA.**
- **DEC-026 — Selección autoritativa de agencia: ACEPTADA.**
- Auditoría previa: APROBADA CON OBSERVACIONES, sin bloqueadores de implementación.
- Suite local: **276/276 tests**, 4 suites.
- `supabase/migrations/006_add_order_shipping_agency.sql`: **APLICADA EN PRODUCCIÓN**.
- Runtime T-021: **DESPLEGADO EN EASYPANEL**.
- RPC `create_pending_order_with_items`: **26 parámetros**.
- Seis columnas `shipping_agency_*`: presentes, `text`, nullable.
- Permisos de la RPC verificados: `EXECUTE` solo para `postgres` y `service_role`; no `anon`, `authenticated` ni `PUBLIC`.
- QA HOME real hasta Mercado Pago: orden `pending`, subtotal + shipping = total y snapshot de agencia en null.
- QA AGENCY real hasta Mercado Pago: `GET /agencies` real de MiCorreo confirmado, sucursal seleccionada y revalidada por backend, snapshot autoritativo persistido.

El detalle del cierre está en `docs/T021_DEC026_CLOSURE_2026-09-16.md`.

## Estado de T-020

- **T-020 está implementada y desplegada.**
- La migración 005 está aplicada.
- El costo de envío se recotiza en backend y se incluye en `orders.amount` y en Mercado Pago.
- El **paid QA completo de T-020 sigue pendiente como tarea separada**.
- **DEC-025 no se considera aceptada automáticamente por el cierre de T-021.**

## Pendientes principales

- T-017 / DEC-022: idempotencia durable del checkout.
- Etapa D: crear el envío post-pago con MiCorreo `/shipping/import`; no implementada todavía.
- Tracking/etiquetas: no implementados; el PDF oficial disponible no documenta esos endpoints.
- Stock real por SKU; `maxQuantity: 4` sigue siendo un límite temporal y no inventario.
- Sustituir perfiles TEMPORAL/QA de `300 g / 5 × 25 × 35 cm` por peso y dimensiones reales del paquete para 1–4 unidades y repetir cotizaciones.
- Restaurar precio comercial definitivo; ARS 1.000 sigue siendo precio de prueba.
- Rotar credenciales privadas previamente expuestas antes del lanzamiento público.
- Auditar vulnerabilidades npm registradas en tareas anteriores.

## Regla de alcance

No declarar la tienda lista para lanzamiento comercial mientras sigan pendientes las medidas reales, la rotación de credenciales, el precio comercial y los controles operativos acordados.

GitHub sigue siendo la fuente de verdad del código. El cierre T-021/DEC-026 de 2026-09-16 prevalece sobre referencias históricas anteriores.