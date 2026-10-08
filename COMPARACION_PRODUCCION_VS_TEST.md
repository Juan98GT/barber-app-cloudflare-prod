# COMPARACION_PRODUCCION_VS_TEST.md

## Resultado de la comparación

Se comparó `barber_app_v3_6_4.zip`, actualmente en producción, contra `barber_cloudflare_test_optimizado_v4_servicios_edge.zip`.

### Backend

- Funciones encontradas en producción: **133**
- Funciones encontradas en Code_TEST: **157**
- Funciones productivas ausentes en TEST: **0**
- Funciones adicionales en TEST: **24**
- Funciones productivas modificadas por las optimizaciones: **19**

Esto permite usar el backend optimizado como base de migración sin perder funciones productivas conocidas.

### Funciones agregadas por Cloudflare/optimización

- `apiJsonResponse_`
- `appointmentDateCacheKey_`
- `appointmentSnapshotKey_`
- `configureCloudflareTest`
- `constantTimeEqual_`
- `doPost`
- `getAvailabilityWarmStatus`
- `installAvailabilityWarmTrigger`
- `invalidateAppointmentDateCache_`
- `listAppointmentsByDateFresh_`
- `measureTestStep_`
- `normalizeServiceRows_`
- `readAllAppointments_`
- `readAppointmentSnapshotIndex_`
- `readAppointmentSnapshot_`
- `readPublicServicesSnapshot_`
- `rebuildAppointmentDateCache_`
- `removeAvailabilityWarmTrigger`
- `validateApiSecret_`
- `warmAvailabilityCache`
- `warmAvailabilityCacheTrigger_`
- `writeAppointmentDateFastState_`
- `writeAppointmentSnapshot_`
- `writePublicServicesSnapshot_`

### Funciones existentes modificadas

- `autoUpdateAllPastAppointments`
- `createAppointment`
- `deleteAppointment`
- `getDateAvailabilityInfo`
- `getDateAvailabilityInfo_`
- `getEditableAvailability`
- `getSpreadsheet_`
- `invalidateSettingsCache_`
- `listAppointmentsByDate_`
- `listBlocks_`
- `listBreaks_`
- `listExtraHours_`
- `listScheduleExceptions_`
- `listSchedule_`
- `listServices_`
- `saveServices`
- `setAppointmentStatus`
- `updateAppointment`
- `updatePublicAppointment`

Los cambios se concentran en:
- API `doPost` para Cloudflare.
- Caché de servicios, horarios, pausas, bloqueos, extraordinarios y citas por fecha.
- Snapshots persistentes.
- Prewarm periódico.
- Reutilización del handle del Spreadsheet durante una ejecución.
- Invalidación/actualización de caché después de mutaciones.
- Diagnóstico de rendimiento.
- Optimización del registro y modificación pública de citas.

### Frontend público

El frontend Cloudflare conserva todas las funciones de interacción encontradas en el JavaScript público de producción y agrega:
- llamadas mediante `/api`;
- `localStorage` para configuración pública;
- estados visuales de carga de servicios;
- reintentos;
- prewarm;
- diagnóstico opcional;
- caché Edge de `getPublicConfig`.

### Administrador

El panel `Admin.html` de producción **no se migra a Cloudflare en esta fase**.

Se mantiene servido por Google Apps Script mediante:

`/exec?view=admin`

Esto reduce el alcance de la migración y conserva la administración productiva actual.

### Rollback

Los archivos HTML originales de Apps Script se mantienen en el paquete. Por tanto, el `/exec` productivo original puede seguir sirviendo el cliente y el administrador mientras se valida Cloudflare.
