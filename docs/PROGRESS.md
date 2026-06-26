# Progreso

Última revisión documental: 2026-06-26.

## Estado actual

El proyecto tiene un flujo completo de pago implementado y cubierto con tests. Las tareas P0 de seguridad (T-001 a T-004), la suite de pruebas automatizadas (T-005), la migración SQL versionada (T-006), la estrategia monetaria explícita (T-007), los identificadores robustos de pedidos (T-008), el refactor modular del backend (T-009), la observabilidad segura (T-010), la restricción de `GET /webhook` fuera de producción (T-011), el catálogo seguro del servidor (T-012), la documentación de deploy a staging (T-013) y la corrección UTF-8 del error HTTP 400 por JSON inválido (T-014) están completadas. La migración fue aplicada y verificada manualmente en Supabase el 2026-06-25.

- **Backend**: Node.js + CommonJS + Express 5. Mercado Pago Checkout Pro. Supabase con `service_role`.
- **Tests**: Jest instalado. `npm test` pasa con 29 tests.
- **Seguridad implementada**: validación de firma webhook (DEC-009), transición atómica (DEC-010), validación de variables al iniciar.
- **Migración SQL**: `supabase/migrations/001_create_orders.sql` aplicada. Tabla `public.orders` verificada con columnas, constraints, índices y RLS activa.
- **Pendiente más urgente**: soporte/consulta técnica de Mercado Pago confirmó que los pagos de prueba con credenciales de prueba no envían notificaciones reales. El 401 en staging vía `notification_url` con credenciales sandbox puede ser comportamiento esperado, no un bug del código. Se identifican dos puntos técnicos a verificar en la implementación HMAC antes de cualquier prueba productiva: (a) `data.id` debe provenir de query params (denominado `data.id_url` en la documentación oficial); (b) si falta algún valor del template del manifiesto, debe excluirse antes del cálculo HMAC, no incluirse como cadena vacía. Credenciales de prueba expuestas en sesión anterior: deben rotarse. Ver DEC-018.
- **Deploy activo**: dominio propio `checkout.lemont01.com` con SSL en EasyPanel. `POST /crear-preferencia` y persistencia Supabase funcionan en staging.

Ver resumen compacto para agentes en `docs/CURRENT_CONTEXT.md`.

## Avances detectados

**Base original:**
- Servidor Express y frontend estático implementados.
- Pedido `pending` asociado mediante `external_reference`.
- Preferencia con webhook y tres URLs de retorno.
- Confirmación del pago mediante consulta a la API oficial.
- Validación básica de pedido existente, duplicado e importe.
- `.env` ignorado y `.env.example` disponible como contrato.

**Implementado en sesión 2026-06-24:**
- T-001: validación HMAC-SHA256 de firma webhook con HTTP 401 para firma ausente o inválida.
- T-002: creación de preferencia detenida si Supabase falla.
- T-003: transición `pending → paid` atómica e idempotente.
- T-004: validación de variables de entorno obligatorias al arrancar.
- T-005: suite Jest con 11 tests; `npm test` pasa sin llamadas externas.
- T-006: migración SQL manual versionada para `orders`, con restricciones, índices y RLS habilitada.

**Implementado en sesión 2026-06-25:**
- T-007: estrategia monetaria explícita con comparación normalizada a centavos, validación de moneda y logs genéricos del webhook de pago.
- T-008: referencias de pedido generadas con `crypto.randomUUID()` y prefijo `LEMONT-ORDER-`.
- T-009: backend separado en `src/app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js` y `webhookSignature.js`.
- T-010: logs estructurados JSON con `request_id`, niveles `info`/`warn`/`error`, whitelist de campos y ausencia de payloads sensibles.
- T-011: `GET /webhook` disponible solo con `NODE_ENV !== "production"`; `POST /webhook` se conserva.
- T-012: catálogo seguro en `src/catalog.js`; el backend calcula precio, total y moneda desde SKU y cantidad. (DEC-013)
- T-014: respuesta HTTP 400 por JSON inválido con `Content-Type: application/json; charset=utf-8`.
- Documentación completa: TASKS.md (T-001 a T-014), DECISIONS.md (DEC-009 a DEC-017), CURRENT_CONTEXT.md.

**Implementado en sesión 2026-06-26:**
- T-013: documentación de deploy a staging en EasyPanel con variables por nombre, pasos operativos, checklist de staging (11 ítems), checklist previa a producción real (11 ítems), rollback en 4 niveles y notas de seguridad. (DEC-016)
- Fix operativo de staging: `Dockerfile` con Node.js 22 y `.dockerignore` para excluir `.env`, `.env.*`, `.git`, `node_modules`, logs y temporales. EasyPanel configurado para compilación `Dockerfile` (no Nixpacks).
- Staging activo: Node.js 18 (Nixpacks) reemplazado por `node:22-alpine`; puerto interno corregido a 3003; `SUPABASE_URL` corregida a URL base sin `/rest/v1` ni trailing slash; clave Supabase cambiada a `service_role` JWT.
- Webhook secret verificado: SHA-256 prefix coincide entre EasyPanel y Mercado Pago sandbox. `data.id` lowercase eliminado; el manifiesto HMAC usa valor literal.
- Diagnóstico HMAC: 4 variantes candidatas (`query_literal`, `body_literal`, `query_lower`, `body_lower`) calculadas y logueadas; todas retornan `false` en staging.
- Fingerprints de componentes individuales del manifiesto preparados para próximo deploy (SHA-256 8-char prefix de `queryDataId`, `bodyDataId`, `x-request-id`, `ts`; variantes de formato con y sin `;` final, con y sin `request_id`).
- Diagnóstico de headers proxy: presencia, longitud y SHA-256 prefix de `x-original-request-id`, `x-correlation-id`, `x-request-start`, `x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `forwarded`, `via`. Sin valores completos en logs.
- Diagnóstico de query string y manifiesto: presencia, longitud y SHA-256 prefix de query string completa y manifiesto final; detección de `x-request-id` duplicados; validez numérica y age de `ts`.
- Diagnóstico con SDK oficial `WebhookSignatureValidator` de `mercadopago` v3.1.0: `official_sdk_validator_available=true`, `official_sdk_validator_matches=false`, `official_sdk_validator_error_name="InvalidWebhookSignatureError"` en webhooks reales sandbox. Solo diagnóstico; la validación principal no cambia.
- Verificación de Traefik/EasyPanel: SHA-256 prefix del `x-request-id` enviado en request controlado coincide con el recibido en logs. Hipótesis de proxy modificando headers descartada.
- Configuración de dominio propio `checkout.lemont01.com` con SSL activo en EasyPanel. `BASE_URL` actualizado. Webhook sandbox de Mercado Pago apuntado al nuevo dominio.
- Simulación desde panel de Webhooks de Mercado Pago: firma válida. Backend entra al flujo completo (`webhook recibido`, `pago detectado en webhook`). Error al consultar pago (esperable para IDs de simulación sin pago real).
- Prueba sin `notification_url` en la preferencia: llegan eventos sin `data.id`, no útiles para confirmar pago. Restaurada `notification_url`. Tests pasan.

## Problemas resueltos documentados

- Uso de variables de entorno para credenciales.
- URL pública de desarrollo mediante ngrok.
- Separación entre páginas de retorno y confirmación autoritativa.
- Asociación de pagos y pedidos mediante referencia externa.
- Consulta a Mercado Pago en lugar de confiar únicamente en el webhook.
- Tratamiento básico de notificaciones duplicadas y montos diferentes.
- **Staging: Node.js 18 vía Nixpacks**: EasyPanel usaba Node.js 18 por defecto, causando fallos de WebSocket de Supabase. Resuelto: Dockerfile `node:22-alpine` y compilación `Dockerfile` en EasyPanel.
- **Staging: Puerto incorrecto**: el proxy interno de EasyPanel apuntaba al puerto equivocado. Resuelto: dominio configurado al puerto interno 3003.
- **Staging: `SUPABASE_URL` con path o trailing slash**: la URL incluía `/rest/v1` o barra final, causando error `PGRST125`. Resuelto: usar solo URL base (`https://xxxx.supabase.co`) sin path ni barra final.
- **Staging: Tipo de clave Supabase incorrecto**: se intentó usar la clave publishable en lugar de `service_role` JWT. Resuelto: confirmar uso de `service_role` JWT en backend.
- **Staging: `data.id` en lowercase**: el manifiesto HMAC aplicaba `.toLowerCase()` a `data.id`. Resuelto: usar el valor literal de `data.id`.

