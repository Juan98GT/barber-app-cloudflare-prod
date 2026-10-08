# CONTEXTO_MIGRACION_PROD_V1.md

Versión preparada a partir de:
- Producción: Barber App V3.6.4.
- TEST validado: Cloudflare V4 Servicios Edge.

Arquitectura objetivo:

Cliente
→ Cloudflare Pages PROD
→ /api
→ Cloudflare Function
→ Apps Script PROD
→ Google Sheets PROD

Administrador:
→ Apps Script PROD `/exec?view=admin`

Rollback:
→ TinyURL vuelve a `/exec` de Apps Script.

Reglas:
- No mezclar secretos TEST y PROD.
- No cambiar `SPREADSHEET_ID` productivo.
- No ejecutar `setupProject()` durante la migración.
- Mantener LockService.
- Mantener validaciones productivas.
- Mantener los HTML originales de Apps Script.
- Hacer pruebas con la URL `pages.dev` antes de cambiar TinyURL.
