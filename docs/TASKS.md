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

**Estado:** pendiente  
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

---

### T-009 — Separar responsabilidades del backend

**Estado:** pendiente  
**Prioridad:** P1

#### Objetivo
Dividir `index.js` en módulos con responsabilidades claras: rutas, integración de pagos y persistencia.

#### Archivos involucrados
- `index.js` (refactor)
- Nuevos módulos (estructura a confirmar con el usuario, ej: `routes/`, `services/`, `db/`)
- `docs/DESIGN.md` (actualizar descripción de módulos)

#### Instrucciones para Codex
Pendiente de confirmar con el usuario: estructura de módulos deseada. El refactor debe conservar el comportamiento HTTP existente sin cambiar el contrato de las rutas. Recomendado realizarlo después de T-005 para poder verificar que el comportamiento no cambió.

#### Criterios de aceptación
- Rutas, integración de pagos y persistencia tienen límites claros.
- El comportamiento HTTP existente se conserva.
- Las unidades pueden probarse sin iniciar el servidor.

#### Riesgos
- Refactor de alto impacto sin cobertura de tests automáticos.
- Sin T-005, es difícil verificar que el comportamiento se conservó.
- Requiere decisión del usuario sobre la estructura de módulos.

#### Resultado esperado
El backend tiene módulos separados y testables sin necesidad de levantar el servidor completo.

---

## P2 — Operación y producto

### T-010 — Preparar observabilidad segura

**Estado:** pendiente  
**Prioridad:** P2

#### Objetivo
Estructurar los logs para que tengan niveles, correlación y no incluyan información sensible.

#### Archivos involucrados
- `index.js`
- `docs/DECISIONS.md` (DEC-017)
- Posible librería de logging estructurado (requiere autorización para instalar)

#### Instrucciones para Codex
Revisar todos los `console.log` actuales. Reemplazar los que registren cuerpos completos de webhooks o campos sensibles por logs con nivel (info, warn, error) y un identificador de correlación por request. No registrar valores de credenciales, datos personales ni payloads completos. Si se introduce una librería (ej: `pino`, `winston`), requiere autorización.

#### Criterios de aceptación
- Los logs tienen estructura, niveles y un identificador de correlación.
- No contienen cuerpos completos de webhooks, credenciales ni datos sensibles innecesarios.
- Se define una política de retención.

#### Riesgos
- Si se agrega una librería externa, requiere autorización para modificar `package.json`.
- Reducción de logs puede dificultar debugging; documentar cómo activar más verbosidad de forma segura.

#### Resultado esperado
Los logs son estructurados, con niveles, con correlación y sin información sensible innecesaria.

---

### T-011 — Retirar herramientas temporales de producción

**Estado:** pendiente  
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

**Estado:** pendiente  
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