## Pendientes principales

- **Rotar credenciales de prueba expuestas** (acción inmediata): el Access Token de prueba y el Webhook Secret de prueba fueron compartidos en el chat de la sesión. Deben regenerarse en el panel de Mercado Pago y actualizarse en EasyPanel antes de continuar con cualquier prueba.
- Decidir el próximo camino técnico para el webhook — ver **DEC-018** actualizada (`docs/DECISIONS.md`). El soporte de Mercado Pago confirmó que la vía recomendada para probar notificaciones en sandbox es la simulación desde "Tus integraciones", no pagos de prueba reales. DEC-018 incluye además dos puntos técnicos a verificar en el HMAC antes de probar en producción. No tocar código hasta que DEC-018 esté aceptada.
- Retirar diagnósticos temporales en `src/webhookSignature.js`, `src/app.js` y `src/config.js` antes de avanzar a producción real.

El detalle verificable está en `docs/TASKS.md`.

## Próxima acción recomendada

**Staging activo. Soporte confirmó comportamiento sandbox. Pendiente: verificación técnica y decisión del usuario.**

Soporte/consulta de Mercado Pago confirmó que los pagos de prueba con credenciales de prueba no envían notificaciones reales con firma válida. La simulación desde "Tus integraciones" es la vía recomendada para sandbox. Se identificaron además dos puntos técnicos a verificar en la implementación HMAC.

**Paso 1 — Inmediato (antes de cualquier prueba técnica):**
Rotar el Access Token de prueba y el Webhook Secret de prueba expuestos en el chat. Actualizar `MERCADOPAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` en EasyPanel y verificar que el staging sigue funcionando.

**Paso 2 — Verificar puntos técnicos del HMAC (antes de producción):**
Revisar en `src/webhookSignature.js` si: (a) `data.id` proviene de query params (denominado `data.id_url` en documentación oficial); (b) valores faltantes del template del manifiesto se excluyen antes del HMAC en lugar de incluirse como cadena vacía. Esta verificación es necesaria antes de cualquier prueba en producción.

**Paso 3 — Confirmar DEC-018:**
Ver **DEC-018** actualizada en `docs/DECISIONS.md`. Las opciones y los nuevos puntos técnicos están documentados con sus riesgos. No modificar código hasta que DEC-018 esté aceptada.

> Codex no debe leer `.env`, exponer secretos, hacer commit ni push sin autorización explícita del usuario.

## Bitácora

### 2026-06-26 — Respuesta de soporte Mercado Pago: confirmación de comportamiento sandbox y puntos técnicos HMAC

- Objetivo: documentar la respuesta recibida de soporte/consulta técnica de Mercado Pago y actualizar el contexto técnico.
- Tipo de sesión: documental. Sin modificación de código. Sin acceso a `.env`.
- Archivos actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/DECISIONS.md`.
- Resumen de la respuesta de soporte (puntos relevantes para el proyecto):
  1. El Webhook Secret se genera al configurar Webhooks en "Tus integraciones". Es por aplicación y por modo (pruebas vs productivo).
  2. `notification_url` en la preferencia tiene prioridad sobre la URL configurada en el panel para esa transacción. No es un conflicto, pero `notification_url` manda para esa transacción específica.
  3. **Confirmado**: los pagos de prueba creados con credenciales de prueba no envían notificaciones reales. La vía recomendada para testear recepción de notificaciones en sandbox es la configuración/simulación desde "Tus integraciones".
  4. Para construir la firma HMAC, `data.id` debe tomarse desde los query params; en la documentación se denomina `data.id_url`.
  5. Si falta algún valor del template del manifiesto, debe excluirse antes del cálculo HMAC. No incluirlo como cadena vacía.
  6. Verificar que el secret corresponda al mismo modo utilizado: pruebas o productivo.
  7. No se debe desactivar la validación de firma.
- Conclusión técnica actualizada:
  - El 401 en staging vía `notification_url` con credenciales de prueba puede ser comportamiento esperado del sandbox de Mercado Pago, no un bug de implementación HMAC.
  - La simulación del panel validando correctamente es consistente con lo confirmado por soporte.
  - Se identifican dos puntos técnicos a verificar en `src/webhookSignature.js` antes de cualquier prueba productiva:
    - (a) ¿`data.id` se lee de query params y se denomina `data.id_url` en el template? Nuestros logs indican `signature_data_source="query_data_id"` pero el nombre de variable en el template puede diferir.
    - (b) ¿Los valores faltantes del template se excluyen antes del HMAC o se incluyen como cadena vacía?
  - Estos dos puntos podrían explicar diferencias en el manifiesto si algún campo llega ausente en webhooks reales.
- Estado técnico al cerrar:
  - `notification_url` restaurado.
  - Validación de firma activa. Webhooks inválidos responden 401.
  - SDK oficial solo como diagnóstico; no como fuente de aceptación.
  - DEC-018 actualizada con el nuevo contexto.
- Sin cambios de código. Sin commit. Sin push. Sin acceso a `.env`. Sin secretos en documentación.

### 2026-06-26 — Investigación externa: diferencia entre simulación del panel y notification_url de Checkout Pro

- Objetivo: documentar los hallazgos de una investigación externa sobre el webhook 401 y registrar el nuevo criterio técnico de seguridad de diagnóstico.
- Tipo de sesión: documental. Sin modificación de código. Sin acceso a `.env`.
- Archivos de documentación actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`.
- Hechos confirmados del proyecto (no inferidos):
  - El endpoint `POST /webhook` es accesible desde Mercado Pago.
  - El secreto funciona para la simulación del panel (firma válida).
  - El SDK oficial (`WebhookSignatureValidator`) también rechaza firmas reales sandbox.
  - `notification_url` trae `data.id` en webhooks reales sandbox.
  - Sin `notification_url`, no llegan webhooks útiles con `data.id`.
  - Traefik/EasyPanel preserva `x-request-id` en requests externos controlados.
- Hallazgos externos registrados (no todos confirmados por documentación oficial):
  1. Mercado Pago recomienda usar el simulador del panel para testear recepción de notificaciones en sandbox. Los pagos de prueba con credenciales de prueba pueden no generar notificaciones del mismo modo que producción. (Referencia: documentación oficial.)
  2. Mercado Pago distingue entre Webhooks (usan firma/secreto HMAC) e IPN/mecanismos legacy (comportamiento diferente). (Referencia: documentación oficial.)
  3. Existe diferencia entre webhooks configurados desde "Your integrations" en el panel y `notification_url` definido directamente en la preferencia de Checkout Pro. (Referencia: documentación oficial, comportamiento observado.)
  4. La simulación del panel validando correctamente indica: endpoint accesible, secreto válido para el panel, implementación HMAC no rota de forma evidente. (Conclusión propia a partir de observación.)
  5. Que el SDK oficial también rechazace firmas reales sandbox apunta a diferencia de ambiente, modo, credenciales o tipo de notificación, no a un bug de implementación HMAC. (Conclusión propia a partir de observación.)
  6. Evidencia comunitaria secundaria (no verificada como oficial): otros usuarios del SDK Node.js de Mercado Pago reportan diferencias similares entre simulación válida y webhooks reales con `InvalidWebhookSignatureError`. Registrado como evidencia de referencia, no como certeza técnica.
- Estado técnico al cerrar sesión:
  - `notification_url` restaurado en la preferencia.
  - Validación de firma activa. Webhooks inválidos siguen respondiendo 401.
  - SDK oficial se usa solo como diagnóstico; no como fuente de aceptación.
