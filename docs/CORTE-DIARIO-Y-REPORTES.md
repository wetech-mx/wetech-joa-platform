# Corte diario, campañas y reportes

## Modelo operativo

- La campaña es estable y se identifica por el `IdCampaña` del origen.
- El caso corresponde a la combinación origen, campaña, cliente y folio.
- Cada importación completada representa un corte fechado.
- Cada caso conserva un snapshot por corte.
- Una cuenta ausente del corte más reciente queda marcada como fuera del
  corte actual. Esto no la cierra ni elimina su expediente.
- Las cuentas cerradas permanecen en modo de consulta y no se confunden
  con las cuentas que únicamente salieron del corte.

## Programación existente

Se conserva el temporizador `banco-azteca-cartera.timer` instalado durante
la configuración del conector. Se ejecuta de lunes a viernes en la zona
horaria `America/Mexico_City`, genera el archivo controlado y después lo
importa. Sus horarios de reintento no deben duplicarse con otro timer.

Ambos pasos quedan registrados en el historial de ejecuciones de
Integraciones. Antes de continuar debe comprobarse que la unidad existente
esté habilitada y que no haya otro temporizador para el mismo conector.

## Reportes

La pantalla Reportes permite:

- consultar el último corte o seleccionar uno anterior;
- filtrar por origen;
- al administrador, consultar el consolidado o un Ejecutivo;
- al Ejecutivo, consultar únicamente su propio alcance;
- descargar un Excel con las hojas `Resumen` y `Detalle del corte`.

El reporte incluye cuentas, estado operativo, gestiones del día, saldo,
pago requerido, campaña, datos del caso y Ejecutivo responsable.

## Resumen operativo y alertas

Al iniciar sesión se consulta el mismo alcance seguro de la cartera:

- cada Ejecutivo ve exclusivamente sus resultados y pendientes;
- el administrador o supervisor ve el concentrado y el desglose por
  Ejecutivo;
- el resumen aparece automáticamente una vez por usuario y día, usando
  la fecha de `America/Mexico_City`;
- después de cerrarlo permanece disponible desde la opción `Alertas`.

El bloque del día anterior muestra gestiones, cuentas atendidas, promesas,
pagos reportados y cierres. El bloque actual muestra cuentas sin gestionar,
nuevas asignaciones, promesas y seguimientos vencidos o para hoy, y pagos
pendientes de validación.

El registro diario se guarda únicamente en el navegador para evitar mostrar
repetidamente la ventana; no modifica el historial operativo y no envía
correos ni mensajes de WhatsApp.

## Validación antes de habilitar

```bash
cd /opt/crm/backend
node scripts/export-banco-azteca-daily.js
node scripts/import-banco-azteca-daily.js
```

Después de revisar el resultado y los reportes, verificar la programación
existente sin crear otra:

```bash
systemctl status banco-azteca-cartera.timer --no-pager
systemctl list-timers --all --no-pager | grep banco-azteca-cartera
systemctl cat banco-azteca-cartera.service
```
