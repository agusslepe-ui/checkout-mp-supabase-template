# Decisiones técnicas

Este registro distingue decisiones observadas en el código de decisiones todavía pendientes. Las alternativas indicadas como inferidas deben confirmarse antes de rediseñar el sistema.

---

## D-001 Usar Checkout Pro

- Estado: vigente.
- Decisión: redirigir al comprador al checkout alojado por Mercado Pago.
- Motivo inferido: reducir el alcance del frontend y delegar la experiencia de pago al proveedor.
- Alternativas: Checkout API o una integración personalizada.
- Consecuencia: el sistema depende de preferencias, retornos y webhooks de Mercado Pago.

## D-002 Confirmar pagos desde el backend

- Estado: vigente.
- Decisión: consultar `Payment.get` ante un webhook y usar esa respuesta para confirmar el estado.
- Motivo: no confiar únicamente en el cuerpo recibido ni en la redirección del comprador.
- Alternativas: confiar en el evento o el retorno, descartadas por menor integridad.
- Pendiente: añadir validación criptográfica del webhook (ver DEC-009).

## D-003 Correlacionar mediante `external_reference`

- Estado: vigente.
- Decisión: guardar la misma referencia en el pedido y la preferencia.
- Motivo: relacionar el pago externo con el pedido interno sin depender solo del `payment_id`.
- Alternativas: tabla de relaciones por ID de preferencia o pago.
- Implementación: T-008 completada (2026-06-25). La referencia conserva el prefijo `LEMONT-ORDER-` y usa `crypto.randomUUID()` para evitar depender solo del tiempo.

## D-004 Persistir un pedido antes del checkout

- Estado: vigente.
- Decisión: crear el pedido en estado `pending` antes de crear la preferencia.
- Motivo: disponer de una entidad interna que pueda conciliarse posteriormente.
- Implementación: T-002 completada (2026-06-24). Si la inserción en Supabase falla, el flujo se detiene y Mercado Pago no es llamado.

## D-005 Mantener producto y precio en backend

- Estado: vigente para la demostración.
- Decisión: definir producto, cantidad, importe y moneda en el servidor.
- Motivo: impedir que el navegador sea la fuente autoritativa del importe.
- Alternativas: catálogo en base de datos o servicio de productos.
- Pendiente: elegir una fuente de catálogo real (ver DEC-013).

## D-006 Usar Supabase con clave de servicio

- Estado: vigente.
- Decisión: acceder a `orders` desde el backend con `SUPABASE_SERVICE_ROLE_KEY`.
- Motivo inferido: simplificar el prototipo y mantener la credencial fuera del navegador.
- Alternativas: cliente autenticado con RLS, API propia sobre otra base o funciones de Supabase.
- Consecuencia: una exposición de la clave tiene impacto elevado; deben revisarse permisos y RLS.

## D-007 Servir frontend y API desde Express

- Estado: vigente.
- Decisión: usar un único proceso para archivos estáticos, rutas y webhook.
- Motivo inferido: simplicidad operativa del prototipo.
- Alternativas: frontend y backend desplegados por separado.

## D-008 Usar JavaScript, CommonJS y frontend sin framework

- Estado: vigente.
- Motivo inferido: mantener la plantilla pequeña y con pocas herramientas.
- Alternativas: ES modules, TypeScript o framework frontend.
- Revisión: no necesaria hasta que la complejidad o requisitos de tipado lo justifiquen.

---

## Decisiones pendientes

Las siguientes decisiones se registraron inicialmente como pendientes. Cada una conserva el estado `pendiente` hasta que el usuario la defina y apruebe.

---

## DEC-009 — Estrategia de validación de firma del webhook

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
El endpoint `/webhook` acepta eventos sin validar la firma criptográfica. La consulta posterior a Mercado Pago reduce el riesgo, pero no sustituye la validación requerida. Mercado Pago provee los headers `x-signature` y `x-request-id` para esta verificación.

### Decisión

- El secreto de validación debe obtenerse exclusivamente de la variable de entorno `MERCADO_PAGO_WEBHOOK_SECRET`.
- Si la firma del webhook es inválida, el servidor debe responder HTTP `401`.
- Si la firma está ausente, el servidor también debe responder HTTP `401`.
- En ambos casos, la respuesta debe ser genérica: `Webhook inválido`.
- No se deben exponer secretos, firmas completas, headers sensibles ni detalles internos en respuestas o logs.
- Los logs solo pueden registrar eventos genéricos como `firma de webhook ausente` o `firma de webhook inválida`.

La implementación debe seguir el algoritmo oficial vigente de Mercado Pago y validar la firma antes de consultar pagos o actualizar pedidos.

### Motivo
Sin validación criptográfica, cualquier cliente puede enviar una notificación falsa que dispare consultas a la API de Mercado Pago o actualizaciones de pedidos. La validación es una precondición de seguridad, no una mejora opcional.

### Alternativas consideradas
- Confiar únicamente en la consulta posterior a `Payment.get` sin validar la firma: reduce el riesgo pero no elimina el procesamiento innecesario ante notificaciones falsas. Descartada.
- Responder HTTP `400` en lugar de `401` para firma inválida o ausente: semánticamente menos preciso; `401` indica falla de autenticación, que es el caso exacto. Descartada.
- Registrar la firma o los headers de autenticación completos para debugging: descartada por política de seguridad. Los logs solo deben registrar eventos genéricos sin valores sensibles.

