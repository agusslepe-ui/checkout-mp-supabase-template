# Tareas

Estados posibles: `pendiente`, `en curso`, `bloqueada`, `completada`. Todas las tareas siguientes están pendientes y requieren autorización antes de modificar código o infraestructura.

---

## P0 — Seguridad e integridad

### T-001 — Validar la firma del webhook

**Estado:** completada
**Prioridad:** P0

#### Objetivo
Verificar criptográficamente que los eventos recibidos en `/webhook` provienen de Mercado Pago antes de procesarlos.

#### Archivos involucrados
- `index.js`
- `.env.example` (agregar variable para el secreto de validación)
- Nuevo archivo de tests (nombre a definir con el usuario)
- `docs/DECISIONS.md` (DEC-009)

#### Instrucciones para Codex
Consultar la documentación oficial vigente de Mercado Pago sobre validación de firma (`x-signature`, `x-request-id`). Implementar la validación al inicio del handler `/webhook`, antes de cualquier consulta o actualización. El secreto debe provenir de una variable de entorno. Registrar únicamente el nombre de la variable faltante, nunca su valor. No incluir el secreto ni la firma completa en logs.

#### Criterios de aceptación
- Se valida `x-signature` y `x-request-id` según la documentación oficial vigente.
- Una firma inválida recibe una respuesta adecuada y no consulta ni actualiza pedidos.
- No se registran secretos ni la firma completa.
- Hay pruebas para firma válida, inválida y ausente.

#### Riesgos
- El secreto de validación es una nueva variable de entorno; agregarla a `.env.example` pero nunca al `.env` real en commits.
- Cambios en este flujo afectan directamente la seguridad del procesamiento de pagos.
- La documentación oficial puede actualizarse; verificar la versión vigente antes de implementar.

#### Resultado esperado
El endpoint `/webhook` rechaza eventos con firma inválida o ausente sin consultar ni actualizar pedidos.

---

### T-002 — Impedir preferencias sin pedido persistido

**Estado:** completada
**Prioridad:** P0

#### Objetivo
Garantizar que no se cree una preferencia de Mercado Pago si el pedido interno en Supabase no pudo ser registrado.

#### Archivos involucrados
- `index.js`
- Nuevo archivo de tests (si T-005 ya está en curso)

#### Instrucciones para Codex
En la función que crea la preferencia, envolver la inserción en Supabase con manejo de error que detenga la ejecución antes de llamar a Mercado Pago. Si la inserción falla, devolver un error HTTP genérico al cliente sin exponer mensajes internos del SDK ni de la base de datos.

#### Criterios de aceptación
- Un error al insertar en Supabase detiene la creación de la preferencia.
- El cliente recibe un error genérico, sin detalles sensibles.
- Existe una prueba que simula el fallo de persistencia.

#### Riesgos
- Cambio en el flujo crítico de creación de pagos.
- Un error de implementación puede hacer que ningún pago se procese.
- Probar en sandbox antes de cualquier entorno productivo.

#### Resultado esperado
No puede existir una preferencia de Mercado Pago sin un pedido correspondiente en Supabase.

---

### T-003 — Hacer atómica la transición a pagado

**Estado:** completada
**Prioridad:** P0

#### Objetivo
Impedir que webhooks concurrentes produzcan múltiples transiciones del pedido a `paid`.

#### Archivos involucrados
- `index.js`
- `docs/DECISIONS.md` (DEC-010 — documentar la estrategia elegida antes de implementar)
- Nuevo archivo de tests (si T-005 ya está en curso)

#### Instrucciones para Codex
Consultar DEC-010 antes de implementar. Modificar la actualización del estado del pedido para que use una operación condicional (`UPDATE ... WHERE status = 'pending'`). La idempotencia debe garantizarse también por `payment_id`. Documentar la estrategia en `docs/DECISIONS.md` antes de escribir código.

#### Criterios de aceptación
- La actualización exige que el estado siga siendo `pending`.
- Webhooks simultáneos no producen transiciones duplicadas.
- Se conserva idempotencia por referencia e ID de pago.
- La estrategia queda documentada en `docs/DECISIONS.md`.

#### Riesgos
- Cambio en la lógica central de pagos.
- Una implementación incorrecta puede impedir que pedidos legítimos se marquen como pagados.
- Requiere que DEC-010 esté definida y aprobada antes de proceder.

#### Resultado esperado
El pedido pasa a `paid` exactamente una vez, incluso bajo webhooks concurrentes.

---

### T-004 — Validar configuración al iniciar

**Estado:** completada
**Prioridad:** P0

#### Objetivo
Detectar variables de entorno faltantes antes de que la aplicación comience a aceptar tráfico.

