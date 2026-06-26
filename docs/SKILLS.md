# Procedimientos del proyecto

Los comandos son ejemplos operativos. Antes de ejecutarlos, confirmar el entorno y evitar credenciales o pagos de producción.

## Preparar el entorno local

1. Confirmar que existe `.env.example` y que no contiene valores reales.
2. Crear `.env` localmente sin copiar su contenido a conversaciones o commits.
3. Completar las cuatro variables requeridas desde fuentes seguras.
4. Instalar dependencias solo con autorización y cuando sea necesario.

```powershell
npm.cmd install
```

## Iniciar la aplicación

```powershell
npm.cmd run dev
```

Abrir `http://localhost:3003`.

## Exponer webhooks en desarrollo

```powershell
ngrok http 3003
```

Usar el origen HTTPS como `BASE_URL`, sin agregar `/webhook`, y reiniciar el servidor. La URL gratuita puede cambiar entre sesiones.

## Probar la creación de una preferencia

Usar únicamente credenciales de prueba:

```powershell
curl.exe -X POST http://localhost:3003/crear-preferencia -H "Content-Type: application/json" -d "{\"sku\":\"REMERA-LEMONT-001\",\"quantity\":1}"
```

Verificar que la respuesta contenga un identificador y una URL de checkout, y que Supabase tenga un pedido `pending` con la misma referencia. No publicar la respuesta completa si contiene identificadores operativos.

## Probar la recepción del webhook

```powershell
curl.exe -X POST "http://localhost:3003/webhook?id=123456789&topic=payment" -H "Content-Type: application/json" -d "{\"resource\":\"123456789\",\"topic\":\"payment\"}"
```

El ID es ilustrativo. La recepción puede comprobarse, pero la consulta a Mercado Pago fallará si no corresponde a un pago real de la cuenta de prueba. No inventar una aprobación ni alterar pedidos manualmente para simularla.

En entornos no productivos también puede comprobarse que el servidor responde al diagnóstico `GET /webhook`. Esta ruta no se registra cuando `NODE_ENV=production`; en producción solo debe usarse `POST /webhook` para eventos de Mercado Pago.

## Comprobar retornos visuales

```text
http://localhost:3003/success
http://localhost:3003/failure
http://localhost:3003/pending
```

Estas páginas solo representan el retorno del navegador; no confirman el estado autoritativo del pedido.

## Probar funcionalidades de forma segura

- Utilizar sandbox o credenciales de prueba.
- No realizar cobros reales.
- No apuntar pruebas a una base de producción.
- Sustituir servicios externos por dobles cuando existan tests automatizados.
- Comprobar pedido, referencia, importe y transición de estado.
- Revisar que los logs no muestren secretos ni cuerpos sensibles completos.
- Registrar en `docs/PROGRESS.md` qué se probó y qué no.

Existe una suite Jest ejecutable con `npm.cmd test`. Aun así, no afirmar que el flujo funciona en un entorno real solo por revisión estática o por tests con dobles: staging requiere ejecutar la checklist operativa completa.

## Deploy a staging (EasyPanel)

Plataforma: EasyPanel sobre VPS. Estrategia completa en `docs/DECISIONS.md` (DEC-016).

### Variables a cargar en EasyPanel

Cargar solo desde el panel de EasyPanel. Nunca en el repositorio ni en archivos versionados. Nunca compartir valores por mensajes ni capturas.

| Variable | Descripción |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Token sandbox de Mercado Pago (para staging) |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Secreto para validar firma HMAC-SHA256 del webhook |
| `BASE_URL` | URL HTTPS pública de EasyPanel, sin barra final ni ruta |
| `SUPABASE_URL` | URL del proyecto Supabase actual |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privilegiada de Supabase — solo backend, nunca frontend |
| `LOG_LEVEL` | Usar `info` |
| `NODE_ENV` | Establecer `production` |

### Pasos de deploy a staging

1. Crear el servicio en EasyPanel apuntando al repositorio GitHub.
2. Configurar todas las variables de entorno listadas arriba en el panel de EasyPanel.
3. Configurar el comando de inicio: `npm start` (o `node index.js`).
4. Desplegar y verificar que el log inicial no muestra errores de variable faltante.
5. Anotar la URL HTTPS pública asignada por EasyPanel.
6. Actualizar `BASE_URL` en EasyPanel con esa URL si aún no coincide.
7. Configurar manualmente el webhook sandbox en el panel de desarrolladores de Mercado Pago: URL destino `{BASE_URL}/webhook`. Sin este paso el webhook no llegará al servidor.
8. Ejecutar la checklist de staging completa (ver `docs/DECISIONS.md` — DEC-016).