### Consecuencias
- Relacionada con T-001.
- Requiere agregar `MERCADO_PAGO_WEBHOOK_SECRET` al contrato de configuración (`.env.example`), sin incluir ningún valor real.
- T-001 queda desbloqueada.

---

## DEC-010 — Mecanismo atómico para la transición de estado a pagado

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
La lectura del pedido y su actualización son operaciones separadas. Dos webhooks concurrentes pueden superar la comprobación de estado antes de que uno de ellos complete la actualización. Mercado Pago puede enviar más de un webhook para el mismo pago.

### Decisión

- La transición a `paid` se ejecuta solo si el estado actual del pedido es `pending`. Si la actualización no afecta ninguna fila, el pedido ya transicionó; el webhook se trata como duplicado idempotente sin interrumpir el flujo.
- Si el pedido no existe, no se crea un pedido nuevo; se registra un log genérico y se responde sin error catastrófico al cliente.
- Si el importe del pago no coincide con el del pedido, no se marca como `paid`.
- Si el estado del pago consultado a Mercado Pago no es `approved`, no se marca como `paid`.
- No se exponen secretos, firmas completas, headers sensibles ni datos internos en logs ni en respuestas al cliente.
- La estrategia se implementa desde el backend usando la API de Supabase; no requiere dependencias adicionales ni funciones SQL personalizadas.

### Motivo
Una actualización no condicional permite que dos webhooks concurrentes lean el estado `pending`, ambos lo superen y ambos ejecuten la transición a `paid`. La condición `WHERE status = 'pending'` convierte la operación en atómica a nivel de fila en Supabase/PostgreSQL: solo uno puede completar la actualización; el otro recibe cero filas afectadas y lo trata como duplicado.

### Alternativas consideradas
- Usar una función SQL de Supabase con lógica transaccional explícita: más control, pero agrega complejidad de infraestructura y requiere permisos adicionales. Descartada para esta etapa.
- Usar un lock a nivel de aplicación (mutex en memoria): no funciona con múltiples instancias del servidor. Descartada.
- Confiar en `payment_id` como única garantía de idempotencia sin condición de estado: no previene la carrera entre dos webhooks antes de la primera actualización. Descartada como garantía única.

### Consecuencias
- Relacionada con T-003.
- La actualización condicional garantiza idempotencia sin dependencias adicionales.
- T-003 queda desbloqueada.

---

## DEC-011 — Representación de importes y reglas de redondeo

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto
La comparación de importes usa `Number`, lo que puede producir errores de precisión con valores decimales. El importe actual es 100 ARS (sin decimales), pero el catálogo puede crecer hacia precios con centavos. Mercado Pago devuelve `transaction_amount` como decimal en la unidad principal de la moneda (pesos ARS). El campo `amount` en Supabase está definido como `numeric` y almacena pesos.

### Decisión

**1. Formato interno recomendado para importes**

Los importes circulan en la unidad principal de la moneda (pesos ARS) entre el backend, la base de datos y Mercado Pago. La conversión a centavos enteros ocurre exclusivamente en el momento de comparación, usando `Math.round(importe * 100)`. No se usa una representación en centavos como convención global del sistema.

**2. Esquema de Supabase: sin migración en esta etapa**

La columna `amount numeric` de la migración ya aplicada conserva su tipo y semántica actual (valor en pesos, ej: `100` para 100 ARS). No se requiere migración a `amount_cents integer`. Si el catálogo crece y se detecta necesidad de mayor control, una migración futura puede reconsiderarse como decisión separada.

**3. Conversión a Mercado Pago**

El precio del producto se pasa como `unit_price` en pesos (ej: `100`). Mercado Pago espera y devuelve importes en la unidad principal de la moneda; no se convierte a centavos al construir la preferencia ni al leer el pago.

**4. Comparación de transaction_amount contra el pedido**

La comparación usa enteros en centavos en ambos lados:

```js
Math.round(payment.transaction_amount * 100) === Math.round(order.amount * 100)
```

Si no coinciden, el pedido no pasa a `paid`. Esta función debe encapsularse como una utilidad nombrada en `index.js` para que sea fácil de testear y auditar.

**5. Manejo de moneda**

La moneda esperada se define exclusivamente en el backend (constante `'ARS'`). Al procesar el webhook, se valida que `payment.currency_id` coincida con la moneda registrada en el pedido. Si no coincide, el pedido no pasa a `paid`.

**6. Logs permitidos**

- Permitido: eventos genéricos como `"importe no coincide"`, `"moneda no coincide"`, `"pago no aprobado"`.
- No permitido: valores reales de importe (`transaction_amount`, `order.amount`), identificadores de moneda, `external_reference` ni datos del pago en texto libre.

**7. Tareas desbloqueadas**

T-007.

**8. Riesgos del punto flotante sin control**

En JavaScript, `0.1 + 0.2 === 0.3` devuelve `false`. Una comparación directa con `===` sobre valores decimales puede rechazar pagos válidos o aprobar importes erróneos cuando los valores difieren en fracciones de centavo por representación binaria. La multiplicación por 100 seguida de `Math.round` elimina este riesgo para valores con hasta dos decimales, que es el caso de ARS y de Checkout Pro.

### Motivo
No se requieren nuevas dependencias. La estrategia de multiplicación por 100 y comparación entera es suficiente para pagos con hasta dos decimales, no requiere autorización adicional de paquetes y es fácil de auditar y testear. `decimal.js` u otras librerías están justificadas solo si el proyecto maneja múltiples monedas o más de dos decimales significativos.

