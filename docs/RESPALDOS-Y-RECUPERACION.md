# Respaldos y recuperación del CRM

## Alcance

Este procedimiento corresponde a Rosas y Asociados CRM en
`/opt/crm` y a la base PostgreSQL configurada por el backend.

Nunca se debe restaurar directamente sobre la base de producción
durante una validación. Las pruebas usan una base temporal con un
nombre fijo y verificable.

## Respaldo automático

- Servicio: `crm-database-backup.service`
- Temporizador: `crm-database-backup.timer`
- Horario: 02:30, zona `America/Mexico_City`
- Directorio: `/opt/backups/crm/automatic`
- Retención: 30 días
- Formato: `pg_dump` personalizado
- Permisos: `600 root:root`
- Integridad: manifiesto SHA-256 por respaldo

Los respaldos manuales ubicados fuera de `automatic` no forman
parte de la limpieza automática.

## Comprobación diaria

```bash
systemctl list-timers --all --no-pager |
grep 'crm-database-backup'

systemctl show crm-database-backup.service \
  --property=Result \
  --property=ExecMainStatus \
  --property=ExecMainStartTimestamp

journalctl \
  -u crm-database-backup.service \
  -n 30 \
  --no-pager
```

El resultado correcto es `Result=success` y `ExecMainStatus=0`.

## Ejecución manual

```bash
systemctl start crm-database-backup.service

systemctl status \
  crm-database-backup.service \
  --no-pager \
  --full
```

## Validación de un respaldo automático

```bash
backup_dir="/opt/backups/crm/automatic"
backup_name="NOMBRE_EXACTO_DEL_RESPALDO.dump"

cd "$backup_dir"

sha256sum -c "${backup_name}.sha256"
pg_restore --list "$backup_name" >/dev/null

echo "RESPALDO_VALIDADO=OK"
```

No se deben usar comodines para seleccionar el archivo durante una
recuperación real.

## Restauración aislada de validación

Reemplazar únicamente `NOMBRE_EXACTO_DEL_RESPALDO.dump` por el
archivo previamente validado.

```bash
cd /opt/crm/backend

(
set -Eeuo pipefail

backup_file="/opt/backups/crm/automatic/NOMBRE_EXACTO_DEL_RESPALDO.dump"
restore_db="wetech_restore_validation"
created=0

cleanup_restore() {
  if [ "$created" -eq 1 ]; then
    sudo -u postgres dropdb --if-exists "$restore_db"
  fi
}

trap cleanup_restore EXIT

test -s "$backup_file"
pg_restore --list "$backup_file" >/dev/null

if sudo -u postgres psql -d postgres -Atqc \
  "SELECT 1 FROM pg_database WHERE datname='$restore_db';" |
  grep -qx 1
then
  echo "ERROR: La base temporal ya existe"
  exit 1
fi

sudo -u postgres createdb \
  --template=template0 \
  "$restore_db"

created=1

sudo -u postgres pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname="$restore_db" \
  < "$backup_file"

sudo -u postgres psql \
  -v ON_ERROR_STOP=1 \
  -P pager=off \
  -d "$restore_db" \
  -c "SELECT COUNT(*) AS tablas_publicas
      FROM pg_tables
      WHERE schemaname='public';" \
  -c "SELECT COUNT(*) AS cartera_cuentas
      FROM public.cartera_cuentas;" \
  -c "SELECT COUNT(*) AS asignaciones
      FROM public.cartera_asignaciones;" \
  -c "SELECT COUNT(*) AS movimientos_historial
      FROM public.cartera_historial;"

sudo -u postgres dropdb "$restore_db"
created=0

echo "RESTAURACION_AISLADA=OK"
echo "BASE_TEMPORAL_ELIMINADA=OK"
)
```

La redirección `< "$backup_file"` permite conservar los permisos
privados del respaldo sin otorgar acceso permanente al usuario
`postgres`.

## Recuperación real

Una recuperación real requiere una ventana de mantenimiento y debe
cumplir este orden:

1. Confirmar el incidente y detener escrituras de usuarios.
2. Crear un respaldo final del estado existente si PostgreSQL lo
   permite.
3. Verificar SHA-256 y catálogo del respaldo elegido.
4. Restaurarlo primero en una base aislada.
5. Validar cuentas, asignaciones, historial y acceso del backend.
6. Autorizar explícitamente el reemplazo de producción.
7. Registrar fecha, operador, respaldo utilizado y resultados.

El reemplazo de la base de producción no está incluido como comando
automático en este documento para evitar ejecuciones accidentales.

## Frontend de producción

Nginx sirve `/opt/crm/frontend/dist`; Vite no debe permanecer
escuchando en el puerto 5173.

Después de cualquier cambio al frontend se debe ejecutar:

```bash
cd /opt/crm/frontend
npm run lint
npm run build
```

Luego se valida que el HTML público use `/assets/index-*` y no
contenga `@vite/client` ni `/src/main.jsx`.