### Checklist de staging

Ejecutar en orden y registrar el resultado. Staging usa EasyPanel/VPS existente, URL HTTPS gratuita de EasyPanel, `NODE_ENV=production`, `BASE_URL` HTTPS pública sin barra final, Mercado Pago sandbox, el mismo Supabase actual y frontend servido desde `public/`.

1. Variables cargadas en EasyPanel según la tabla anterior, solo por panel y sin valores en archivos versionados.
2. Servicio arranca sin errores de variables faltantes.
3. Abrir la URL HTTPS pública de EasyPanel y confirmar que el frontend carga.
4. `POST /crear-preferencia` con `{ "sku": "REMERA-LEMONT-001", "quantity": 1 }` responde con `preference_id` y URL de checkout.
5. Supabase muestra un pedido `pending` con referencia `LEMONT-ORDER-...`.
6. La redirección al checkout sandbox de Mercado Pago funciona.
7. Completar el pago en sandbox con credenciales de prueba.
8. Mercado Pago llama a `POST /webhook` en la URL HTTPS pública.
9. Supabase muestra el pedido con `status = 'paid'`.
10. `GET /webhook` devuelve 404, confirmando que `NODE_ENV=production` está activo.
11. Los logs de EasyPanel son JSON estructurado y no muestran secretos ni campos sensibles.

### Notas de seguridad

- `SUPABASE_SERVICE_ROLE_KEY` nunca debe usarse en el frontend ni en archivos bajo `public/`.
- `.env` real debe quedar ignorado por Git y nunca subirse al repositorio.
- `.env.example` es la plantilla pública; sin valores reales.
- En caso de exposición de secretos: revocar y rotar inmediatamente desde el proveedor. Ver `docs/SECURITY.md`.

### Rollback

Ver estrategia completa de rollback en `docs/DECISIONS.md` (DEC-016). Resumen:

1. Variable incorrecta → corregir en EasyPanel y reiniciar.
2. Problema al pasar a producción real → revertir al token sandbox en EasyPanel.
3. Fallo grave del servicio → pausar servicio en EasyPanel, revisar logs, corregir.
4. Error de código → revertir al commit anterior en GitHub y redesplegar.

### Producción real

No pasar a producción real sin completar esta checklist previa:

1. Los 11 ítems de staging están verificados y documentados.
2. `MERCADOPAGO_ACCESS_TOKEN` real disponible y sin exposición previa.
3. `MERCADO_PAGO_WEBHOOK_SECRET` productivo generado y configurado en EasyPanel y Mercado Pago.
4. Webhook productivo registrado en Mercado Pago con URL `{BASE_URL}/webhook`.
5. `BASE_URL` apunta a una URL HTTPS estable.
6. Si se usa `lemont01.com`: dominio recuperado, DNS al VPS y HTTPS activo antes de registrar el webhook.
7. Variables actualizadas en EasyPanel: token sandbox reemplazado por token real y `BASE_URL` actualizada si cambió el dominio.
8. RLS de Supabase verificado: sin policies para `anon` ni `authenticated`.
9. Sin secretos en el repositorio: revisar `git log` y `git diff` antes de cualquier push.
10. Pago real mínimo verificado de punta a punta.
11. Plan de rollback conocido y ejecutable sin asistencia.

## Revisar cambios

```powershell
git status --short
git diff
```

No ejecutar `git add`, commit, push o deploy sin autorización expresa.

## Pedir tareas seguras a Codex

Una solicitud segura especifica alcance, archivos permitidos y verificaciones. Ejemplos:

```text
Revisá T-001 y proponé un plan. Solo lectura; no modifiques código ni abras .env.
```

```text
Implementá T-014. Podés modificar únicamente index.js, el test relacionado y la documentación. No instales dependencias ni hagas commit.
```

```text
Auditá el flujo del webhook. No realices llamadas externas ni muestres valores de configuración.
```

Para tareas de pagos, base de datos, autenticación, dependencias o deploy, pedir primero análisis y plan, y autorizar explícitamente los cambios permitidos.
