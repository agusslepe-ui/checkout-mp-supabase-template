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

**Estado:** pendiente  
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

**Estado:** pendiente  
**Prioridad:** P1

#### Objetivo
Cubrir el dominio de pagos con pruebas automáticas reproducibles que no realicen llamadas externas reales.

#### Archivos involucrados
- Nuevo archivo de tests (nombre y ubicación a definir con el usuario)
- `index.js` (puede requerir refactor previo según T-009)
- `package.json` (agregar script `test` y dependencia del framework; requiere autorización)
- `README.md` y `docs/SKILLS.md` (documentar el comando una vez disponible)

#### Instrucciones para Codex
Pendiente de confirmar con el usuario: framework de testing (Jest, Mocha, Vitest u otro). Una vez definido y autorizado, implementar dobles de prueba para Mercado Pago y Supabase. No realizar llamadas reales. Cubrir los casos listados en los criterios de aceptación. Documentar el comando en `README.md` y `docs/SKILLS.md`.

#### Criterios de aceptación
- Se cubren pago aprobado, no aprobado, referencia ausente, pedido inexistente, monto diferente y webhook duplicado.
- Mercado Pago y Supabase se sustituyen por dobles de prueba; no hay llamadas reales.
- Existe un comando documentado y reproducible.

#### Riesgos
- Requiere autorización para modificar `package.json` e instalar dependencias.
- T-009 (separación de responsabilidades) facilita esta tarea; considerar el orden de ejecución.
- Sin refactor previo, los tests pueden ser difíciles de aislar.

#### Resultado esperado
Suite ejecutable que cubre los casos críticos del dominio de pagos sin dependencias externas.

---

### T-006 — Versionar el esquema de Supabase

**Estado:** pendiente  
**Prioridad:** P1

#### Objetivo
Expresar el esquema de la tabla `orders` como un archivo de migración revisable y versionado.

#### Archivos involucrados
- Nuevo archivo SQL de migración (ej: `supabase/migrations/001_create_orders.sql`)
- `README.md` (actualizar referencia al esquema una vez versionado)
- `docs/DECISIONS.md` (DEC-012)

#### Instrucciones para Codex
Extraer el DDL del `README.md` y convertirlo en un archivo de migración. Agregar índices sobre `external_reference` y `status`, restricciones necesarias y una política RLS recomendada. No aplicar en ninguna base de datos sin autorización explícita del usuario.

#### Criterios de aceptación
- El esquema `orders` se expresa como migración revisable.
- Se documentan índices, restricciones y políticas RLS.
- La migración se prueba primero en un entorno no productivo.
- No se modifica una base compartida sin autorización explícita.

#### Riesgos
- No ejecutar la migración sin autorización del usuario.
- Coordinar con el usuario cualquier cambio al esquema en producción.
- Verificar que el DDL sea compatible con la versión de Supabase/PostgreSQL en uso.

#### Resultado esperado
El esquema de `orders` está versionado y puede revisarse y aplicarse de forma controlada.

---

### T-007 — Usar una estrategia monetaria explícita

**Estado:** pendiente  
**Prioridad:** P1

#### Objetivo
Reemplazar la comparación de importes basada en `Number` por una estrategia que evite problemas de punto flotante.

#### Archivos involucrados
- `index.js`
- `docs/DECISIONS.md` (DEC-011)
- Nuevo archivo de tests (si T-005 ya existe)

#### Instrucciones para Codex
Consultar DEC-011 antes de implementar. Opción sin nueva dependencia: comparar importes como enteros en centavos multiplicando por 100 y usando comparación entera. Si se opta por una librería como `decimal.js`, requiere autorización para instalar. Documentar la unidad y reglas de redondeo elegidas en `docs/DECISIONS.md`.

#### Criterios de aceptación
- Los importes se comparan sin depender de igualdad de punto flotante.
- La unidad y reglas de redondeo están documentadas.
- Hay pruebas para decimales y límites relevantes.

#### Riesgos
- Cambio en la validación de pagos; una implementación incorrecta puede rechazar pagos válidos.
- Requiere que DEC-011 esté definida y aprobada.
- Si se usa una librería externa, requiere autorización adicional.

#### Resultado esperado
La comparación de importes es explícita, documentada y libre de errores de punto flotante.

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