### Alternativas consideradas
- Usar `decimal.js` u otra librería de aritmética decimal: más robusta para múltiples monedas o más de dos decimales, pero requiere autorización de instalación y agrega una dependencia. Descartada por complejidad innecesaria para ARS en esta etapa.
- Comparar directamente con `===` usando `Number`: riesgo conocido de fallos con decimales. Descartada.
- Cambiar `amount` en Supabase a `amount_cents integer` y almacenar centavos: requiere nueva migración, cambio de convención en el backend y ajuste del valor enviado a Mercado Pago. Descartada para esta etapa; puede reconsiderarse si el catálogo crece.

### Consecuencias
- Relacionada con T-007.
- Codex debe encapsular la comparación en una función nombrada (ej: `importesCoinciden(a, b)`) y usarla al procesar el webhook.
- La validación de moneda debe agregarse en el mismo bloque de validación del importe.
- Los tests de T-007 deben cubrir: importe exacto, importe con diferencia mínima (ej: 99.99 vs 100.00), decimales (ej: 99.995 redondeado), moneda incorrecta y moneda correcta.
- Los logs del bloque de validación deben emitir solo eventos genéricos sin valores reales.
- T-007 queda desbloqueada.

---

## DEC-012 — Esquema versionado de Supabase: restricciones, índices y RLS

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
El esquema de `orders` existe solo como DDL en el README. No hay migraciones versionadas, índices documentados ni política RLS definida. La clave `service_role` puede evitar controles de RLS según la configuración.

### Decisión

- Usar archivos SQL manuales versionados; no se adopta Supabase CLI en esta etapa.
- El archivo de migración será `supabase/migrations/001_create_orders.sql`.
- Codex crea el archivo SQL en el repositorio; el usuario lo aplica manualmente en Supabase cuando corresponda.
- El archivo debe contener: DDL de `orders`, restricciones de dominio, índices y política RLS mínima.
- El archivo no debe contener: credenciales, API keys, datos reales ni valores de variables de entorno.
- Si el proyecto crece, se puede adoptar Supabase CLI en una decisión futura sin conflicto.

### Motivo
El proyecto es pequeño y controlado. No se requieren herramientas adicionales en esta etapa. Un archivo SQL revisable en el repositorio es suficiente para versionar el esquema y permite que el usuario lo aplique de forma controlada en el momento que elija.

### Alternativas consideradas
- Supabase CLI (`supabase migration new`, `supabase db diff`): más automatizado y genera diffs, pero requiere instalar y configurar la herramienta localmente. Descartada para esta etapa; puede reconsiderarse si el proyecto escala.

### Consecuencias
- Relacionada con T-006.
- Codex puede crear `supabase/migrations/001_create_orders.sql` directamente sin herramientas adicionales.
- El usuario es responsable de revisar y aplicar el archivo en Supabase de forma manual; Codex no ejecuta ningún comando de base de datos.
- No aplicar en base compartida o productiva sin autorización explícita.
- T-006 queda desbloqueada.

---

## DEC-013 — Fuente de catálogo, stock y precios

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto

El producto (Remera LEMONT, 1 unidad, 100 ARS) está definido directamente en el código de `src/app.js`. Esta definición no proviene de ninguna fuente configurable ni validada externamente. El problema central de seguridad es que si el frontend tuviera algún mecanismo para influir sobre el importe final, un usuario malicioso podría enviar un precio arbitrario y provocar un cobro incorrecto.

El flujo actual ya protege el importe en la etapa de confirmación (DEC-011/T-007): compara `transaction_amount` del pago contra `order.amount` almacenado en Supabase. Sin embargo, `order.amount` se origina hoy en valores hardcodeados. Si esa constante no está aislada en una fuente autoritativa, el modelo de seguridad queda incompleto: el importe en el pedido podría quedar desincronizado con cualquier lógica futura que resuelva el precio.

### Decisión

**Catálogo como módulo de configuración versionado en el servidor (`src/catalog.js`).**

El catálogo se define como un objeto JavaScript en un archivo `src/catalog.js` dedicado. El backend lee el catálogo al resolver cada pedido y calcula el importe final. El frontend solo envía el identificador del producto (`sku`) y la cantidad (`quantity`). El backend no acepta un importe enviado por el cliente.

**Estructura mínima del catálogo:**

```js
// src/catalog.js
const CATALOG = {
  'REMERA-LEMONT-001': {
    name: 'Remera LEMONT',
    unitPrice: 100,
    currency: 'ARS',
    maxQuantity: 10,
  },
};

function getProduct(sku) {
  return CATALOG[sku] || null;
}

module.exports = { getProduct };
```

**Reglas de validación en el handler `POST /crear-preferencia`:**

1. El cliente envía `{ sku, quantity }`. No envía `price`, `amount` ni `currency`.
2. El backend resuelve el producto con `getProduct(sku)`.
3. Si el SKU no existe → respuesta genérica HTTP 400. No exponer detalles del catálogo.
4. `quantity` debe ser un entero entre 1 y `product.maxQuantity` inclusive. Fuera de rango → HTTP 400.
5. El backend calcula: `total = product.unitPrice * quantity`.
6. El campo `amount` del pedido en Supabase se almacena como `product.unitPrice * quantity` (en pesos ARS).
7. La moneda del pedido proviene de `product.currency`, no del cliente.
8. Mercado Pago recibe `unit_price: product.unitPrice`, `quantity`, `title: product.name` y `currency_id: product.currency`.