- Criterio de seguridad de diagnóstico confirmado y documentado:
  - Si hace falta diagnóstico adicional sobre `x-signature`, solo se permiten fingerprints seguros: presencia, longitud y SHA-256 prefix corto.
  - Nunca valores completos de: `x-signature`, `v1`, `x-request-id`, `data.id`, secrets ni access tokens.
- Decisión pendiente registrada: DEC-018 (estrategia de resolución del webhook 401).
- Sin cambios de código. Sin commit. Sin push. Sin acceso a `.env`. Sin secretos en documentación.

### 2026-06-26 — Diagnóstico avanzado de webhook 401: nueva hipótesis y cierre de sesión

- Objetivo: continuar el diagnóstico del webhook 401 sandbox con análisis de proxy, dominio propio, SDK oficial y simulación del panel; documentar el cierre de la sesión.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos de código afectados (diagnósticos ya en repo): `src/webhookSignature.js`, `src/app.js`, `src/config.js`.
- Archivos de documentación actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`.
- Diagnósticos realizados y evidencia recolectada:
  - Diagnóstico de headers proxy: Traefik/EasyPanel preserva `x-request-id` en requests externos controlados (SHA-256 prefix local coincide con el recibido). Hipótesis de proxy modificando headers descartada.
  - Inspección de Traefik v3.6.7 en EasyPanel: middlewares visibles no incluyen modificación de headers de request. Router HTTPS de la app usa solo `bad-gateway-error-page@file`.
  - Diagnóstico de query string y manifiesto: `has_query_data_id=true`, `has_body_data_id=true`, `query_data_id_length=12`, `body_data_id_length=12`, `manifest_final_length=78`, `signature_data_source="query_data_id"`, `hmac_format_match_name="none"` en webhooks reales sandbox.
  - Diagnóstico con SDK oficial `WebhookSignatureValidator` de `mercadopago` v3.1.0: `official_sdk_validator_available=true`, `official_sdk_validator_matches=false`, `official_sdk_validator_error_name="InvalidWebhookSignatureError"` en webhooks reales sandbox.
  - Simulación desde panel de Webhooks de Mercado Pago: firma válida. Backend entra al flujo completo. Error al consultar pago (esperable para IDs de simulación sin pago real asociado).
  - Dominio propio `checkout.lemont01.com` configurado con SSL en EasyPanel. `BASE_URL` y webhook MP sandbox actualizados. Logs confirmaron `x_forwarded_host_length=21`.
  - Prueba sin `notification_url`: eventos sin `data.id`, no útiles. Restaurada `notification_url`. Tests pasan.
- Conclusión técnica:
  - La infraestructura (Traefik/EasyPanel) y la implementación HMAC no son el problema.
  - El SDK oficial también rechaza las firmas de webhooks reales sandbox: no es un bug de implementación.
  - La diferencia está en el tipo de notificación: Mercado Pago puede usar firma o clave diferente para `notification_url` de preferencia vs el webhook global del panel.
- Riesgos de seguridad detectados:
  - El Access Token de prueba y el Webhook Secret de prueba fueron compartidos en el chat de la sesión. Deben rotarse antes de continuar.
- Pendientes al cerrar sesión:
  - Rotar credenciales de prueba expuestas y actualizar EasyPanel.
  - Decidir camino técnico (Opción A, B o C — ver "Próxima acción recomendada").
  - Retirar diagnósticos temporales antes de producción real.

### 2026-06-26 — Cierre documental de staging y registro de investigación webhook HMAC

- Objetivo: documentar el estado real de staging (activo), registrar los 5 problemas operativos resueltos, registrar el problema pendiente (webhook 401 con todas las variantes HMAC fallando) y preparar la próxima acción para Codex.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/SECURITY.md`, `docs/SKILLS.md`, `README.md`, `AGENTS.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/SECURITY.md`, `docs/SKILLS.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: header actualizado a "staging activo, investigación webhook HMAC en curso"; sección "Tareas pendientes" reemplazada con estado real del webhook 401 y pendiente de limpieza de diagnósticos; línea de deploy actualizada a "activo, webhook 401 en investigación"; "Próximo paso recomendado" reemplazado con instrucción concreta para Codex.
  - `docs/PROGRESS.md`: "Pendiente más urgente" actualizado; "Implementado en sesión 2026-06-26" ampliado con fixes operativos de staging, confirmación de secret, eliminación de lowercase y resultados del diagnóstico HMAC; "Problemas resueltos documentados" ampliado con 5 problemas de staging; "Pendientes principales" y "Próxima acción recomendada" reemplazados con contexto del webhook 401 y próxima tarea Codex.
  - `docs/SECURITY.md`: se agregó subsección sobre diagnóstico temporal en `src/webhookSignature.js` y `src/config.js` con obligación de retiro antes de producción real.
  - `docs/SKILLS.md`: se agregó nota operativa sobre formato correcto de `SUPABASE_URL` (URL base sin `/rest/v1` ni trailing slash).
- Sin cambios de código. Sin commit. Sin push. Sin acceso a `.env`. Sin secretos en documentación.
- Estado al cerrar: staging activo. `POST /webhook` retorna 401. Todas las variantes HMAC candidatas fallan. Secreto confirmado correcto. Próxima acción: Codex agrega fingerprints de componentes individuales del manifiesto.

### 2026-06-26 — Diagnóstico seguro de fingerprints y formatos HMAC

- Objetivo: diagnosticar si la firma webhook falla por componentes del manifiesto (`data.id`, `x-request-id`, `ts`) o por formato exacto, sin exponer valores completos ni aceptar firmas nuevas.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: agrega fingerprints SHA-256 de 8 caracteres y longitudes de componentes del manifiesto.
  - `src/webhookSignature.js`: agrega candidatos diagnósticos de formato oficial, sin punto y coma final, sin `request-id` y usando `body.data.id`.
  - `tests/index.test.js`: verifica que los candidatos alternativos pueden detectarse mientras el webhook sigue rechazado con HTTP 401.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico temporal listo para redeploy en EasyPanel. No cambia la validación principal.
- Pendientes o riesgos: retirar el diagnóstico temporal cuando se identifique el componente o formato real que causa el mismatch.

### 2026-06-26 — Diagnóstico seguro de variantes HMAC webhook

- Objetivo: identificar qué variante del manifiesto HMAC de Mercado Pago coincide contra `v1` sin aceptar todavía ninguna variante nueva.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: ante firma inválida, calcula candidatos `query_literal`, `body_literal`, `query_lower` y `body_lower`.
  - `src/webhookSignature.js`: el diagnóstico expone solo booleanos de coincidencia y `hmac_candidate_match_name`.
  - `tests/index.test.js`: cubre ausencia de match, match por `body_literal` y match por lowercase manteniendo respuesta `401`.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico temporal listo para redeploy en EasyPanel. La validación principal no cambia y no se aceptan webhooks inválidos.
- Pendientes o riesgos: revisar el próximo log de EasyPanel y retirar este diagnóstico cuando se confirme la variante real.

### 2026-06-26 — Diagnóstico temporal de secret webhook en startup

- Objetivo: confirmar en staging que EasyPanel carga la `MERCADO_PAGO_WEBHOOK_SECRET` esperada sin exponerla.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/config.js`, `src/logger.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/config.js`: emite en startup `event="diagnostico webhook secret"` con presencia, longitud y prefijo SHA-256 de 8 caracteres de la secret.
  - `src/logger.js`: permite solo los campos seguros `webhook_secret_present`, `webhook_secret_length` y `webhook_secret_sha256_prefix`.
  - `tests/index.test.js`: verifica que el log no contiene la secret ni el hash completo.
