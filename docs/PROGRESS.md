# Progreso

Última revisión documental: 2026-06-24.

## Estado actual

El proyecto contiene un flujo demostrativo completo para una Remera LEMONT: interfaz estática, creación de preferencias de Checkout Pro, persistencia inicial en Supabase, recepción de webhooks, consulta del pago a Mercado Pago y actualización del pedido a `paid`.

La revisión fue documental y de solo lectura. No se ejecutó la aplicación, no se realizaron pagos y no se validó el comportamiento contra servicios externos.

## Avances detectados

- Servidor Express y frontend estático implementados.
- Producto de prueba y botón de pago disponibles.
- Pedido `pending` asociado mediante `external_reference`.
- Preferencia con webhook y tres URLs de retorno.
- Extracción flexible de tipo de evento e ID de pago.
- Confirmación del pago mediante consulta a la API.
- Validación básica de pedido existente, duplicado e importe.
- Actualización a `paid` con metadatos de Mercado Pago.
- Manejo específico de JSON inválido.
- `.env` ignorado y `.env.example` disponible como contrato.
- Documentación base para colaboración con agentes creada.

## Problemas resueltos documentados

- Uso de variables de entorno para credenciales.
- URL pública de desarrollo mediante ngrok.
- Separación entre páginas de retorno y confirmación autoritativa.
- Asociación de pagos y pedidos mediante referencia externa.
- Consulta a Mercado Pago en lugar de confiar únicamente en el webhook.
- Tratamiento básico de notificaciones duplicadas y montos diferentes.

## Pendientes principales

- Validar la firma del webhook.
- Detener la preferencia si falla la creación del pedido.
- Hacer atómica la transición `pending` a `paid`.
- Agregar pruebas automatizadas.
- Versionar esquema, restricciones y políticas de Supabase.
- Definir una estrategia monetaria segura.
- Validar configuración al iniciar.
- Reducir logs sensibles y retirar diagnóstico temporal de producción.
- Definir catálogo, autenticación y requisitos comerciales.
- Seleccionar y documentar un despliegue de producción.

El detalle verificable está en `docs/TASKS.md`.

## Próxima acción recomendada

Las cuatro tareas P0 (T-001 a T-004) son el trabajo más urgente. La primera en abordar es **T-001** (validación de firma del webhook), pero requiere que el usuario confirme primero **DEC-009** (estrategia de validación y nombre de la nueva variable de entorno). Sin esa decisión, Codex no puede implementar de forma segura.

Orden sugerido para Codex:
1. Confirmar DEC-009 → implementar T-001.
2. Confirmar DEC-010 → implementar T-003.
3. Implementar T-004 (no bloquea ninguna decisión pendiente).

## Bitácora

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