**Estrategia de migración futura:**

Esta estructura es reemplazable en el futuro por una tabla `products` en Supabase sin cambiar el contrato del handler. La firma de `getProduct(sku)` puede mantenerse aunque la fuente cambie. Cuando el proyecto crezca, se puede crear DEC-018 para formalizar esa migración.

### Motivo

- Un módulo `src/catalog.js` en código es suficiente para esta etapa: el proyecto tiene un producto y no requiere panel de administración ni base de datos adicional.
- Centralizar la definición en un módulo dedicado aísla el catálogo del resto de la lógica de pagos, facilita los tests unitarios y hace explícito el contrato del servidor.
- No requiere nuevas dependencias, nuevas tablas en Supabase ni cambios en `.env.example`.
- La validación de `sku` y `quantity` en el handler protege el sistema ante solicitudes malformadas o manipuladas.
- El importe calculado en backend es la continuación coherente de la política ya implementada en DEC-011: el servidor siempre es fuente de verdad del importe.

### Alternativas consideradas

- **Tabla `products` en Supabase**: flexible y administrable sin redeploy, pero agrega una nueva tabla, una nueva migración (DEC-018 futura), queries adicionales en el flujo crítico de pago y superficie de error. Descartada para esta etapa; puede adoptarse si el catálogo crece.
- **Servicio externo o CMS**: mayor separación de responsabilidades, pero introduce dependencia externa en el flujo de pago. Una caída del CMS podría bloquear la creación de preferencias. Descartada por complejidad innecesaria en esta etapa.
- **Mantener hardcoding distribuido en `src/app.js` sin módulo dedicado**: simple pero no aislable, no testeable de forma independiente y dificulta la migración futura. Descartada.

### Consecuencias

- Relacionada con T-012.
- Codex debe crear `src/catalog.js` con la estructura definida.
- Codex debe modificar el handler `POST /crear-preferencia` en `src/app.js` para aceptar `{ sku, quantity }` y calcular el importe desde el catálogo.
- Codex debe agregar tests en `tests/index.test.js` para: SKU inválido, cantidad fuera de rango, cantidad válida con precio calculado correctamente.
- No se acepta `amount` enviado por el cliente en ningún endpoint.
- La validación de importe en el webhook (DEC-011) sigue vigente e inalterada.
- T-012 queda desbloqueada.

---

## DEC-014 — Autenticación y autorización de compradores u operadores

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
No existe autenticación ni usuario administrador. El flujo actual es completamente anónimo para el comprador. Si el proyecto escala, se necesitará identificar compradores o restringir acceso a operadores.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Mantener flujo anónimo (solo para demostración técnica).
- Autenticación de compradores con Supabase Auth.
- Panel administrativo con acceso restringido por rol.
- Autenticación externa (OAuth, magic link, etc.).

### Consecuencias
- El alcance de esta decisión puede afectar el esquema de `orders`, los requisitos y el diseño general.
- No implementar hasta tener definición de usuarios y objetivo comercial real (ver `docs/REQUIREMENTS.md`).

---

## DEC-015 — Reembolsos, cancelaciones, expiración y conciliación

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
Solo existe la transición `pending → paid`. No hay estados adicionales ni procesos definidos para reembolsos, cancelaciones, pagos expirados o conciliación periódica.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Definir estados adicionales: `refunded`, `cancelled`, `expired`, `failed`.
- Definir reglas de transición entre estados.
- Integrar la API de reembolsos de Mercado Pago.
- Definir proceso de conciliación periódica (reconciliación entre Supabase y Mercado Pago).

### Consecuencias
- Afecta el esquema de la tabla `orders` y el documento de requisitos.
- No implementar hasta definir los casos de negocio reales.

---

## DEC-016 — Proveedor de despliegue, entornos y rollback

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto

El backend está completo, seguro y cubierto con 29 tests. No existía configuración de despliegue documentada. El proyecto usa ngrok para desarrollo local, pero no tiene infraestructura de staging ni producción definida. El objetivo es llegar a un primer deploy funcional en staging antes de cualquier uso con dinero real.

El proyecto es una plantilla reutilizable de backend. La primera instancia se despliega como staging sobre la infraestructura EasyPanel/VPS existente del usuario, usando Mercado Pago sandbox y el mismo proyecto Supabase actual.

### Decisión

**El primer entorno será staging en EasyPanel sobre el VPS actual del usuario.**