- Verificaciones:
  - `node --check src/config.js`.
  - `node --check src/logger.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico temporal listo para redeploy en EasyPanel sin cambiar la validación del webhook ni la lógica de pagos.
- Pendientes o riesgos: retirar este diagnóstico temporal cuando se confirme la variable en staging.

### 2026-06-26 — Fix operativo de staging: Dockerfile con Node.js 22

- Objetivo: evitar que EasyPanel/Nixpacks use Node.js 18 y falle con Supabase por falta de soporte nativo de WebSocket.
- Tarea relacionada: deploy staging posterior a T-013.
- Archivos afectados: `Dockerfile`, `.dockerignore`, `README.md`, `docs/SKILLS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `Dockerfile`: usa `node:22-alpine`, `WORKDIR /app`, `npm ci`, copia el proyecto, expone `3003` y ejecuta `npm start`.
  - `.dockerignore`: excluye `node_modules`, `.env`, `.env.*`, `.git`, logs y temporales; mantiene `.env.example` como plantilla pública mediante `!.env.example`.
  - `docs/SKILLS.md` y `README.md`: documentan que EasyPanel debe usar compilación `Dockerfile`, no Nixpacks.
  - `docs/CURRENT_CONTEXT.md`: registra que staging ahora se construye con Dockerfile Node.js 22.
- Verificaciones:
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
  - Confirmación de que no hay cambios en `.js`, `.env`, dependencias, `package.json` ni `package-lock.json`.
  - Revisión de `Dockerfile` y `.dockerignore` sin secretos ni valores reales.
- Resultado: configuración Docker lista para redeploy en EasyPanel con Node.js 22.
- Pendientes o riesgos: el usuario debe cambiar EasyPanel de Nixpacks a Dockerfile y hacer redeploy.

### 2026-06-26 — Diagnóstico seguro de Supabase en staging

- Objetivo: distinguir por qué `POST /crear-preferencia` falla al persistir el pedido en Supabase sin exponer secretos ni datos del pedido.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: se agregó categorización segura del error de Supabase en el catch de persistencia de pedido. El log mantiene `event="error al persistir pedido"` y usa `error_type` con categorías como `supabase_result_shape_error`, `supabase_auth_or_rls_error`, `supabase_constraint_error`, `supabase_postgrest_error` o `supabase_error`.
  - `tests/index.test.js`: se agregó aserción para verificar que el log categoriza el error de Supabase sin emitir el mensaje interno simulado.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico listo para redeploy en EasyPanel. No cambia el contrato HTTP ni la lógica de pagos.
- Pendientes o riesgos: si la categoría sigue siendo genérica, hará falta autorizar un ajuste de logging más específico en `src/logger.js` para incluir campos seguros como `supabase_code` o `supabase_status`.

### 2026-06-26 — Diagnóstico seguro adicional de PostgREST

- Objetivo: conocer el código exacto del error Supabase/PostgREST sin exponer mensaje, detalles, hint, payload, headers ni secretos.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: el log `event="error al persistir pedido"` agrega, si existen, `supabase_code`, `supabase_status`, `supabase_error_name`, `supabase_details_type` y `supabase_hint_type`.
  - `tests/index.test.js`: se verifica que esos campos seguros aparezcan y que no se emitan `error.message`, `error.details` ni `error.hint` completos.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico listo para redeploy en EasyPanel. No cambia el contrato HTTP ni la lógica de pagos.
- Pendientes o riesgos: revisar el próximo log de EasyPanel y decidir el fix mínimo según `supabase_code`/`supabase_status`.

### 2026-06-26 — Diagnóstico seguro de firma webhook Mercado Pago

- Objetivo: diagnosticar por qué Mercado Pago sandbox llega a `POST /webhook` pero la validación HMAC responde 401.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `src/app.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: se agregó parsing reutilizable de `x-signature` y diagnóstico seguro de fuente de `data.id`, presencia de headers, presencia de `ts`/`v1`, longitud de `v1` y uso de lowercase.
  - `src/app.js`: cuando la firma es inválida, el log `event="firma de webhook invalida"` incluye solo esos metadatos seguros y mantiene HTTP 401.
  - `tests/index.test.js`: se cubre el log seguro de firma inválida y el caso donde `data.id` llega solo en `body.data.id`.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `node --check src/app.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico listo para redeploy en EasyPanel. No desactiva ni debilita la validación de firma.
- Pendientes o riesgos: revisar si `has_query_data_id=false` y `has_body_data_id=true`, o si el problema apunta al lowercase del `data.id`.

### 2026-06-26 — Fix de firma webhook Mercado Pago con data.id literal

- Objetivo: alinear el manifiesto HMAC con el contrato oficial de Mercado Pago usando `data.id` literal.
- Tarea relacionada: fix operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: el manifiesto cambió de `String(dataId).toLowerCase()` a `String(dataId)`.
  - `src/webhookSignature.js`: el diagnóstico seguro reemplazó `uses_lowercase_data_id` por `preserves_literal_data_id`.
  - `tests/index.test.js`: las firmas de prueba se calculan con `data.id` literal por defecto y se agregó una regresión que rechaza una firma calculada con lowercase cuando el request trae otro casing.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: la validación HMAC conserva el rechazo de firmas inválidas y usa el `data.id` literal.
- Pendientes o riesgos: redeploy en EasyPanel y repetir pago sandbox para confirmar que Mercado Pago ya no recibe 401.

### 2026-06-26 — Cierre final del backlog (14/14 tareas)