#### Archivos involucrados
- `index.js`

#### Instrucciones para Codex
Antes del `app.listen`, verificar que `MERCADOPAGO_ACCESS_TOKEN`, `BASE_URL`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` estén presentes y no vacías. Si alguna falta, registrar únicamente su nombre y terminar el proceso con código de error diferente de cero. No mostrar ni registrar valores.

#### Criterios de aceptación
- El proceso identifica variables requeridas ausentes antes de aceptar tráfico.
- Los mensajes indican nombres, nunca valores.
- Se diferencia claramente configuración de desarrollo y producción.

#### Riesgos
- Bajo. El cambio ocurre en la inicialización, sin efecto en los flujos de pago.
- Verificar que el mensaje de error no exponga valores parciales interpolados.

#### Resultado esperado
El servidor no arranca si falta alguna variable de entorno requerida.

---

## P1 — Calidad y mantenibilidad

### T-005 — Agregar pruebas automatizadas del dominio de pagos

**Estado:** completada
**Prioridad:** P1

#### Objetivo
Cubrir el dominio de pagos con pruebas automáticas reproducibles que no realicen llamadas externas reales ni modifiquen datos de ninguna base de datos.

#### Framework recomendado

**Jest** (opción principal). Razón: `jest.mock()` permite reemplazar los módulos `@mercadopago/sdk-js` y `@supabase/supabase-js` a nivel de `require` sin necesidad de refactorizar `index.js` primero. Tiene soporte nativo para CommonJS, `jest.fn()` para spies y un runner integrado. Requiere `npm install --save-dev jest` y autorización del usuario para modificar `package.json`.

**`node:test` + `assert`** (alternativa sin dependencias nuevas). Disponible desde Node.js 18. No requiere cambios en `package.json` más allá del script `test`. Sin embargo, el mocking de módulos CommonJS es manual y requiere inyección de dependencias, lo que implica hacer T-009 antes. Recomendada solo si el usuario prefiere cero dependencias adicionales.

> Pendiente de confirmar con el usuario: ¿Jest o node:test?

#### Qué se debe testear

Los siguientes casos cubren todas las decisiones de seguridad implementadas (DEC-009, DEC-010) y los flujos críticos (T-001 a T-004):

**Inicialización:**
- TC-01: Proceso termina con error si falta una variable de entorno obligatoria.
- TC-02: Proceso termina con error si una variable de entorno está vacía.
- TC-03: Proceso arranca normalmente con todas las variables presentes.

**Creación de preferencia (`POST /crear-preferencia`):**
- TC-04: Falla de Supabase al insertar pedido → respuesta de error genérica al cliente; Mercado Pago no es llamado.

**Validación de firma del webhook (`POST /webhook`):**
- TC-05: Webhook sin header `x-signature` → responde HTTP 401 con mensaje genérico.
- TC-06: Webhook con firma inválida → responde HTTP 401 con mensaje genérico.
- TC-07: Webhook con firma válida → flujo continúa al procesamiento del pago.

**Procesamiento del pago:**
- TC-08: Pago `approved` con importe correcto → pedido actualizado a `paid`.
- TC-09: Pago `approved` con importe incorrecto → pedido no actualizado; respuesta sin detalles sensibles.
- TC-10: Pago con estado distinto de `approved` → pedido no actualizado.
- TC-11: Pago con `external_reference` ausente o sin pedido asociado → sin actualización; log genérico.
- TC-12: Pedido ya en estado `paid` (webhook duplicado) → tratado como idempotente; no produce error ni doble actualización.

**Atomicidad (DEC-010):**
- TC-13: Dos webhooks concurrentes para el mismo pedido → solo uno produce la actualización a `paid`; el otro recibe cero filas afectadas.

#### Qué NO se debe testear todavía

- Frontend HTML estático y comportamiento visual.
- Integración real con la API de Mercado Pago (sandbox o producción).
- Integración real con Supabase.
- Texto exacto de mensajes de log (puede cambiar sin afectar la lógica).
- Comportamiento de HTTPS, ngrok ni deploy.
- Flujos no implementados: reembolsos, cancelaciones, catálogo (T-007 a T-014).

#### Archivos involucrados
- `package.json` — agregar `jest` como dependencia de desarrollo y script `"test": "jest"`. **Requiere autorización explícita del usuario.**
- `test/payments.test.js` — archivo nuevo con los 13 casos de prueba.
- `index.js` — puede requerir refactor mínimo para inyección de dependencias si se usa `node:test`. Con Jest no es necesario.
- `README.md` y `docs/SKILLS.md` — documentar el comando una vez disponible.

#### Instrucciones para Codex
1. Esperar confirmación del usuario sobre el framework elegido y autorización para modificar `package.json`.
2. Crear `test/payments.test.js` con dobles de prueba para `@mercadopago/sdk-js` y `@supabase/supabase-js`.
3. No realizar llamadas reales. No cargar `.env`. No conectar a bases de datos ni APIs externas.
4. Implementar los 13 casos de prueba (TC-01 a TC-13) según las instrucciones de DEC-009 y DEC-010.
5. Los tests de TC-05 y TC-06 deben verificar que el cuerpo de la respuesta no exponga datos sensibles.
6. Los tests de TC-08 a TC-12 deben usar un doble de `Payment.get` que devuelva el estado simulado.
7. Documentar el comando en `README.md` y `docs/SKILLS.md` al finalizar.

#### Criterios de aceptación
- Los 13 casos de prueba (TC-01 a TC-13) pasan sin llamadas externas reales.
- Los dobles de Mercado Pago y Supabase reemplazan completamente los módulos reales.
- Ningún test carga `.env` ni accede a credenciales reales.
- Existe un comando documentado y reproducible (`npm test`).
- Los tests de firma (TC-05, TC-06) verifican que la respuesta no expone headers ni datos internos.
- El test de concurrencia (TC-13) demuestra que solo una actualización es efectiva.

#### Riesgos
- **Alto**: sin T-009 (separación de responsabilidades) puede ser difícil aislar la lógica de negocio del servidor Express. Con Jest esto es manejable; con `node:test` se vuelve complejo.
- **Requiere autorización**: modificar `package.json` e instalar Jest necesita aprobación explícita del usuario.
- **Orden de ejecución**: si se elige `node:test`, conviene hacer T-009 primero para facilitar la inyección de dependencias.
- Un test mal escrito que pase siempre o falle siempre puede dar una falsa sensación de cobertura.

#### Resultado esperado
Suite ejecutable con 13 casos que cubren todos los flujos críticos del dominio de pagos, sin dependencias externas reales y con un comando documentado.

---

### T-006 — Versionar el esquema de Supabase

**Estado:** completada
**Prioridad:** P1

#### Objetivo
Extraer el DDL de `orders` del README, completarlo con restricciones, índices y una política RLS mínima, y guardarlo como un archivo SQL versionado y revisable. No aplicar en ninguna base de datos sin autorización explícita del usuario.

#### Esquema actual de `orders` (fuente: `README.md`)

```sql
create table if not exists orders (
  id                    bigint generated by default as identity primary key,
  external_reference    text        not null unique,
  product_name          text        not null,
  quantity              integer     not null,
  amount                numeric     not null,
  currency              text        not null,
  status                text        not null default 'pending',
  mercadopago_payment_id text,
  mercadopago_status    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
```

Este DDL carece de restricciones de dominio, índices adicionales y políticas RLS.

#### Campos no editables desde cliente

Los siguientes campos solo deben ser modificados por el backend; ningún cliente público debe poder escribirlos directamente:

- `id`: generado automáticamente.
- `status`: solo el webhook puede cambiarlo de `pending` a `paid`.
- `mercadopago_payment_id`: solo el backend lo asigna al confirmar el pago.
- `mercadopago_status`: ídem.
- `created_at` y `updated_at`: gestionados por la base de datos o el backend.

#### Estados válidos del pedido

- `pending`: pedido creado, pago no confirmado.
- `paid`: pago confirmado por la API de Mercado Pago.
- Estados futuros (`refunded`, `cancelled`, `expired`, `failed`): definidos en DEC-015 pero no implementados todavía. **No agregar estos valores al CHECK constraint hasta que DEC-015 esté aceptada.**

#### Restricciones a agregar

- `CHECK (status IN ('pending', 'paid'))` — rechaza transiciones no autorizadas a nivel de base de datos.
- `CHECK (amount > 0)` — evita importes inválidos o negativos.
- `NOT NULL` y `UNIQUE` en `external_reference` — ya presentes; confirmar que se conserven.
- `NOT NULL` en `amount`, `currency`, `product_name`, `quantity` — ya presentes; confirmar.

#### Índices a agregar

- `external_reference` ya tiene índice implícito por su restricción `UNIQUE`. Confirmar que esté activo.
- Índice en `status` — facilita queries de monitoreo y administración (`WHERE status = 'pending'`).
- Índice en `mercadopago_payment_id` — facilita lookups de idempotencia por ID de pago de Mercado Pago.

#### Seguridad y RLS

- `SUPABASE_SERVICE_ROLE_KEY` debe usarse exclusivamente desde el backend. **Nunca exponer al frontend ni al navegador.**
- Si el frontend llegara a acceder directamente a Supabase, podría leer o modificar pedidos sin pasar por el backend.
- Habilitar RLS en `orders`.
- No crear policies para los roles `anon` ni `authenticated`: sin policy explícita, RLS bloquea el acceso público por defecto.
- No crear una policy inventada para `service_role`; dejar solo un comentario seguro indicando que el backend usa `SUPABASE_SERVICE_ROLE_KEY` y que esa clave nunca debe exponerse al frontend.

#### Versionado

- Crear `supabase/migrations/001_create_orders.sql` con el DDL completo: tabla, restricciones, índices y comentarios.
- **El archivo NO debe contener**: API keys, credenciales, `SUPABASE_SERVICE_ROLE_KEY`, datos reales de pedidos o pagos, ni valores de `.env`.
- DEC-012 define SQL manual versionado en `supabase/migrations/001_create_orders.sql`, sin Supabase CLI por ahora.
- No actualizar README en esta tarea salvo autorización explícita adicional o necesidad estricta.

#### Archivos involucrados
- `supabase/migrations/001_create_orders.sql` — archivo nuevo (DDL, restricciones, índices).
- `docs/TASKS.md` — marcar T-006 como completada si corresponde.
- `docs/PROGRESS.md` — registrar la ejecución de T-006.

#### Instrucciones para Codex
1. DEC-012 fue aceptada (2026-06-24): usar SQL manual en `supabase/migrations/001_create_orders.sql`. No se requiere Supabase CLI.
2. Extraer el DDL del `README.md` y completarlo con las restricciones e índices descritos arriba.
3. **No aplicar la migración en ninguna base de datos** (ni desarrollo compartido, ni producción) sin autorización explícita del usuario.
4. No incluir credenciales, claves ni valores de entorno en los archivos SQL.
5. No modificar `README.md` salvo autorización explícita adicional o necesidad estricta.

#### Criterios de aceptación
- Existe `supabase/migrations/001_create_orders.sql` con el DDL completo, restricciones e índices.
- El archivo no contiene credenciales, datos reales ni valores de `.env`.
- El CHECK constraint de `status` acepta `pending` y `paid`, y rechaza cualquier otro valor.
- El CHECK constraint de `amount` rechaza valores menores o iguales a cero.
- RLS está habilitada en `orders`.
- No existen policies para `anon` ni `authenticated` en la migración.
- El acceso con `service_role` queda documentado solo como comentario seguro de backend, sin abrir acceso público.
- La migración no ha sido aplicada sin autorización.

#### Riesgos
- **Alto**: aplicar la migración en una base de datos productiva o compartida sin validar puede destruir datos existentes si los tipos o restricciones son incompatibles.
- El CHECK constraint en `status` puede romper registros existentes con valores fuera del rango definido. Verificar antes de aplicar.
- DEC-015 define estados adicionales futuros; no anticiparlos en el CHECK constraint hasta que estén aceptados.
- DEC-012 aceptada: SQL manual en `supabase/migrations/`. No hay bloqueo por herramientas.

#### Resultado esperado
El esquema de `orders` está versionado en SQL, con restricciones de dominio, índices y RLS habilitada sin policies públicas, y puede revisarse y aplicarse de forma controlada en cualquier entorno.

> **Aplicada manualmente el 2026-06-25.** Tabla `public.orders` confirmada en Supabase: columnas (`id`, `external_reference`, `product_name`, `quantity`, `amount`, `currency`, `status`, `mercadopago_payment_id`, `mercadopago_status`, `created_at`, `updated_at`), constraints (`external_reference` unique, `amount > 0`, `status` en `pending`/`paid`), índices (`orders_status_idx`, `orders_mercadopago_payment_id_idx`) y RLS (`rowsecurity = true`) verificados. Sin policies para `anon` ni `authenticated`. Sin datos insertados.

---

### T-007 — Usar una estrategia monetaria explícita

**Estado:** completada
**Prioridad:** P1  
**DEC-011:** aceptada (2026-06-25). Esta tarea está desbloqueada.

#### Objetivo
Reemplazar la comparación de importes basada en `Number` por una función explícita que evite problemas de punto flotante, y agregar validación de moneda en el mismo bloque.

#### Archivos involucrados
- `index.js`
- `tests/index.test.js` (agregar casos de prueba de T-007)
- `docs/DECISIONS.md` (DEC-011 — ya aceptada)

#### Instrucciones para Codex

Consultar DEC-011 antes de implementar. Estrategia definida: sin dependencias nuevas.

**Paso 1 — Función de comparación de importes**

Crear una función nombrada en `index.js`:

```js
function importesCoinciden(a, b) {
  return Math.round(a * 100) === Math.round(b * 100);
}
```

**Paso 2 — Reemplazar la comparación actual**

Localizar en `index.js` la validación que compara `transaction_amount` del pago contra `amount` del pedido. Reemplazarla por:

```js
if (!importesCoinciden(payment.transaction_amount, order.amount)) {
  // log genérico sin valores reales
  return;
}
```

No registrar los valores reales en el log; solo un evento genérico como `"importe no coincide"`.

**Paso 3 — Validación de moneda**

En el mismo bloque de validación, después o antes de la comparación de importe, agregar:

```js
const MONEDA_ESPERADA = 'ARS';
if (payment.currency_id !== order.currency) {
  // log genérico: "moneda no coincide"
  return;
}
```

El campo `currency` del pedido en Supabase ya almacena `'ARS'`. No hardcodear la moneda en la comparación directamente; usar el campo del pedido.

**Paso 4 — Tests**

En `tests/index.test.js`, agregar casos de prueba para el webhook con:

- Importe exacto coincidente → pedido pasa a `paid`.
- Importe diferente (ej: 99.99 vs 100.00) → pedido no cambia.
- Importe con diferencia de centavo mínimo (ej: 100.001 vs 100.00) → pedido no cambia.
- Moneda incorrecta (ej: `USD` vs `ARS`) → pedido no cambia.
- Moneda correcta → flujo continúa.

No realizar llamadas externas reales. No cargar `.env`.

#### Criterios de aceptación
- Existe la función `importesCoinciden(a, b)` con lógica `Math.round(a * 100) === Math.round(b * 100)`.
- La comparación de importes en el webhook usa esa función.
- Se valida `payment.currency_id` contra `order.currency`; moneda incorrecta no produce actualización.
- Los logs emiten solo eventos genéricos sin valores de importe ni moneda.
- Los casos de prueba de T-007 pasan en `npm test`.
- No se instala ninguna dependencia nueva.

#### Riesgos
- Cambio en la validación de pagos; una implementación incorrecta puede rechazar pagos válidos.
- Verificar que `order.currency` esté correctamente recuperado de Supabase antes de comparar.
- Los casos de prueba deben cubrir valores con decimales para verificar que `Math.round` funciona como se espera.

#### Resultado esperado
La comparación de importes es explícita, encapsulada en una función nombrada, libre de errores de punto flotante y acompañada de validación de moneda. Los tests cubren los casos definidos en DEC-011.

> **Completada el 2026-06-25.** Se agregó `importesCoinciden(a, b)` en `index.js`, se valida `payment.currency_id` contra `order.currency`, el webhook usa logs genéricos en el flujo de pago y `tests/index.test.js` cubre importes normalizados, importes distintos, moneda distinta, moneda correcta y ausencia de valores reales de importe/moneda en logs. Verificación: `node --check index.js`, `npm.cmd test` (15 tests) y `git diff --check`.

---

### T-008 — Mejorar identificadores de pedidos

**Estado:** completada
**Prioridad:** P1

#### Objetivo
Reemplazar `LEMONT-ORDER-${Date.now()}` por una estrategia que garantice unicidad bajo concurrencia.

#### Archivos involucrados
- `index.js`

#### Instrucciones para Codex
Reemplazar la generación basada solo en timestamp por `crypto.randomUUID()` (disponible en Node.js nativo, sin dependencias adicionales) o una combinación de timestamp + sufijo aleatorio criptográficamente seguro. El prefijo `LEMONT-ORDER-` puede conservarse para trazabilidad. No incluir datos personales en la referencia. No usar `Math.random()` como única fuente.

#### Criterios de aceptación
- Las referencias no dependen únicamente de `Date.now()`.
- Mantienen unicidad bajo concurrencia.
- Continúan siendo trazables sin incluir datos personales.

#### Riesgos
- Bajo si se usa `crypto.randomUUID()` nativo.
- Verificar que el nuevo formato sea compatible con la restricción `UNIQUE` de Supabase.

#### Resultado esperado
Las referencias de pedidos son únicas bajo concurrencia sin depender exclusivamente del timestamp.

> **Completada el 2026-06-25.** La referencia de pedidos usa `LEMONT-ORDER-${crypto.randomUUID()}` con prefijo trazable y UUID nativo de Node.js. `tests/index.test.js` verifica prefijo, ausencia de dependencia exclusiva de `Date.now()` y referencias distintas para dos pedidos generados en el mismo instante. Verificación: `node --check index.js`, `npm.cmd test` (18 tests) y `git diff --check`.

---

### T-009 — Separar responsabilidades del backend

**Estado:** completada  
**Prioridad:** P1  
**Commit:** "Separa backend en modulos" — pusheado a `origin/main` el 2026-06-25.

#### Objetivo
Dividir `index.js` en módulos con responsabilidades claras, sin cambiar el comportamiento HTTP observable ni romper los tests existentes.

#### Estructura implementada

```
index.js                   # Entrypoint: carga config, crea app, arranca servidor
src/
  app.js                   # Instancia Express: middlewares, rutas, handlers
  config.js                # Lee y valida variables de entorno; exporta constantes
  logger.js                # Helper log(level, event, extra) — DEC-017
  payments.js              # createPreference, Payment.get — Mercado Pago
  orders.js                # createPendingOrder, markOrderAsPaid, cliente Supabase
  webhookSignature.js      # Validación HMAC-SHA256 de x-signature — DEC-009
```

#### Archivos creados / modificados
- `index.js` — reducido a entrypoint mínimo
- `src/app.js` — creado; Express, middlewares, rutas y handlers
- `src/config.js` — creado; valida y exporta configuración
- `src/logger.js` — creado; exporta el helper `log` de DEC-017
- `src/payments.js` — creado; encapsula Mercado Pago
- `src/orders.js` — creado; encapsula Supabase, pedidos, comparación de importes/moneda y transición `pending → paid`
- `src/webhookSignature.js` — creado; validación HMAC-SHA256

#### Verificaciones realizadas
- `node --check index.js` — sin errores de sintaxis.
- `node --check src/*.js` — sin errores de sintaxis en ningún módulo.
- `npm test` — 18 tests pasan. Comportamiento HTTP idéntico al anterior.
- `git diff --check` — sin problemas de espaciado.
- Búsqueda de `console.*` — solo queda dentro de `src/logger.js`.
- Búsqueda de secretos — solo nombres de variables, placeholders y documentación; sin valores reales.

#### Criterios de aceptación cumplidos
- Existen `src/app.js`, `src/config.js`, `src/logger.js`, `src/payments.js`, `src/orders.js` y `src/webhookSignature.js`.
- `index.js` es entrypoint mínimo.
- Comportamiento HTTP idéntico: mismas rutas, mismos códigos de respuesta, misma lógica de negocio.
- 18 tests pasan sin cambios en su lógica.
- Sin dependencias nuevas. Sin cambios en `package.json` ni `.env.example`.

#### Resultado
Backend modularizado. Cada módulo tiene una responsabilidad única y puede ser importado y testeado de forma independiente.

> **Completada el 2026-06-25.** `index.js` quedó como entrypoint mínimo y se crearon `src/app.js`, `src/config.js`, `src/logger.js`, `src/payments.js`, `src/orders.js` y `src/webhookSignature.js`. El refactor movió responsabilidades sin cambiar rutas, respuestas públicas, creación de preferencias, validación de firma, validación de importe/moneda, transición `pending → paid` ni eventos/campos de logs estructurados. Verificación: `node --check index.js`, `node --check src/*.js`, `npm.cmd test` (18 tests) y `git diff --check`.

---

## P2 — Operación y producto

### T-010 — Preparar observabilidad segura

**Estado:** pendiente  
**Prioridad:** P2  
**DEC-017:** aceptada (2026-06-25). Esta tarea está desbloqueada.

#### Objetivo
Reemplazar todos los `console.log` del backend por llamadas a un helper de log estructurado que garantice campos fijos, niveles definidos, correlación por request y ausencia de datos sensibles.

#### Archivos involucrados
- `index.js`
- `.env.example` (agregar `LOG_LEVEL=info`)
- `tests/index.test.js` (agregar casos de prueba de T-010)
- `docs/DECISIONS.md` (DEC-017 — ya aceptada)

#### Instrucciones para Codex

Consultar DEC-017 antes de implementar. Sin dependencias nuevas.

**Paso 1 — Crear el helper `log`**

Agregar al inicio de `index.js`, antes de cualquier uso:

```js
function log(level, event, extra = {}) {
  const entry = { level, event, timestamp: new Date().toISOString(), ...extra };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}
```

**Paso 2 — Reemplazar console.log existentes**

Recorrer cada `console.log`, `console.warn` y `console.error` en `index.js` y reemplazarlos por `log(level, event, { request_id, route, method, ...})`.

Reglas obligatorias al reemplazar:
- Usar `request_id` derivado de `x-request-id` (en webhook) o `crypto.randomUUID()` (en otros handlers), generado al inicio del handler.
- Incluir siempre `route` (ej: `'/webhook'`) y `method` (ej: `'POST'`).
- Nunca incluir valores de: `x-signature`, headers completos, body del webhook, payload de `Payment.get`, `transaction_amount`, `order.amount`, `external_reference`, credenciales.
- Para el estado del pago: usar `payment_status` con el valor genérico (ej: `payment.status`), solo si no expone dato sensible.
- Para errores de Supabase o MP: usar `error_type` con un nombre de categoría (ej: `'supabase_error'`), nunca el mensaje completo del SDK.

Ejemplos de eventos genéricos válidos:
- `"firma de webhook ausente"`, `"firma de webhook inválida"`, `"pago no aprobado"`, `"importe no coincide"`, `"moneda no coincide"`, `"pedido no encontrado"`, `"webhook duplicado ignorado"`, `"pedido actualizado a pagado"`, `"preferencia creada"`, `"pedido persistido"`, `"error al persistir pedido"`.

**Paso 3 — Agregar LOG_LEVEL a .env.example**

Agregar la línea:
```
LOG_LEVEL=info
```

El helper puede leer `process.env.LOG_LEVEL` para decidir si emitir logs de nivel `debug` en desarrollo. En producción, debe ser `info` o superior.

**Paso 4 — Tests**

En `tests/index.test.js`, agregar al menos:
- Que en el flujo de firma ausente o inválida, ningún log incluye el valor del header `x-signature`.
- Que en el flujo de importe no coincide, ningún log incluye valores de importe real.
- Que el log emitido en el flujo exitoso contiene `level`, `event` y `request_id`.

No realizar llamadas externas reales. No cargar `.env`.

#### Criterios de aceptación
- Existe la función `log(level, event, extra)` en `index.js`.
- Todos los `console.log`, `console.warn` y `console.error` directos fueron reemplazados por llamadas a `log`.
- Cada log incluye `level`, `event`, `request_id`, `route`, `method` y `timestamp`.
- Ningún log contiene: valores de credenciales, `x-signature`, headers completos, body del webhook, payload completo de MP, `transaction_amount`, `external_reference` ni datos personales.
- `.env.example` incluye `LOG_LEVEL=info`.
- Los tests de T-010 verifican ausencia de campos prohibidos en flujos críticos y pasan en `npm test`.
- No se instala ninguna dependencia nueva.

#### Riesgos
- Reemplazar un `console.log` que registraba información útil de debugging puede dificultar la resolución de incidentes; documentar en el evento qué ocurrió de forma genérica.
- Si quedan `console.log` directos sin reemplazar, los campos prohibidos pueden volver a aparecer. Buscar con grep todos los `console.` antes de marcar la tarea como completada.
- Un error en el helper (por ejemplo, serialización de objetos circulares) puede silenciar logs. Verificar con un caso básico antes de desplegar.

#### Resultado esperado
Los logs del backend son objetos JSON estructurados, con niveles explícitos, correlación por `request_id` y sin campos sensibles en ningún flujo.

> **Completada el 2026-06-25.** Se agregó el helper `log(level, event, extra)` en `index.js`, todos los `console.*` directos quedaron restringidos al helper, los logs se emiten como JSON con `level`, `event`, `request_id`, `route`, `method` y `timestamp`, y `.env.example` incluye `LOG_LEVEL=info`. `tests/index.test.js` verifica estructura mínima, uso de `x-request-id` como correlación y ausencia de campos prohibidos como `x-signature`, importes y `external_reference`. Verificación: `node --check index.js`, `npm.cmd test` (18 tests), `Select-String -Path index.js -Pattern "console\\."` y `git diff --check`.

---

### T-011 — Retirar herramientas temporales de producción

**Estado:** completada
**Prioridad:** P2

#### Objetivo
Eliminar o restringir la ruta `GET /webhook` y otros elementos de diagnóstico para que no estén disponibles en producción.

#### Archivos involucrados
- `index.js`

#### Instrucciones para Codex
Eliminar o condicionar la ruta `GET /webhook` a `NODE_ENV !== 'production'`. Revisar si existen otros endpoints o mensajes de diagnóstico que no deberían estar disponibles en producción. Verificar que el comportamiento de desarrollo siga documentado en `docs/SKILLS.md`.

#### Criterios de aceptación
- `GET /webhook` está ausente o restringido fuera de desarrollo.
- Los mensajes y detalles de diagnóstico no se exponen al cliente.
- El comportamiento de desarrollo sigue documentado.

#### Riesgos
- Bajo. Verificar que ningún test o script existente dependa de esa ruta.
- Asegurarse de que la condición por `NODE_ENV` esté bien evaluada.

#### Resultado esperado
Las herramientas de diagnóstico no están expuestas en entornos productivos.

> **Completada el 2026-06-25.** `GET /webhook` queda registrado solo cuando `NODE_ENV !== "production"` y conserva `{ received: true }` en entornos no productivos. En producción no se registra la ruta GET; `POST /webhook` permanece disponible y sin cambios. `tests/index.test.js` verifica comportamiento en `test`, `development` y `production`. Verificación: `node --check src/app.js`, `npm.cmd test` (22 tests), `git diff --check` y revisión de `git diff`.

---

### T-012 — Definir catálogo y fuente de precios

**Estado:** pendiente  
**Prioridad:** P2

#### Objetivo
Reemplazar el producto hardcodeado en `index.js` por una fuente autoritativa del servidor.

#### Archivos involucrados
- `index.js`
- `docs/DECISIONS.md` (DEC-013)
- Posible nuevo módulo de catálogo o tabla en Supabase (a definir)

#### Instrucciones para Codex
Pendiente de confirmar con el usuario: ¿el catálogo se define en código (objeto de configuración), en Supabase o en otro servicio? El servidor debe seguir siendo la fuente autoritativa del precio. No implementar hasta tener definición clara de la fuente y DEC-013 aprobada.

#### Criterios de aceptación
- Producto y precio provienen de una fuente autoritativa del servidor.
- El cliente no puede fijar libremente el importe.
- Se documentan stock, moneda y validaciones.

#### Riesgos
- Requiere decisión del usuario sobre la arquitectura del catálogo.
- Si se usa Supabase como catálogo, requiere nueva tabla y posible migración.
- No implementar sin DEC-013 definida y aprobada.

#### Resultado esperado
El producto y precio no están hardcodeados; provienen de una fuente configurable y controlada por el servidor.

---

### T-013 — Documentar y validar deploy

**Estado:** pendiente  
**Prioridad:** P2

#### Objetivo
Definir y documentar el proceso completo de despliegue a producción con entornos separados y rollback.

#### Archivos involucrados
- `docs/SKILLS.md`
- `README.md`
- `docs/DECISIONS.md` (DEC-016)
- Posibles archivos de configuración de deploy (Dockerfile, Procfile, etc.; a definir)

#### Instrucciones para Codex
Pendiente de confirmar con el usuario: proveedor de hosting (Railway, Render, Fly.io, VPS u otro). Una vez definido, documentar build, inicio, HTTPS, variables de entorno en producción y procedimiento de rollback. No ejecutar ningún deploy sin autorización explícita.

#### Criterios de aceptación
- Se selecciona un proveedor y se documentan build, inicio, HTTPS y variables requeridas.
- Se define un entorno de prueba separado de producción.
- Se verifica el webhook con una URL estable sin exponer secretos.
- Existe un procedimiento de rollback.

#### Riesgos
- No ejecutar ningún deploy sin autorización explícita del usuario.
- No reutilizar credenciales de desarrollo en producción.
- Requiere que DEC-016 esté definida y aprobada.

#### Resultado esperado
Existe documentación clara y probada para desplegar la aplicación con entornos separados y rollback definido.

---

### T-014 — Corregir codificación de mensajes

**Estado:** completada
**Prioridad:** P2

#### Objetivo
Asegurar que el mensaje de error para JSON inválido se muestre correctamente en UTF-8.

#### Archivos involucrados
- `index.js`
- Nuevo test de regresión (si T-005 ya está en curso)

#### Instrucciones para Codex
Localizar el middleware o handler que devuelve la respuesta 400 para JSON inválido. Verificar el header `Content-Type` de la respuesta e incluir `; charset=utf-8` si no está presente. No cambiar el código de estado ni el contrato de la respuesta. Agregar una prueba de regresión.

#### Criterios de aceptación
- El mensaje de JSON inválido se muestra correctamente en UTF-8.
- No cambian el código de estado ni el contrato de la respuesta.
- Se agrega una prueba de regresión.

#### Riesgos
- Mínimo. Cambio cosmético en un mensaje de error.
- Verificar que el cambio no afecte otros endpoints que devuelvan errores 400.

#### Resultado esperado
El error de JSON inválido se muestra con codificación UTF-8 correcta.

> **Completada el 2026-06-25.** El middleware de error de `src/app.js` mantiene HTTP `400` y el body `{ error: "JSON inválido" }`, agregando `Content-Type: application/json; charset=utf-8` antes de responder. `tests/index.test.js` incorpora una regresión que verifica status, body y charset UTF-8. Verificación: `node --check src/app.js`, `npm.cmd test` (19 tests), `git diff --check` y revisión de `git diff`.