1. **Plataforma**: EasyPanel sobre el VPS ya creado y preparado por el usuario.
2. **URL pública**: usar la URL HTTPS gratuita generada por EasyPanel para el servicio. El dominio `lemont01.com` existe pero queda fuera del alcance inmediato hasta que sea recuperado y localizado.
3. **`NODE_ENV`**: establecer `NODE_ENV=production` desde el primer despliegue, incluso en staging. Esto activa el comportamiento correcto del servidor (por ejemplo, `GET /webhook` no disponible) y valida el entorno real antes de cualquier uso con dinero real.
4. **`BASE_URL`**: la URL HTTPS pública asignada por EasyPanel, sin barra final ni ruta adicional. Ejemplo de formato: `https://mi-servicio.easypanel.host`. Este valor se usa en `notification_url` de la preferencia y en las `back_urls`.
5. **Mercado Pago**: usar credenciales sandbox para el entorno staging. El `MERCADOPAGO_ACCESS_TOKEN` en EasyPanel debe ser el token de prueba, no el real.
6. **Webhook sandbox**: configurar manualmente en el panel de desarrolladores de Mercado Pago la URL `{BASE_URL}/webhook` como destino de notificaciones para el ambiente sandbox. Esta configuración es manual y queda como tarea pendiente del usuario; sin ella el webhook no llegará al servidor.
7. **Supabase**: usar el mismo proyecto Supabase actual. La tabla `orders` ya está creada, verificada y con RLS activo. No se requiere nueva migración ni nuevo proyecto de Supabase.
8. **Variables de entorno**: cargarse exclusivamente en EasyPanel. Nunca en el repositorio ni en archivos versionados. El `.env` real queda ignorado por Git.
9. **Frontend**: el frontend mínimo actual se sigue sirviendo desde el mismo proceso Express, mediante `public/`. Sin cambios en esta arquitectura.
10. **Producción real**: queda fuera del alcance inmediato. Solo se considera después de pasar la checklist de staging completa y la checklist explícita de producción definida en esta decisión.

### Variables obligatorias en EasyPanel

Solo nombres; nunca cargar valores reales en documentación, código, commits ni mensajes.

| Variable | Propósito |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Token de prueba (sandbox) de Mercado Pago. Exclusivo del backend. |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Secreto para validar firma HMAC-SHA256 del webhook. Exclusivo del backend. |
| `BASE_URL` | URL HTTPS pública de EasyPanel, sin barra final ni ruta. |
| `SUPABASE_URL` | URL del proyecto Supabase actual. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privilegiada de Supabase. Exclusiva del backend. **Nunca exponer al frontend ni al navegador.** |
| `LOG_LEVEL` | Nivel de logs estructurados. Usar `info` en staging y producción. |
| `NODE_ENV` | Establecer `production` para activar comportamiento correcto del servidor. |

### Reglas de seguridad

- **`.env` real**: debe permanecer ignorado por Git (`.gitignore`). Nunca subir valores al repositorio.
- **`.env.example`**: visible en el repositorio como plantilla con nombres y valores vacíos o ficticios. Sin secretos reales.
- **`SUPABASE_SERVICE_ROLE_KEY`**: uso exclusivo desde el backend Node.js. Nunca exponer en código servido al navegador, variables de entorno de cliente, archivos bajo `public/` ni en `index.html`.
- **Variables en EasyPanel**: configurarlas desde el panel de EasyPanel, una sola vez por entorno. No compartirlas por mensajes, documentos ni capturas de pantalla.
- **Rotación ante exposición**: si una variable queda expuesta, revocar y rotar inmediatamente desde el proveedor. Ver `docs/SECURITY.md`.

### Checklist de staging

Ejecutar en orden. Todos los ítems deben estar verificados antes de considerar el staging validado.

1. Variables cargadas en EasyPanel según la lista de variables obligatorias de esta decisión.
2. Servicio arranca sin errores (log inicial sin mensajes de variable faltante).
3. Abrir la URL HTTPS pública de EasyPanel → el frontend carga correctamente.
4. `POST /crear-preferencia` con `{ "sku": "REMERA-LEMONT-001", "quantity": 1 }` → responde con `preference_id` y una URL de checkout.
5. Supabase muestra un pedido con `status = 'pending'` y la referencia `LEMONT-ORDER-...` correcta.
6. Redirección al checkout de Mercado Pago sandbox funciona.
7. Completar el pago en el ambiente sandbox de Mercado Pago usando credenciales de prueba.
8. Mercado Pago llama a `POST /webhook` en la URL HTTPS pública (requiere webhook sandbox configurado manualmente).
9. Supabase muestra el pedido con `status = 'paid'`.
10. `GET /webhook` devuelve 404 (confirma que `NODE_ENV=production` está activo).
11. Logs del servicio en EasyPanel muestran JSON estructurado sin campos sensibles visibles.

### Checklist previa a producción real

No pasar a producción real sin completar todos los ítems:

1. Los 11 ítems de la checklist de staging están verificados y documentados.
2. `MERCADOPAGO_ACCESS_TOKEN` real (no sandbox) disponible y sin exposición previa.
3. `MERCADO_PAGO_WEBHOOK_SECRET` para producción generado y configurado en EasyPanel y en el panel de Mercado Pago.
4. Webhook de producción registrado: URL `{BASE_URL}/webhook` configurada en la cuenta de Mercado Pago real.
5. `BASE_URL` apunta a una URL HTTPS estable que no cambia entre reinicios del servicio.
6. Si se usa `lemont01.com`: dominio recuperado, DNS apuntando al VPS y HTTPS activo antes de registrar el webhook.
7. Variables actualizadas en EasyPanel: token sandbox reemplazado por token real; `BASE_URL` actualizada si el dominio cambió.
8. RLS de Supabase verificado: sin policies para `anon` ni `authenticated`.
9. Sin secretos en el repositorio: revisar `git log` y `git diff` antes de cualquier push.
10. Prueba con pago real mínimo verificada: flujo completo con tarjeta real y monto mínimo antes de publicar.
11. Plan de rollback conocido por el usuario y ejecutable sin asistencia.

### Estrategia de rollback

En orden de preferencia, del menor al mayor impacto:

1. **Variable incorrecta o faltante**: corregir el valor en EasyPanel y reiniciar el servicio. Sin afectar código ni datos.
2. **Problema al pasar a producción real**: revertir `MERCADOPAGO_ACCESS_TOKEN` al token sandbox en EasyPanel y reiniciar. El flujo vuelve a sandbox sin pérdida de pedidos.
3. **Fallo grave del servicio** (crash, error no controlado): pausar o detener el servicio en EasyPanel para evitar tráfico. Investigar logs en EasyPanel, corregir y reiniciar.
4. **Error de código** (bug en un commit reciente): identificar el commit problemático con `git log`, revertir a la versión anterior en GitHub y redesplegar desde EasyPanel. Aplicar solo si el problema no se resuelve con configuración.

No eliminar filas de Supabase como parte del rollback salvo autorización explícita del usuario.

### Alternativas consideradas

- **Railway, Render o Fly.io**: PaaS con deploy desde GitHub más automatizado, pero el usuario ya tiene VPS y EasyPanel configurados. Descartadas por complejidad innecesaria y costo adicional.
- **Docker/Dockerfile**: mayor control y portabilidad, pero agrega complejidad de configuración. Descartado para esta etapa; puede adoptarse en una decisión futura si el proyecto escala.
- **Proyecto Supabase separado para staging**: más aislamiento entre entornos, pero requiere crear un segundo proyecto y migrar el esquema. Descartado; el proyecto actual ya tiene la tabla y RLS verificados, y staging con sandbox no tiene riesgo de contaminar datos reales.

### Qué implementa T-013

- Actualizar `docs/SKILLS.md`: reemplazar la sección de deploy genérica por pasos concretos de staging en EasyPanel.
- Actualizar `README.md`: corregir secciones desactualizadas (base de datos, limitaciones) y agregar referencia al proceso de deploy.
- No se requieren cambios en código JavaScript.
- No se requieren nuevas dependencias.
- El deploy real lo ejecuta el usuario siguiendo la checklist de staging de esta decisión.

### Qué queda fuera del alcance de T-013

- Configurar el webhook sandbox en el panel de Mercado Pago (manual; responsabilidad del usuario).
- Recuperar o redirigir el dominio `lemont01.com`.
- Configurar HTTPS con dominio propio.
- Pasar a producción real con credenciales reales.
- Autenticación de compradores o panel administrativo.
- CI/CD automatizado.
- Infraestructura como código (Terraform, Ansible, etc.).

### Consecuencias

- Relacionada con T-013.
- Codex actualiza `docs/SKILLS.md` y `README.md` con la documentación de staging.
- El deploy real lo ejecuta el usuario siguiendo la checklist de staging.
- No se realizan cambios en código JavaScript ni en la lógica de pagos.
- T-013 queda desbloqueada.

---

## DEC-017 — Formato, destino y política de retención de logs

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto
Los logs actuales usan `console.log` con diferentes niveles de detalle, incluyendo campos del webhook y del pago. No hay estructura, correlación ni política de retención definida. El backend ya tiene validación de firma, comparación de importes y transición atómica; los logs de esos flujos deben revisarse para eliminar campos sensibles antes de crecer más.

### Decisión

**1. Librería externa o logging propio**

No se instala librería externa. Se usa un helper propio `log(level, event, extra)` que serializa un objeto JSON con `console.log`, `console.warn` o `console.error` según el nivel. Sin dependencias nuevas, sin cambios en `package.json`.

Estructura del helper (referencia para Codex):

```js
function log(level, event, extra = {}) {
  const entry = { level, event, timestamp: new Date().toISOString(), ...extra };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}
```

Uso: `log('warn', 'importe no coincide', { request_id, route: '/webhook', method: 'POST' })`

**2. Formato mínimo de log**

Todos los logs emiten un objeto JSON con al menos estos campos:

```json
{
  "level": "info",
  "event": "descripción genérica",
  "request_id": "uuid-o-x-request-id",
  "route": "/webhook",
  "method": "POST",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

`status_code` se agrega únicamente cuando la respuesta HTTP ya fue determinada y es relevante para el evento.

**3. Niveles permitidos**

- `info`: flujo normal completado (pedido creado, pago procesado correctamente, webhook duplicado ignorado sin error).
- `warn`: situación esperada pero rechazada (firma ausente, firma inválida, importe no coincide, moneda no coincide, pago no aprobado, pedido no encontrado).
- `error`: fallo inesperado (Supabase no responde, MP no responde, excepción no controlada).

**4. Campos permitidos**

Siempre presentes: `level`, `event`, `request_id`, `route`, `method`, `timestamp`.

Opcionales según contexto:
- `status_code` — código HTTP de la respuesta (ej: `401`, `200`).
- `payment_status` — estado genérico del pago (ej: `"approved"`, `"pending"`). Solo el estado, sin ID ni importes.
- `order_status` — estado genérico del pedido (ej: `"pending"`, `"paid"`).
- `error_type` — categoría del error (ej: `"supabase_error"`, `"mp_api_error"`). Sin detalles internos del SDK.

**5. Campos prohibidos en todos los logs**

- Valores de cualquier variable de entorno (`MERCADO_PAGO_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `MERCADO_PAGO_WEBHOOK_SECRET`, etc.).
- Header `x-signature` completo ni parcial.
- Headers completos de requests o responses.
- Body completo del webhook recibido.
- Payload completo de `Payment.get` (incluyendo datos personales del comprador: email, nombre, documento).
- Valores reales de importes (`transaction_amount`, `order.amount`).
- Valor de `external_reference`.
- IDs internos de Supabase.
- Datos personales del comprador.