- Objetivo: verificar consistencia documental del estado final del proyecto y cerrar el backlog T-001 a T-014.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `docs/SKILLS.md`, `README.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: se consolidó DEC-016 en la tabla principal de decisiones aceptadas (estaba en tabla "continuación" separada).
  - `docs/PROGRESS.md`: se agregó "Implementado en sesión 2026-06-26" con T-013 en la sección de avances detectados. Esta entrada de cierre final agregada.
- Inconsistencias detectadas y corregidas:
  - DEC-016 estaba en tabla "continuación" separada en `CURRENT_CONTEXT.md`; ahora está integrada en la tabla principal.
  - T-013 no aparecía en la sección "Avances detectados" de `PROGRESS.md` a pesar de estar en la bitácora; ahora figura bajo su sesión real (2026-06-26).
- Sin inconsistencias en los demás archivos:
  - `docs/TASKS.md`: T-013 marcada como completada con nota de verificación (2026-06-26). T-014 completada. Ninguna tarea incorrectamente pendiente.
  - `docs/DESIGN.md`: T-013/DEC-016 incluida en "Implementado y vigente". Limitaciones estructurales actualizadas.
  - `docs/SECURITY.md`: riesgos mitigados correctamente documentados. Sin frases obsoletas.
  - `docs/SKILLS.md`: sección "Deploy a staging (EasyPanel)" con checklist completa, variables, seguridad y rollback.
  - `README.md`: sección "Deploy a staging" presente. "Base de datos" referencia migración versionada. "Limitaciones actuales" sin frases obsoletas.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Estado al cerrar: 14/14 tareas completadas y documentadas. Backlog T-001 a T-014 cerrado.
- Próximo paso: el usuario ejecuta el deploy real a staging en EasyPanel siguiendo `docs/SKILLS.md` y DEC-016.

### 2026-06-26 — T-013 completada

- Objetivo: dejar preparada y documentada la guía final de deploy a staging en EasyPanel según DEC-016.
- Tarea relacionada: T-013.
- Archivos afectados: `docs/SKILLS.md`, `README.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/DESIGN.md`, `docs/SECURITY.md`.
- Cambios realizados:
  - `docs/SKILLS.md`: se ajustó el comando de prueba de preferencia para usar `{ sku, quantity }`, se eliminó texto obsoleto sobre ausencia de tests, se completó la guía de EasyPanel con variables por nombre, checklist de staging, checklist previa a producción real, notas de seguridad y rollback.
  - `README.md`: se agregó una sección breve de deploy a staging que referencia `docs/SKILLS.md` y DEC-016.
  - `docs/TASKS.md`: T-013 marcada como completada con resultado y verificaciones.
  - `docs/CURRENT_CONTEXT.md`: contexto actualizado a 14/14 tareas completadas y deploy documentado.
  - `docs/DESIGN.md`: se corrigió la limitación obsoleta que indicaba que no había deploy documentado.
  - `docs/SECURITY.md`: se corrigieron riesgos ya mitigados para firma de webhook, pedido interno, condición de carrera y controles operativos.
- Verificaciones:
  - `git diff --check`.
  - `git diff`.
  - Confirmación de que el diff toca solo Markdown permitido.
  - Confirmación de que no hay cambios en `.js`, `.env`, dependencias, `package.json` ni `package-lock.json`.
  - Búsqueda de secretos y valores reales de variables sin hallazgos.
- Resultado: T-013 completada como documentación. No se ejecutó deploy real, no se leyeron secretos, no se modificó código y no hubo commit ni push.
- Pendientes o riesgos: el usuario debe ejecutar staging en EasyPanel, configurar manualmente el webhook sandbox de Mercado Pago y registrar los resultados de la checklist.

### 2026-06-25 — DEC-016 aceptada — estrategia de deploy, staging y rollback definida

- Objetivo: documentar DEC-016 para desbloquear T-013.
- Tareas relacionadas: T-013.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/SKILLS.md`, `README.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/SKILLS.md`, `README.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-016 pasó de `pendiente` a `aceptada`. Se documentó la decisión completa: EasyPanel/VPS como plataforma de staging, URL HTTPS gratuita de EasyPanel, `NODE_ENV=production` desde el primer deploy, `MERCADOPAGO_ACCESS_TOKEN` sandbox, mismo proyecto Supabase actual, variables solo en EasyPanel, webhook sandbox a configurar manualmente, checklist de staging (11 ítems), checklist previa a producción real (11 ítems), estrategia de rollback en 4 niveles, alternativas consideradas y qué implementa T-013.
  - `docs/TASKS.md`: T-013 actualizada con instrucciones concretas: actualizar `docs/SKILLS.md` (sección "Deploy") y `README.md` (secciones desactualizadas).
  - `docs/SKILLS.md`: sección "Deploy" reemplazada con pasos concretos de EasyPanel, tabla de variables por nombre, notas de seguridad y rollback resumido.
  - `README.md`: sección "Base de datos" actualizada para referenciar `supabase/migrations/001_create_orders.sql` ya existente. Sección "Limitaciones actuales" corregida: eliminadas referencias a "no hay tests", "no hay migración versionada" y "el webhook no valida su firma" (todo resuelto). Limitaciones reales actualizadas: sin autenticación, sin panel admin, deploy pendiente de ejecución.
  - `docs/CURRENT_CONTEXT.md`: DEC-016 incorporada a la tabla de decisiones aceptadas; T-013 marcada como lista para implementar; "Próximo paso" actualizado.
  - `docs/PROGRESS.md`: esta entrada.
- Decisiones tomadas: DEC-016 aceptada. Staging en EasyPanel/VPS. Sandbox primero. Producción real con checklist obligatoria. Sin dependencias nuevas. Sin cambios en código.
- Sin cambios de código JavaScript. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-013 actualizando `docs/SKILLS.md` y `README.md`. El usuario ejecuta el deploy a EasyPanel siguiendo la checklist de staging de DEC-016.

### 2026-06-25 — Cierre documental de fase (13/14 tareas)

- Objetivo: verificar consistencia documental del estado real del proyecto tras la finalización de T-012, y dejar el proyecto ordenado antes de resolver DEC-016.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/DESIGN.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: se consolidaron las dos tablas separadas de "Decisiones técnicas aceptadas" en una sola tabla con DEC-013 integrada junto a las otras cinco decisiones.
  - `docs/PROGRESS.md`: se dividió "Implementado en sesión 2026-06-24" en dos subsecciones (2026-06-24 y 2026-06-25) para que T-007 a T-014 no figuren bajo una fecha incorrecta. Esta entrada de cierre agregada.
- Inconsistencias detectadas y corregidas:
  - DEC-013 estaba en una sección "continuación" separada en `CURRENT_CONTEXT.md`; ahora está en la tabla principal.
  - El encabezado "Implementado en sesión 2026-06-24" incluía T-012 y T-014 completadas el 2026-06-25; ahora están bajo su fecha real.
- Sin inconsistencias en `docs/TASKS.md`: T-012 marcada como completada con nota de verificación (29 tests), T-013 pendiente bloqueada por DEC-016, T-014 completada.
- Sin inconsistencias en `docs/DESIGN.md`: `src/catalog.js` documentado, flujo actualizado, 29 tests.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Estado al cerrar: 13/14 tareas completadas y documentadas. Única tarea pendiente: T-013, bloqueada por DEC-016.
- Próximo paso: el usuario define DEC-016 (proveedor de deploy, entornos, rollback) para desbloquear T-013.

### 2026-06-25 — T-012 completada

- Objetivo: implementar catálogo seguro del lado del backend para que el frontend no pueda decidir ni manipular precio, importe total ni moneda.
- Tarea relacionada: T-012.
- Archivos afectados: `src/catalog.js`, `src/app.js`, `public/app.js`, `tests/index.test.js`, `README.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `src/catalog.js`: nuevo módulo de catálogo según DEC-013, con SKU `REMERA-LEMONT-001`, `unitPrice: 100`, moneda `ARS`, `maxQuantity: 10` y export `getProduct(sku)`.
  - `src/app.js`: `POST /crear-preferencia` acepta solo `{ sku, quantity }`, valida SKU y cantidad, calcula `total` en backend e ignora `price`, `amount` y `currency` del cliente.
  - `public/app.js`: envía `{ sku: "REMERA-LEMONT-001", quantity: 1 }`.
  - `tests/index.test.js`: se agregaron regresiones para SKU inválido, cantidades inválidas, cantidad válida y manipulación de `amount`, `currency` y `price`.
  - Documentación: se actualizó el contrato de creación de preferencias y el estado de T-012.
- Verificaciones:
  - `node --check src/catalog.js`.
  - `node --check src/app.js`.
  - `npm.cmd test` — 29 tests pasan.
  - `git diff --check`.
  - `git diff`.
- Resultado: T-012 completada sin leer `.env`, sin exponer secretos, sin dependencias nuevas, sin tablas nuevas en Supabase, sin commits, sin push y sin cambios en `POST /webhook`, firma, consulta real a Mercado Pago, transición `pending → paid` ni validación final de importe/moneda del webhook.
- Pendientes o riesgos: T-013 sigue pendiente y requiere DEC-016.

### 2026-06-25 — DEC-013 aceptada — estrategia de catálogo y precios definida

- Objetivo: documentar DEC-013 para desbloquear T-012.
- Tareas relacionadas: T-012.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-013 pasó de `pendiente` a `aceptada`. Se documentó la decisión completa: catálogo como módulo `src/catalog.js`, contrato del handler `POST /crear-preferencia` (acepta `{ sku, quantity }`, rechaza importe del cliente), reglas de validación, cálculo de importe en backend, estrategia de migración futura a tabla Supabase y alternativas descartadas.
  - `docs/TASKS.md`: T-012 actualizada con instrucciones concretas para Codex: crear `src/catalog.js`, modificar `src/app.js`, agregar tests de SKU inválido, cantidad fuera de rango y precio calculado correctamente.
  - `docs/CURRENT_CONTEXT.md`: DEC-013 movida a decisiones aceptadas, T-012 marcada como lista para implementar, próximo paso actualizado.
  - `docs/PROGRESS.md`: esta entrada.
- Decisiones tomadas: DEC-013 aceptada. Catálogo en módulo `src/catalog.js`. Sin dependencias nuevas. Sin tabla Supabase adicional en esta etapa.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-012 usando `docs/TASKS.md` (T-012) y `docs/DECISIONS.md` (DEC-013).

### 2026-06-25 — Cierre documental de sesión (12/14 tareas)

