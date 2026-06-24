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
curl.exe -X POST http://localhost:3003/crear-preferencia
```

Verificar que la respuesta contenga un identificador y una URL de checkout, y que Supabase tenga un pedido `pending` con la misma referencia. No publicar la respuesta completa si contiene identificadores operativos.

## Probar la recepción del webhook

```powershell
curl.exe -X POST "http://localhost:3003/webhook?id=123456789&topic=payment" -H "Content-Type: application/json" -d "{\"resource\":\"123456789\",\"topic\":\"payment\"}"
```

El ID es ilustrativo. La recepción puede comprobarse, pero la consulta a Mercado Pago fallará si no corresponde a un pago real de la cuenta de prueba. No inventar una aprobación ni alterar pedidos manualmente para simularla.

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

Actualmente no existe una suite automatizada ni un comando `test`. No afirmar que el flujo funciona en un entorno real solo por revisión estática.

## Deploy

No se detectó configuración de despliegue. Antes de desplegar deben definirse proveedor, entornos, HTTPS, URL estable, variables seguras, salud del servicio, migraciones y rollback. No improvisar un deploy ni reutilizar credenciales de desarrollo.

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