**6. Estrategia de correlación (request_id)**

- En `POST /webhook`: usar el header `x-request-id` de Mercado Pago si está presente; si no, generar `crypto.randomUUID()`.
- En otros endpoints (`POST /crear-preferencia`, `GET /`): generar `crypto.randomUUID()` al inicio del handler.
- El `request_id` se propaga como campo a todos los logs del mismo request.
- `x-request-id` se usa solo como correlator; nunca se loguea su valor fuera de este campo `request_id`.

**7. Política de retención**

- Los logs se emiten a `stdout` (captura del proveedor de hosting).
- No retener logs en archivos locales ni en Supabase.
- En producción: configurar retención máxima de 30 días en el proveedor. Los logs de `warn` y `error` pueden retenerse hasta 90 días para auditoría.
- No reutilizar logs de desarrollo en producción.
- Si el proveedor de hosting captura logs automáticamente, revisar su política de privacidad antes de poner en producción.

**8. Verbosidad adicional de forma segura**

- Variable de entorno opcional: `LOG_LEVEL` (valores: `debug`, `info`, `warn`, `error`). Valor por defecto: `info`.
- En desarrollo local, `LOG_LEVEL=debug` puede activar logs adicionales de flujo (por ejemplo, confirmar que se entró al handler del webhook).
- Los logs de nivel `debug` **nunca** pueden incluir campos prohibidos listados en el punto 5.
- Agregar `LOG_LEVEL=info` a `.env.example`.
- En producción, `LOG_LEVEL` debe ser `info` o superior.

**9. Tareas desbloqueadas**

T-010.

**10. Riesgos de logs inseguros**

- Exposición de `SUPABASE_SERVICE_ROLE_KEY` o `MERCADO_PAGO_ACCESS_TOKEN` en logs → acceso no autorizado a la base de datos o a la cuenta de Mercado Pago.
- Exposición del header `x-signature` completo → permite a un atacante con acceso a los logs construir firmas válidas y falsificar webhooks.
- Exposición del body completo del webhook → puede incluir datos personales del comprador (nombre, email, número de documento).
- Exposición de `transaction_amount` y `external_reference` → permite enumerar pedidos y montos; riesgo de privacidad y reconocimiento.
- Logs persistidos sin límite de retención → acumulación de datos sensibles históricos con riesgo ante brechas futuras.

### Motivo
No se requieren dependencias nuevas. Un helper propio que serializa JSON es suficiente para estructurar logs y aplicar la lista de campos prohibidos de forma controlada. Las librerías como `pino` o `winston` aportan valor en proyectos más grandes o con múltiples destinos; pueden adoptarse en una decisión futura si la observabilidad lo justifica.

### Alternativas consideradas
- Usar `pino` o `winston`: más funcionalidad (transports, niveles configurables, redacción automática), pero agrega dependencia y configuración. Descartada para esta etapa; puede reconsiderarse si el proyecto crece o se adopta un servicio externo de logs.
- Destino externo (Datadog, Logtail, etc.): relevante solo si el proveedor de hosting no captura stdout adecuadamente. Descartada sin proveedor de deploy definido (ver DEC-016).
- Mantener `console.log` sin estructura: no permite filtrado, correlación ni auditoría. Descartada.

### Consecuencias
- Relacionada con T-010.
- Codex debe crear la función `log(level, event, extra)` en `index.js` y reemplazar todos los `console.log` existentes por llamadas a esa función.
- Agregar `LOG_LEVEL=info` a `.env.example`.
- Los tests de T-010 deben verificar que ningún log emite campos prohibidos en los flujos críticos (webhook, creación de preferencia).
- Cualquier log en producción debe cumplir con la política de privacidad vigente.
- T-010 queda desbloqueada.

---

## DEC-018 — Estrategia para verificar y probar el flujo de webhook con firma válida

**Fecha:** 2026-06-26
**Estado:** resuelta

### Contexto

El diagnóstico técnico avanzado de la sesión 2026-06-26 descartó la infraestructura (Traefik/EasyPanel) y la implementación HMAC como causas del `POST /webhook` retornando 401 en staging. Hechos confirmados del diagnóstico:

- La simulación desde el panel de Webhooks de Mercado Pago valida firma correctamente.
- Los webhooks reales sandbox enviados por `notification_url` con credenciales de prueba llegan con firma inválida.
- El SDK oficial (`WebhookSignatureValidator` de `mercadopago` v3.1.0) también rechaza esas firmas.
- Traefik/EasyPanel preserva `x-request-id` (descartado como causa).
- Sin `notification_url` en la preferencia no llegan webhooks útiles con `data.id`.

**Respuesta de soporte/consulta técnica de Mercado Pago (2026-06-26):**

1. El Webhook Secret se genera en "Tus integraciones" y es por aplicación y por modo (pruebas vs productivo).
2. `notification_url` en la preferencia tiene prioridad sobre la URL del panel para esa transacción. No es un conflicto, pero manda para esa transacción.
3. **Confirmado**: los pagos de prueba con credenciales de prueba no envían notificaciones reales. La vía recomendada para testear recepción en sandbox es la simulación desde "Tus integraciones".
4. Para construir el manifiesto HMAC, `data.id` debe tomarse desde query params; en la documentación se denomina `data.id_url`.
5. Si falta algún valor del template del manifiesto, debe excluirse antes de calcular el HMAC, no incluirse como cadena vacía.
6. Verificar que el secret corresponda al mismo modo: pruebas o productivo.
7. No desactivar la validación de firma.