- Objetivo: actualizar `docs/CURRENT_CONTEXT.md` y `docs/DESIGN.md` para reflejar el estado real del proyecto tras el cierre de T-011, T-014 y las correcciones de la sesión anterior.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/DESIGN.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: reescritura completa para reflejar 12/14 tareas completadas. T-011 y T-014 incluidas en la sección "P2 — completadas". Tareas pendientes reducidas a T-012 y T-013. Tests corregidos a 22. `GET /webhook` documentado como restringido a no-producción. Commits corregidos (T-001–T-010 y T-014 pusheados; T-011 local sin commit). Próximo paso reenfocado en resolver DEC-013 y DEC-016 antes de programar.
  - `docs/DESIGN.md`: conteo de tests corregido de 18 a 22 en dos lugares (sección "Módulos principales" y bloque de estructura de archivos).
- Decisiones tomadas: ninguna nueva. Todas las correcciones son de sincronización documental.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Estado al cerrar: 12/14 tareas completadas y documentadas. Próximo paso: resolver DEC-013 (T-012) y DEC-016 (T-013).

### 2026-06-25 — T-011 completada

- Objetivo: retirar o restringir `GET /webhook` para que no quede disponible en producción.
- Tarea relacionada: T-011.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/DESIGN.md`, `docs/SKILLS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: `GET /webhook` se registra solo cuando `NODE_ENV !== "production"`.
  - `tests/index.test.js`: se agregaron pruebas para `test`, `development` y `production`, confirmando que `POST /webhook` sigue registrado en producción.
  - `docs/DESIGN.md` y `docs/SKILLS.md`: se documentó que el diagnóstico GET solo existe fuera de producción.
  - `docs/TASKS.md` y `docs/PROGRESS.md`: T-011 marcada como completada y verificaciones registradas.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test` — 22 tests pasan.
  - `git diff --check`.
  - `git diff`.
- Resultado: T-011 completada sin leer `.env`, sin exponer secretos, sin dependencias nuevas, sin commits, sin push y sin cambios en pagos, validación de firma, Mercado Pago, Supabase ni arquitectura.
- Pendientes o riesgos: T-012 y T-013 siguen pendientes y requieren decisiones.

### 2026-06-25 — T-014 completada

- Objetivo: corregir la codificación UTF-8 del mensaje de error HTTP 400 para JSON inválido.
- Tarea relacionada: T-014.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/TASKS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: el middleware de `SyntaxError` para JSON inválido conserva HTTP `400` y `{ error: "JSON inválido" }`, y define `Content-Type: application/json; charset=utf-8`.
  - `tests/index.test.js`: se agregó una regresión que verifica status, body y charset UTF-8.
  - `docs/TASKS.md` y `docs/PROGRESS.md`: T-014 marcada como completada y verificaciones registradas.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test` — 19 tests pasan.
  - `git diff --check`.
  - `git diff`.
- Resultado: T-014 completada sin leer `.env`, sin exponer secretos, sin dependencias nuevas, sin commits, sin push y sin cambios en pagos, Mercado Pago, Supabase ni arquitectura.
- Pendientes o riesgos: T-011 sigue pendiente para retirar o restringir `GET /webhook` en producción.

### 2026-06-25 — Cierre documental de T-009

- Objetivo: registrar documentalmente el cierre real de T-009 tras su implementación y commit.
- Archivos revisados: `docs/TASKS.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Correcciones realizadas:
  - `docs/TASKS.md`: eliminada la nota obsoleta sobre "marcación prematura". "Estructura propuesta" renombrada a "Estructura implementada". "Instrucciones para Codex" reemplazadas por "Verificaciones realizadas" y "Criterios de aceptación cumplidos". Commit referenciado.
  - `docs/PROGRESS.md`: entrada T-009 completada con commit "Separa backend en modulos" y push a `origin/main`. "Próxima acción recomendada" actualizada a 10/14 tareas; T-009 ya no figura como pendiente de commit.
  - `docs/CURRENT_CONTEXT.md`: estado de commits actualizado; T-009 figura como commiteada junto con T-001 a T-006.
- Estado del proyecto al cerrar: 10/14 tareas completadas y commiteadas. T-001–T-010 pusheadas a `origin/main`. T-011, T-012, T-013, T-014 pendientes. **Corrección posterior (misma sesión):** la versión inicial de esta entrada indicaba incorrectamente que T-007, T-008 y T-010 estaban sin commit; en realidad ya tenían sus propios commits ("Implementa validacion segura de importes y moneda", "Mejora identificadores unicos de pedidos", "Implementa logs estructurados seguros").

### 2026-06-25 — T-009 completada

- Objetivo: separar responsabilidades del backend sin cambiar comportamiento HTTP observable.
- Tarea relacionada: T-009.
- Archivos creados: `src/app.js`, `src/config.js`, `src/logger.js`, `src/payments.js`, `src/orders.js`, `src/webhookSignature.js`.
- Archivos modificados: `index.js`, `docs/TASKS.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: reducido a entrypoint mínimo que carga config, importa app y llama a `app.listen`.
  - `src/app.js`: concentra Express, middlewares, rutas y handlers.
  - `src/config.js`: valida y expone variables de entorno.
  - `src/logger.js`: mueve el helper `log()` de DEC-017.
  - `src/payments.js`: encapsula Mercado Pago (`Preference.create`, `Payment.get`).
  - `src/orders.js`: encapsula Supabase, pedidos, comparación de importes y transición `pending → paid`.
  - `src/webhookSignature.js`: encapsula la validación HMAC-SHA256 de Mercado Pago.
- Verificaciones:
  - `node --check index.js` — sin errores de sintaxis.
  - `node --check src/*.js` — sin errores en ningún módulo.
  - `npm.cmd test` — 18 tests pasan.
  - `git diff --check` — sin problemas de espaciado.
  - Búsqueda de `console.*` — solo queda en `src/logger.js`.
  - Búsqueda de secretos — solo nombres de variables/placeholders/documentación, sin valores reales.
- Commit: "Separa backend en modulos" — pusheado a `origin/main`.
- Resultado: T-009 completada. Backend modularizado sin instalar dependencias, sin modificar `package.json`, sin leer `.env`, sin cambiar rutas, respuestas públicas, creación de preferencias, firma webhook, validación de importe/moneda, transición `pending → paid` ni eventos/campos de logs. Repo limpio y sincronizado con `origin/main`.
- Pendientes o riesgos: T-011 sigue pendiente para retirar o restringir `GET /webhook` en producción.

### 2026-06-25 — T-009 corregida a pendiente; estructura de refactor definida

- Objetivo: corregir el estado inconsistente de T-009 y documentar la estructura propuesta para el refactor.
- Problema detectado: T-009 estaba marcada como `completada` en `docs/TASKS.md`, pero los módulos `src/` no existen en el repositorio. `index.js` sigue concentrando toda la lógica.
- Archivos revisados: `docs/TASKS.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/DESIGN.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/TASKS.md`: T-009 corregida de `completada` a `pendiente`. Se agregó nota sobre la marcación prematura. Se documentó la estructura propuesta (`src/app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js`, `webhookSignature.js`). Se actualizaron instrucciones para Codex con 8 pasos concretos y criterios de aceptación que incluyen mantener los 18 tests pasando.
  - `docs/DESIGN.md`: se separó la sección "Módulos principales" en estado actual vs estructura propuesta. Se actualizaron "Limitaciones estructurales" e "Implementado y vigente" para reflejar el estado real del proyecto.
  - `docs/CURRENT_CONTEXT.md`: descripción de T-009 actualizada con la estructura de módulos propuesta.
  - `docs/PROGRESS.md`: estado actual y esta entrada.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-009 siguiendo `docs/TASKS.md` (T-009) y la estructura en `docs/DESIGN.md`.

### 2026-06-25 — T-010 completada

