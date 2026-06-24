# Guía para agentes de IA

Este archivo define el contrato de trabajo para Codex, Claude y otros agentes que colaboren en el repositorio. Ante una instrucción del usuario que contradiga estas reglas, detenerse, señalar el conflicto y solicitar autorización explícita.

## Lectura obligatoria

Antes de proponer o realizar cambios, leer en este orden:

1. `README.md`.
2. `docs/REQUIREMENTS.md`.
3. `docs/DESIGN.md`.
4. `docs/SECURITY.md`.
5. `docs/DECISIONS.md`.
6. `docs/TASKS.md` y `docs/PROGRESS.md`.
7. Los archivos de código directamente relacionados con la tarea.

No asumir que la documentación está actualizada: contrastarla con el código y registrar cualquier diferencia.

## Archivos protegidos

No modificar sin autorización explícita:

- `.env`, cualquier variante `.env.*` con valores reales y archivos de credenciales.
- Claves privadas, certificados, tokens o secretos de cualquier tipo.
- `package-lock.json`, dependencias o scripts de `package.json`.
- Configuración de producción, CI/CD, hosting, DNS o base de datos.
- Esquemas, migraciones o datos de Supabase.
- Configuración de Mercado Pago y URLs públicas.

Nunca leer, imprimir, copiar, resumir ni incluir secretos en prompts, logs, documentación, parches o commits. Se puede consultar `.env.example` únicamente como contrato de nombres.

## Propuesta de cambios

Antes de implementar:

1. Resumir el estado observado.
2. Explicar el cambio, los archivos afectados y los riesgos.
3. Identificar supuestos e información faltante.
4. Dividir el trabajo en unidades pequeñas y verificables.
5. Pedir autorización cuando el cambio afecte pagos, secretos, base de datos, autenticación, deploy o dependencias.

No ampliar el alcance silenciosamente. Si aparece un problema ajeno a la tarea, documentarlo como pendiente.

## Ejecución de tareas pequeñas

- Trabajar sobre una sola tarea de `docs/TASKS.md` cuando sea posible.
- Inspeccionar primero y conservar cambios existentes del usuario.
- Cambiar el mínimo número de archivos.
- No instalar dependencias ni ejecutar acciones destructivas sin autorización.
- Ejecutar solo verificaciones proporcionales al cambio.
- No realizar pagos reales ni usar credenciales de producción durante pruebas.
- Mostrar al final archivos modificados, comprobaciones realizadas y riesgos restantes.
- No hacer commit, push ni deploy salvo pedido explícito.

## Actualización de progreso

Después de una tarea completada:

1. Actualizar el estado correspondiente en `docs/TASKS.md`.
2. Actualizar `docs/PROGRESS.md` con avance, verificaciones y pendientes.
3. Agregar una entrada a la bitácora con fecha, objetivo, archivos afectados y resultado.
4. Si se tomó una decisión relevante, registrarla en `docs/DECISIONS.md`.
5. Si cambió el comportamiento, actualizar también requisitos, diseño, seguridad o README según corresponda.

No declarar una tarea terminada sin comprobar sus criterios de aceptación.

## Secretos y `.env`

- `.env` es local, sensible y no debe versionarse.
- `.env.example` solo enumera variables con valores vacíos o claramente ficticios.
- Usar variables de entorno exclusivamente en backend.
- Nunca exponer `MERCADOPAGO_ACCESS_TOKEN` ni `SUPABASE_SERVICE_ROLE_KEY` al navegador.
- Si se detecta un secreto versionado o expuesto, no reproducirlo: avisar al usuario y recomendar su rotación inmediata.
- Las validaciones pueden comprobar presencia o formato, pero nunca registrar el valor.

## Definición de tarea terminada

Una tarea está terminada cuando su alcance fue respetado, sus criterios de aceptación fueron verificados, la documentación relacionada quedó coherente y se comunicaron claramente las limitaciones restantes.