**Consecuencia del punto 3**: el 401 observado en staging con credenciales de prueba puede ser comportamiento esperado del sandbox de Mercado Pago, no un bug de implementación. La simulación del panel valida correctamente porque es la vía oficial de prueba.

**Puntos técnicos pendientes de verificación** (identificados en puntos 4 y 5 de la respuesta de soporte):
- (a) ¿En `src/webhookSignature.js`, `data.id` se lee de los query params del request con la denominación correcta? Los logs muestran `signature_data_source="query_data_id"` pero el nombre del campo en el template puede diferir de lo esperado por MP.
- (b) ¿Si algún campo del template del manifiesto no está presente en el request, se excluye antes del HMAC? Si se incluye como cadena vacía, el manifiesto calculado no coincidirá con el esperado.

Estos dos puntos deben verificarse antes de cualquier prueba productiva.

La validación de firma (DEC-009) está activa. No se debe modificar ni desactivar sin que esta decisión esté aceptada.

### Opciones a evaluar

**Prerequisito para Opción A:** antes de la prueba productiva, Codex debe revisar los dos puntos técnicos del HMAC descritos arriba en `src/webhookSignature.js`. Si se detecta un error, corregirlo y registrar en DECISIONS.md antes de hacer commit.

**Opción A — Verificación técnica + prueba productiva controlada:**
1. Codex revisa los dos puntos técnicos (data.id_url y exclusión de valores faltantes) en `src/webhookSignature.js`.
2. Si se detecta diferencia respecto a la documentación oficial, corregir y deployar.
3. Usar credenciales productivas reales con un pago real mínimo controlado, manteniendo la validación de firma activa.
- Requiere: rotación previa de credenciales de prueba expuestas; checklist previa a producción de DEC-016 completada; pago real mínimo controlado.
- Riesgo: implica dinero real. No usar si la checklist de DEC-016 no está completa.

**Opción B — Solo simulación del panel (sandbox suficiente):**
Aceptar que sandbox con credenciales de prueba no envía webhooks firmados reales (confirmado por soporte) y validar el flujo completo exclusivamente mediante la simulación desde "Tus integraciones". No hacer prueba productiva en esta etapa.
- Ventaja: no implica dinero real; la simulación del panel ya valida.
- Riesgo: no confirma el flujo con pago real; la producción real puede tener diferencias.

**Opción C — Estrategia alternativa de validación (alto riesgo; solo si A y B no son viables):**
Modificar el flujo de `POST /webhook` para que, ante firma inválida, realice una consulta directa a la API de Mercado Pago para validar el pago por estado, importe y referencia.
- Riesgo alto: debilita la seguridad implementada en DEC-009. No implementar en producción sin acotar el alcance explícitamente.
- Requiere que esta DEC esté aceptada y que el alcance esté definido antes de cualquier modificación de código.
- No recomendado como primera opción.

### Restricción vigente

No modificar la validación de firma (DEC-009) ni ningún archivo de código hasta que esta DEC esté aceptada. Claude Code no prepara tareas de código para ninguna opción sin confirmación explícita del usuario.

### Resolución (2026-06-26)

**Opción ejecutada:** Opción A — verificación técnica + prueba productiva controlada.

**Causa raíz principal identificada:** la `notification_url` de la preferencia no incluía el parámetro `?source_news=webhooks`. Sin ese parámetro, Mercado Pago envía notificaciones de tipo IPN en lugar de Webhooks. Las notificaciones IPN usan un mecanismo de firma diferente al HMAC-SHA256 configurado en "Tus integraciones". El backend rechazaba correctamente las firmas IPN con HTTP 401 porque no corresponden al algoritmo de Webhook. La simulación del panel siempre envía Webhooks (firma correcta) porque usa directamente el mecanismo de Webhooks, razón por la cual el panel siempre validaba y los webhooks reales de sandbox no.

**Causa raíz adicional (frontend):** el frontend priorizaba `sandbox_init_point` sobre `init_point` en el retorno de la preferencia creada. Esto podía enviar el checkout al ambiente sandbox aunque se estuviera intentando realizar una compra productiva. Corregido priorizando `init_point` para el flujo de checkout productivo (commit `04c8112`).

**Solución aplicada (Codex):** se agregó `?source_news=webhooks` a la `notification_url` de la preferencia en `src/app.js`. Esto fuerza a Mercado Pago a enviar exclusivamente notificaciones de tipo Webhook con firma HMAC-SHA256 válida.

**Resultado verificado en producción real (2026-06-26):**
1. `POST /crear-preferencia` creó preferencia con `notification_url` correcta.
2. Pedido creado en Supabase con `status = 'pending'`.
3. Pago real realizado en Mercado Pago Checkout Pro.
4. Webhook recibido en `POST /webhook` con firma HMAC-SHA256 válida.
5. Firma validada correctamente con `MERCADO_PAGO_WEBHOOK_SECRET` productivo.
6. Pago consultado a la API de Mercado Pago y confirmado como aprobado.
7. Pedido actualizado a `status = 'paid'` en Supabase.

**Pendientes al cierre:**
- Rotar credenciales productivas expuestas en capturas/chats (ver `docs/SECURITY.md`).
- Confirmar que `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` está desactivada en EasyPanel.
- Retirar código de diagnóstico temporal de `src/webhookSignature.js`, `src/app.js` y `src/config.js` (tarea para Codex).