- Objetivo: implementar DEC-017 como fuente de verdad para observabilidad segura.
- Tarea relacionada: T-010.
- Archivos afectados: `index.js`, `.env.example`, `tests/index.test.js`, `README.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: se agregó `log(level, event, extra)` con salida JSON y whitelist de campos seguros.
  - `index.js`: todos los logs directos del backend fueron reemplazados por el helper; `console.*` solo queda dentro de `log`.
  - `.env.example`: se agregó `LOG_LEVEL=info`.
  - `tests/index.test.js`: se actualizaron aserciones para logs JSON y se verificó ausencia de `x-signature`, importes y `external_reference` en flujos críticos.
  - Documentación: se actualizó el contrato de variables y el estado de T-010.
- Verificaciones:
  - `node --check index.js`.
  - `npm.cmd test` — 18 tests pasan.
  - `Select-String -Path index.js -Pattern "console\\."` — solo encuentra `console.*` dentro del helper.
  - `git diff --check`.
- Resultado: T-010 completada sin instalar dependencias, sin modificar `package.json`, sin leer `.env`, sin commits y sin cambiar creación de preferencias, firma webhook, validación importe/moneda ni transición `pending → paid`.
- Pendientes o riesgos: T-011 sigue pendiente para retirar o restringir `GET /webhook` en producción.

### 2026-06-25 — DEC-017 aceptada — estrategia de observabilidad segura definida

- Objetivo: documentar DEC-017 para desbloquear T-010.
- Tareas relacionadas: T-010.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `CLAUDE.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-017 pasó de `pendiente` a `aceptada`. Se documentaron los 10 puntos: helper propio `log(level, event, extra)`, formato JSON mínimo, niveles `info`/`warn`/`error`, campos permitidos, campos prohibidos, correlación por `request_id` (usando `x-request-id` de MP o `crypto.randomUUID()`), política de retención (stdout, 30–90 días según proveedor), verbosidad adicional segura con `LOG_LEVEL`, tareas desbloqueadas (T-010) y riesgos de logs inseguros.
  - `docs/TASKS.md`: T-010 actualizada con instrucciones concretas para Codex: crear el helper, reemplazar todos los `console.*`, agregar `LOG_LEVEL` a `.env.example` y tests de ausencia de campos prohibidos.
  - `docs/CURRENT_CONTEXT.md`: DEC-017 movida a decisiones aceptadas, T-010 marcada sin bloqueo, próximo paso actualizado.
  - `docs/PROGRESS.md`: estado actual y esta entrada.
- Decisiones tomadas: DEC-017 aceptada. Sin librería externa. Sin cambios en `package.json`.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-010 usando `docs/TASKS.md` (T-010) y `docs/DECISIONS.md` (DEC-017).

### 2026-06-25 — T-008 completada

- Objetivo: reemplazar referencias basadas solo en timestamp por identificadores robustos bajo concurrencia.
- Tarea relacionada: T-008.
- Archivos afectados: `index.js`, `tests/index.test.js`, `README.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: `externalReference` ahora usa `LEMONT-ORDER-${crypto.randomUUID()}`.
  - `tests/index.test.js`: se agregaron pruebas para prefijo, no dependencia exclusiva de `Date.now()` y dos pedidos en el mismo instante sin repetir `external_reference`.
  - Documentación: se actualizó el estado de T-008, el flujo documentado y el contexto compacto.
- Verificaciones:
  - `node --check index.js`.
  - `npm.cmd test` — 18 tests pasan.
  - `git diff --check`.
- Resultado: T-008 completada sin instalar dependencias, sin leer `.env`, sin commits y sin cambiar Mercado Pago, webhooks, firma, validación de importe/moneda ni transición `pending → paid`.
- Pendientes o riesgos: ninguno específico de T-008.

### 2026-06-25 — T-007 completada

- Objetivo: implementar DEC-011 como fuente de verdad para comparación de importes y validación de moneda.
- Tarea relacionada: T-007.
- Archivos afectados: `index.js`, `tests/index.test.js`, `README.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: se agregó `importesCoinciden(a, b)` con normalización a centavos usando `Math.round(Number(valor) * 100)`.
  - `index.js`: la transición a `paid` ahora valida `payment.currency_id` contra `order.currency` y usa `importesCoinciden` para el importe.
  - `index.js`: el `POST /webhook` dejó de registrar payloads y campos reales del pago; conserva logs genéricos.
  - `tests/index.test.js`: se agregaron casos para decimal normalizado, importe distinto, moneda distinta, moneda correcta y no exposición de importe/moneda en logs.
- Verificaciones:
  - `node --check index.js`.
  - `npm.cmd test` — 15 tests pasan.
  - `git diff --check`.
- Resultado: T-007 completada sin instalar dependencias, sin leer `.env`, sin commits y sin cambiar creación de preferencias, validación de firma ni la condición atómica `pending → paid`.
- Pendientes o riesgos: quedan logs de diagnóstico fuera de `POST /webhook` para revisar en T-010/T-011.

### 2026-06-25 — DEC-011 aceptada — estrategia monetaria definida

