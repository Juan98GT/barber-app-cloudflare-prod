# MIGRACION_PRODUCCION_A_CLOUDFLARE.md

## Objetivo

Migrar únicamente el frontend público de Barber App a Cloudflare manteniendo:
- Google Apps Script como backend productivo;
- Google Sheets productivo como fuente de datos;
- el administrador actual en Apps Script;
- una ruta de rollback rápida.

## Antes de comenzar

No borres ni reemplaces tu implementación Web App actual.

El paquete incluye `Respaldo_Produccion_Original` con la copia utilizada para esta preparación, pero conserva también tu ZIP original fuera de Cloudflare.

---

## PASO 1. Actualizar el proyecto de Apps Script de producción

En el proyecto Apps Script productivo:

1. Conserva `Admin.html`, `Index.html`, `Styles.html` y `Logo.html`.
2. Reemplaza únicamente el contenido de `Code.gs` por `AppsScript/Code.gs` de este paquete.
3. Guarda el proyecto.
4. NO ejecutes `setupProject()` si producción ya está configurada.

La nueva versión conserva las funciones productivas y agrega el API y optimizaciones de Cloudflare.

---

## PASO 2. Crear el secreto productivo

No reutilices el secreto de TEST.

Genera un valor aleatorio de al menos 32 caracteres, preferiblemente 48-64.

En Apps Script:

1. Abre Configuración del proyecto.
2. En Propiedades del script agrega:
   - Nombre: `API_SHARED_SECRET`
   - Valor: tu secreto productivo
3. No cambies `SPREADSHEET_ID`.
4. Confirma que `SPREADSHEET_ID` continúa apuntando a la hoja real de producción.

No escribas el secreto dentro de `app.js`, `api.js` ni GitHub.

---

## PASO 3. Validar configuración productiva

En Apps Script ejecuta una sola vez:

`configureCloudflareProduction`

Esta función:
- verifica el `SPREADSHEET_ID` existente;
- verifica que exista `API_SHARED_SECRET`;
- no crea una hoja nueva;
- invalida cachés viejos;
- realiza un warm-up inicial.

Después ejecuta:

`getAvailabilityWarmStatus`

Revisa que no produzca error.

---

## PASO 4. Instalar o renovar el trigger de prewarm

Ejecuta una sola vez:

`installAvailabilityWarmTrigger`

Esto crea un trigger cada 10 minutos y hace un calentamiento inicial.

Después, en Apps Script > Activadores, confirma que exista un trigger para:

`warmAvailabilityCacheTrigger_`

---

## PASO 5. Actualizar la implementación Web App de Apps Script

1. Apps Script > Implementar > Administrar implementaciones.
2. Edita la implementación productiva existente o crea una nueva versión de la misma.
3. Mantén el acceso compatible con el funcionamiento actual del Web App.
4. Copia la URL `/exec`.

Todavía NO cambies TinyURL.

Comprueba que la URL antigua del cliente siga abriendo y que:

`/exec?view=admin`

siga mostrando el administrador.

---

## PASO 6. Crear repositorio/proyecto Cloudflare PROD

Recomendado:
- repositorio separado del TEST;
- proyecto Cloudflare separado del TEST.

Ejemplo de proyecto:
`fernandordbarber-prod`

Sube a GitHub el contenido de la carpeta `Cloudflare` manteniendo:

```
functions/
  api.js

public/
  index.html
  app.js
  styles.css
  logo.png
```

No subas `AppsScript/Code.gs` al frontend si no quieres mantener allí una copia del backend.

---

## PASO 7. Configurar variables privadas en Cloudflare PROD

En Settings > Variables and Secrets configura:

`APPS_SCRIPT_URL`
= URL `/exec` del Web App de PRODUCCIÓN.

`API_SHARED_SECRET`
= exactamente el mismo secreto productivo configurado en Apps Script.

Verifica especialmente que `APPS_SCRIPT_URL` NO apunte a TEST.

---

## PASO 8. Desplegar Cloudflare PROD

Realiza el deployment.

Antes de usar clientes reales, abre la URL `pages.dev` productiva.

Por ejemplo:

`https://fernandordbarber.pages.dev`

No modifiques todavía `tinyurl.com/fernandordbarber`.

---

## PASO 9. Pruebas obligatorias antes del cambio

Probar:

1. Carga inicial de servicios.
2. Recarga de página varias veces.
3. Selección de varios servicios.
4. Consulta de fechas y horarios.
5. Horarios normales.
6. Horarios extraordinarios.
7. Pausas.
8. Días bloqueados.
9. Excepciones de horario.
10. Crear una cita real de prueba.
11. Confirmar que aparece en Google Sheets.
12. Modificarla desde la página de confirmación.
13. Cancelarla o gestionarla desde el administrador.
14. Comprobar el administrador `/exec?view=admin`.
15. Dos navegadores intentando reservar el mismo horario.

La segunda reserva no debe poder ocupar un horario ya tomado.

---

## PASO 10. Diagnóstico opcional

Durante la validación puedes abrir:

`?debug=1`

La versión esperada es:

`prod-v1-v4-public-config-edge`

En consola:

```javascript
window.__BARBER_DIAGNOSTIC_VERSION__
```

En operación normal no agregues `?debug=1` a los enlaces de clientes.

---

## PASO 11. Cambio de TinyURL

Solo después de completar las pruebas cambia el destino de:

`https://tinyurl.com/fernandordbarber`

desde la URL antigua de Apps Script hacia:

`https://fernandordbarber.pages.dev`

o hacia el dominio productivo que finalmente uses.

El cliente conserva el mismo TinyURL.

---

## PASO 12. Rollback

Si aparece un problema crítico:

1. Cambia TinyURL nuevamente a la URL `/exec` anterior de Apps Script.
2. No borres citas ni la hoja.
3. No necesitas eliminar Cloudflare.
4. Investiga el problema en Cloudflare mientras producción vuelve a la ruta anterior.

La URL Apps Script continúa disponible porque el paquete conserva `Index.html`, `Admin.html`, `Styles.html` y `Logo.html`.

---

## Importante sobre el administrador

En esta primera migración el administrador continúa en Apps Script:

`https://script.google.com/.../exec?view=admin`

No está expuesto como enlace en el frontend público.

Esto es intencional.

---

## Importante sobre modificaciones directas en Google Sheets

La aplicación actual utiliza caché y snapshots para rendimiento.

Las mutaciones realizadas desde Barber App o desde el administrador actualizan/invalida las capas correspondientes.

Evita editar manualmente la hoja `Citas` como flujo normal. Los cambios manuales pueden tardar hasta el siguiente ciclo de reconciliación en reflejarse en las capas rápidas.
