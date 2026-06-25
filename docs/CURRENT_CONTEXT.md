# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-06-24.
> Si el chat fue compactado, este archivo es el punto de entrada.

---

## Metodología de trabajo

| Rol | Responsabilidad |
|---|---|
| **Claude Code** | Documenta, organiza contexto y prepara tareas para Codex. No modifica código salvo autorización explícita. |
| **Codex** | Implementa cambios de código según las tareas en `docs/TASKS.md`. |
| **Usuario** | Aprueba decisiones técnicas y cambios antes de que se apliquen. |
| **GitHub** | Fuente de verdad del código. |
| **Markdown** | Memoria estable del proyecto. |

---

## Estado de tareas

### Completadas (P0 — Seguridad e integridad)

| Tarea | Descripción |
|---|---|
| T-001 | Validación de firma webhook HMAC-SHA256 con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 para firma ausente o inválida. (DEC-009) |
| T-002 | Creación de preferencia detenida si Supabase falla al insertar el pedido. |
| T-003 | Transición `pending → paid` atómica e idempotente con `UPDATE WHERE status = 'pending'`. (DEC-010) |
| T-004 | Validación de las cuatro variables de entorno obligatorias antes de aceptar tráfico. |

### Completadas (P1 — Calidad)

| Tarea | Descripción |
|---|---|
| T-005 | Suite Jest con 11 tests; `npm test` pasa. Cubre todos los flujos críticos sin llamadas externas. |

### Próxima (desbloqueada)

| Tarea | Descripción | Bloqueador |
|---|---|---|
| T-006 | Crear `supabase/migrations/001_create_orders.sql` con DDL, restricciones, índices y RLS. | Ninguno — DEC-012 aceptada. |

### Pendientes con bloqueo

| Tarea | Descripción | Bloqueador |
|---|---|---|
| T-007 | Estrategia monetaria segura (comparación sin `Number`). | DEC-011 pendiente. |
| T-008 | Identificadores de pedidos únicos bajo concurrencia. | Sin bloqueo, bajo riesgo. |
| T-009 | Separar responsabilidades de `index.js` en módulos. | Sin bloqueo; conviene después de T-005. |
| T-010 | Logs estructurados y sin datos sensibles. | DEC-017 pendiente. |
| T-011 | Retirar herramientas de diagnóstico de producción (`GET /webhook`). | Sin bloqueo. |
| T-012 | Fuente autoritativa de catálogo y precios. | DEC-013 pendiente. |
| T-013 | Documentar y validar deploy. | DEC-016 pendiente. |
| T-014 | Corregir codificación UTF-8 en mensajes de error. | Sin bloqueo. |

---

## Decisiones técnicas aceptadas

| Decisión | Resumen |
|---|---|
| DEC-009 | Validar firma webhook con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 + mensaje genérico para firma ausente o inválida. Sin exponer secretos en logs. |
| DEC-010 | Transición `pending → paid` con `UPDATE WHERE status = 'pending'`. Cero filas afectadas = duplicado idempotente. Sin dependencias adicionales. |
| DEC-012 | SQL manual versionado en `supabase/migrations/`. Sin Supabase CLI. El usuario aplica el archivo manualmente. |

## Decisiones pendientes relevantes

| Decisión | Tarea relacionada |
|---|---|
| DEC-011 | T-007 (importes sin punto flotante) |
| DEC-013 | T-012 (catálogo y precios) |
| DEC-016 | T-013 (deploy y entornos) |
| DEC-017 | T-010 (logs estructurados) |

---

## Estado técnico actual

- **Backend**: Node.js + CommonJS + Express 5.
- **Pagos**: Mercado Pago Checkout Pro (SDK oficial).
- **Base de datos**: Supabase, tabla `orders`, acceso con `service_role` solo desde backend.
- **Tests**: Jest instalado. `npm test` pasa con 11 tests. Archivo: `tests/index.test.js`.
- **Versionado**: Git + GitHub. No hay deploy documentado.
- **Sin implementar todavía**: RLS de Supabase, migración SQL, estrategia monetaria, catálogo, autenticación, logs estructurados, deploy.

---

## Próximo paso inmediato

**Codex debe implementar T-006.**

Instrucciones clave:
1. Crear `supabase/migrations/001_create_orders.sql`.
2. Extraer el DDL de `README.md` (tabla `orders`).
3. Agregar `CHECK (status IN ('pending', 'paid'))`.
4. Agregar `CHECK (amount > 0)`.
5. Agregar índice en `status`.
6. Agregar índice en `mercadopago_payment_id`.
7. Agregar `ALTER TABLE orders ENABLE ROW LEVEL SECURITY` + policy para `service_role`.
8. **No aplicar el SQL en ninguna base de datos.**
9. **No incluir secretos, credenciales ni datos reales.**
10. **No leer `.env`.**

Referencia completa: `docs/TASKS.md` (T-006) y `docs/DECISIONS.md` (DEC-012).

---

## Archivos de referencia rápida

| Archivo | Propósito |
|---|---|
| `docs/CURRENT_CONTEXT.md` | Este archivo — resumen compacto para agentes |
| `docs/TASKS.md` | Detalle de todas las tareas con criterios de aceptación |
| `docs/DECISIONS.md` | Decisiones técnicas tomadas y pendientes |
| `docs/PROGRESS.md` | Bitácora y estado histórico |
| `docs/DESIGN.md` | Arquitectura y flujos |
| `docs/SECURITY.md` | Controles y riesgos |
| `AGENTS.md` | Reglas de trabajo para agentes |
| `CLAUDE.md` | Rol y restricciones de Claude Code |