- Objetivo: documentar DEC-011 para desbloquear T-007.
- Tareas relacionadas: T-007.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `CLAUDE.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-011 pasó de `pendiente` a `aceptada`. Se documentaron los 8 puntos: formato interno (pesos ARS), esquema Supabase sin migración, conversión a Mercado Pago (pesos), función de comparación (`Math.round(a * 100) === Math.round(b * 100)`), validación de moneda (`currency_id` vs `order.currency`), logs genéricos permitidos, tareas desbloqueadas (T-007) y riesgos del punto flotante.
  - `docs/TASKS.md`: T-007 actualizada con instrucciones concretas para Codex: función `importesCoinciden`, reemplazo de comparación actual, validación de moneda y casos de prueba requeridos.
  - `docs/CURRENT_CONTEXT.md`: DEC-011 movida a decisiones aceptadas, T-007 marcada sin bloqueo, próximo paso actualizado.
  - `docs/PROGRESS.md`: esta entrada.
- Decisiones tomadas: DEC-011 aceptada con estrategia sin dependencias nuevas.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-007 usando las instrucciones de `docs/TASKS.md` (T-007) y la decisión en `docs/DECISIONS.md` (DEC-011).

### 2026-06-25 — Migración manual de Supabase aplicada y verificada

- Objetivo: documentar la aplicación y verificación manual de la migración SQL en Supabase.
- Tarea relacionada: T-006 (archivo creado el 2026-06-24, aplicado el 2026-06-25).
- Archivos afectados: solo documentación (PROGRESS.md, CURRENT_CONTEXT.md, TASKS.md).
- Verificaciones realizadas:
  - `git status` limpio antes de aplicar.
  - `npm test` pasa con 11 tests.
  - Migración ejecutada en Supabase SQL Editor: `Success. No rows returned.`
  - Tabla `public.orders` visible en Table Editor (vacía, sin datos reales).
  - Columnas confirmadas: `id`, `external_reference`, `product_name`, `quantity`, `amount`, `currency`, `status`, `mercadopago_payment_id`, `mercadopago_status`, `created_at`, `updated_at`.
  - Constraints confirmados: `external_reference` unique, `amount > 0`, `status` solo `pending` o `paid`.
  - Índices confirmados: `orders_status_idx`, `orders_mercadopago_payment_id_idx`.
  - RLS confirmada mediante consulta a `pg_tables`: `rowsecurity = true`.
  - Sin policies para `anon` ni `authenticated`.
  - Sin pedidos insertados manualmente.
- Resultado: T-006 completamente finalizada (archivo creado + aplicado + verificado).
- Pendientes: ninguno relacionado con T-006. Siguiente decisión recomendada: DEC-011 para desbloquear T-007.

### 2026-06-24 — T-006 completada

- Se creó `supabase/migrations/001_create_orders.sql` con DDL de `public.orders`, restricciones `status in ('pending', 'paid')` y `amount > 0`, índices para `status` y `mercadopago_payment_id`, y RLS habilitada.
- No se crearon policies para `anon` ni `authenticated`; el archivo documenta que `SUPABASE_SERVICE_ROLE_KEY` debe permanecer solo en backend.
- La migración no fue aplicada en ninguna base de datos. El usuario debe revisarla y aplicarla manualmente cuando corresponda.
- Verificación: `git diff --check`.

### 2026-06-24 — Cierre de fase P0 + P1 inicial

- T-001 a T-006 completadas y commiteadas. La primera fase de seguridad, calidad y versionado está cerrada.
- Estado técnico final: validación HMAC-SHA256, transición atómica, tests Jest (11 tests), migración SQL versionada, variables de entorno validadas.
- `docs/CURRENT_CONTEXT.md` actualizado como resumen compacto de cierre.
- Próxima fase sugerida: modo aprendizaje → definir DEC-011 → implementar T-007 (estrategia monetaria).

### 2026-06-24 — Contexto estable consolidado

- Se creó `docs/CURRENT_CONTEXT.md` como resumen compacto para agentes: metodología, estado de tareas, decisiones aceptadas, estado técnico y próximo paso.
- Se actualizaron "Estado actual" y "Avances detectados" en este archivo para reflejar el estado real post T-001 a T-005.

### 2026-06-24 — DEC-012 aceptada

- Estrategia elegida: SQL manual versionado en `supabase/migrations/`, sin Supabase CLI.
- El usuario aplicará el archivo manualmente; Codex no ejecuta comandos de base de datos.
- T-006 queda desbloqueada.

### 2026-06-24 — T-006 alcance definido

- Se documentó el esquema real de `orders` (fuente: README.md), las restricciones a agregar (CHECK status, CHECK amount > 0), los índices recomendados (status, mercadopago_payment_id), la estrategia RLS mínima y las reglas de versionado SQL.
- Se identificó que DEC-012 ya existe en `docs/DECISIONS.md` como decisión pendiente sobre estrategia de versionado; no fue necesario crear DEC-011 (ya ocupada por importes/redondeo).
- Pendiente: el usuario debe confirmar DEC-012 antes de que Codex implemente.

### 2026-06-24 — T-005 completada

- Se agregó Jest como dependencia de desarrollo y el comando reproducible `npm test`.
- Se creó `tests/index.test.js` con mocks de Express, Mercado Pago, Supabase y dotenv para evitar llamadas reales y acceso a `.env`.
- Casos cubiertos: configuración obligatoria, fallo de Supabase antes de crear preferencia, firma ausente, firma inválida, firma válida, pago aprobado con importe correcto e incorrecto, pago no aprobado, pedido inexistente, pedido ya pagado, webhooks concurrentes y transición atómica.
- Verificación: `npm test`, `node --check index.js` y `git diff --check`.

### 2026-06-24 — T-005 alcance definido

- Se definieron los 13 casos de prueba (TC-01 a TC-13), el framework recomendado (Jest, con `node:test` como alternativa sin dependencias), los archivos involucrados, los criterios de aceptación y qué no testear todavía.
- Pendiente: el usuario debe confirmar el framework y autorizar la modificación de `package.json` antes de que Codex implemente.

### 2026-06-24 — T-003 completada

- La transición `pending` → `paid` ahora usa una actualización condicional por referencia y estado; cero filas actualizadas se trata como webhook duplicado idempotente.
- Se preservan los controles de pedido inexistente, pago aprobado e importe coincidente, con logs genéricos en este flujo.
- Verificación: sintaxis correcta y pruebas aisladas de pedido inexistente, ya pagado, importe distinto, pago no aprobado, transición exitosa y dos webhooks concurrentes con una sola actualización efectiva.

### 2026-06-24 — DEC-010 aceptada

- Se definió la estrategia de transición atómica `pending` → `paid`: actualización condicional desde el backend con Supabase, idempotencia por estado, manejo de pedido inexistente, importe diferente y pago no aprobado.
- DEC-010 quedó aceptada y T-003 está desbloqueada para su implementación.

### 2026-06-24 — T-001 completada

- Se implementó la validación oficial HMAC-SHA256 de Mercado Pago antes de procesar el webhook, usando `x-signature`, `x-request-id`, `data.id` y `MERCADO_PAGO_WEBHOOK_SECRET` según DEC-009.
- Las firmas ausentes o inválidas reciben HTTP `401` con una respuesta genérica y únicamente los logs autorizados; una firma válida conserva el flujo existente.
- Verificación: sintaxis correcta y pruebas aisladas de firma ausente, inválida y válida, sin cargar `.env`, realizar llamadas externas ni mostrar datos sensibles.

### 2026-06-24 — DEC-009 definida

- Se definieron la variable `MERCADO_PAGO_WEBHOOK_SECRET`, la respuesta HTTP `401` con mensaje genérico y las restricciones de exposición y logs para firmas ausentes o inválidas.
- DEC-009 quedó definida y T-001 está desbloqueada para su planificación e implementación.

### 2026-06-24 — T-004 completada

- El inicio valida las cuatro variables obligatorias antes de crear clientes externos o aceptar tráfico; los valores ausentes o vacíos detienen el proceso mostrando solo sus nombres.
- Archivos modificados: `index.js`, `docs/TASKS.md` y `docs/PROGRESS.md`.
- Verificación: sintaxis correcta y pruebas aisladas de variable ausente, vacía y configuración completa, sin cargar `.env` ni realizar llamadas externas.

### 2026-06-24 — T-002 completada

- Se detiene `POST /crear-preferencia` si Supabase no puede crear el pedido `pending`; el cliente recibe un error HTTP genérico y Mercado Pago no es llamado.
- Archivos modificados: `index.js`, `docs/TASKS.md` y `docs/PROGRESS.md`.
- Verificación: sintaxis de Node.js y pruebas aisladas en memoria de los flujos fallido y exitoso; sin llamadas externas ni acceso a secretos.

### 2026-06-24 — Enriquecimiento de documentación para Codex

- Objetivo: completar el formato de tareas, formalizar decisiones pendientes y actualizar la bitácora.
- Tipo de sesión: revisión documental y edición de Markdown. Sin ejecución de código, instalación de dependencias ni acceso a secretos.
- Archivos revisados: `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/SKILLS.md`, `docs/SECURITY.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/TASKS.md`: cada tarea (T-001 a T-014) recibió los campos `Estado`, `Prioridad`, `Archivos involucrados`, `Instrucciones para Codex`, `Riesgos` y `Resultado esperado`. Los criterios de aceptación existentes se conservaron sin modificación.
  - `docs/DECISIONS.md`: la lista libre "Decisiones pendientes" fue convertida en nueve entradas formales (DEC-009 a DEC-017), cada una con contexto, opciones a evaluar y estado `pendiente`. Las decisiones vigentes D-001 a D-008 no fueron modificadas.
  - `docs/PROGRESS.md`: se agregó esta entrada de bitácora.
- Inconsistencias detectadas y registradas:
  - Las tareas no tenían los campos requeridos por el formato de `CLAUDE.md`.
  - Las decisiones pendientes existían como lista libre sin estructura DEC-XXX.
  - T-003 referenciaba una decisión en `DECISIONS.md` que no existía formalmente; ahora existe como DEC-010.
- Decisiones tomadas: ninguna decisión de código. Solo formalización de documentación existente.
- Pendientes: las nueve decisiones (DEC-009 a DEC-017) requieren confirmación del usuario antes de que Codex pueda implementar las tareas relacionadas.
- Próximos pasos: ver sección "Próxima acción recomendada".

### 2026-06-24 — Base documental para agentes

- Objetivo: crear contexto estable para agentes sin modificar código.
- Revisión: estructura, README, package.json, backend, frontend, integración de pagos, webhook y persistencia.
- Archivos: `README.md`, `AGENTS.md` y documentos bajo `docs/`.
- Resultado: arquitectura, requisitos, tareas, decisiones, procedimientos y seguridad quedaron documentados.
- Verificación: revisión estática; sin ejecución, instalación, cambios de configuración ni acceso a secretos.

### Plantilla para futuras sesiones

```markdown
### AAAA-MM-DD — Título breve

- Objetivo:
- Tarea relacionada:
- Archivos afectados:
- Cambios realizados:
- Verificaciones:
- Resultado:
- Pendientes o riesgos:
```
