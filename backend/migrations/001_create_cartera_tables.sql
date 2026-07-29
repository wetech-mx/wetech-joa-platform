BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-001-create-cartera-tables')
);

CREATE TABLE IF NOT EXISTS public.crm_migrations (
  version VARCHAR(100) PRIMARY KEY,
  descripcion TEXT NOT NULL,
  aplicada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.cartera_importaciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  fecha_cartera DATE NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  archivo_sha256 VARCHAR(64) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (
      estado IN (
        'pendiente',
        'procesando',
        'completada',
        'fallida'
      )
    ),
  campanias_detectadas INTEGER NOT NULL DEFAULT 0
    CHECK (campanias_detectadas >= 0),
  registros_leidos INTEGER NOT NULL DEFAULT 0
    CHECK (registros_leidos >= 0),
  registros_nuevos INTEGER NOT NULL DEFAULT 0
    CHECK (registros_nuevos >= 0),
  registros_actualizados INTEGER NOT NULL DEFAULT 0
    CHECK (registros_actualizados >= 0),
  registros_duplicados INTEGER NOT NULL DEFAULT 0
    CHECK (registros_duplicados >= 0),
  registros_omitidos INTEGER NOT NULL DEFAULT 0
    CHECK (registros_omitidos >= 0),
  error_codigo VARCHAR(100),
  error_detalle TEXT,
  creado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  iniciada_at TIMESTAMPTZ,
  finalizada_at TIMESTAMPTZ,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartera_importaciones_sha256_formato
    CHECK (archivo_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  CONSTRAINT cartera_importaciones_sha256_unico
    UNIQUE (empresa_id, archivo_sha256),
  CONSTRAINT cartera_importaciones_fechas_validas
    CHECK (
      finalizada_at IS NULL
      OR iniciada_at IS NULL
      OR finalizada_at >= iniciada_at
    )
);

CREATE UNIQUE INDEX ux_cartera_importaciones_completada_fecha
  ON public.cartera_importaciones (
    empresa_id,
    fecha_cartera
  )
  WHERE estado = 'completada';

CREATE INDEX ix_cartera_importaciones_empresa_fecha
  ON public.cartera_importaciones (
    empresa_id,
    fecha_cartera DESC
  );

CREATE INDEX ix_cartera_importaciones_estado
  ON public.cartera_importaciones (estado);

CREATE TABLE public.cartera_cuentas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  id_campania VARCHAR(100) NOT NULL,
  id_cliente VARCHAR(255) NOT NULL,
  estado_gestion VARCHAR(50) NOT NULL DEFAULT 'sin_gestionar',
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  primera_fecha_cartera DATE NOT NULL,
  ultima_fecha_cartera DATE NOT NULL,
  ultima_importacion_id BIGINT NOT NULL
    REFERENCES public.cartera_importaciones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartera_cuentas_identidad_unica
    UNIQUE (
      empresa_id,
      id_campania,
      id_cliente
    ),
  CONSTRAINT cartera_cuentas_fechas_validas
    CHECK (
      ultima_fecha_cartera >= primera_fecha_cartera
    )
);

CREATE INDEX ix_cartera_cuentas_busqueda
  ON public.cartera_cuentas (
    empresa_id,
    id_campania,
    estado_gestion,
    activa
  );

CREATE INDEX ix_cartera_cuentas_ultima_fecha
  ON public.cartera_cuentas (
    empresa_id,
    ultima_fecha_cartera DESC
  );

CREATE TABLE public.cartera_snapshots (
  id BIGSERIAL PRIMARY KEY,
  importacion_id BIGINT NOT NULL
    REFERENCES public.cartera_importaciones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  cuenta_id BIGINT NOT NULL
    REFERENCES public.cartera_cuentas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  nombre TEXT,
  id_genero VARCHAR(50),
  edad SMALLINT
    CHECK (edad IS NULL OR edad BETWEEN 0 AND 130),
  id_nivel_riesgo VARCHAR(100),
  medio_contacto_sugerido VARCHAR(100),
  telefono_1 VARCHAR(100),
  tipo_telefono_1 VARCHAR(100),
  telefono_2 VARCHAR(100),
  tipo_telefono_2 VARCHAR(100),
  telefono_3 VARCHAR(100),
  tipo_telefono_3 VARCHAR(100),
  telefono_4 VARCHAR(100),
  tipo_telefono_4 VARCHAR(100),
  correo_1 VARCHAR(320),
  correo_2 VARCHAR(320),
  id_pais VARCHAR(100),
  id_canal VARCHAR(100),
  id_sucursal VARCHAR(100),
  folio VARCHAR(255),
  semanas_atraso INTEGER
    CHECK (
      semanas_atraso IS NULL
      OR semanas_atraso >= 0
    ),
  dias_atraso INTEGER
    CHECK (
      dias_atraso IS NULL
      OR dias_atraso >= 0
    ),
  dia_pago VARCHAR(100),
  saldo NUMERIC(18, 2),
  pago_requerido NUMERIC(18, 2),
  pago_minimo NUMERIC(18, 2),
  pago_no_genera_intereses NUMERIC(18, 2),
  abono_puntual NUMERIC(18, 2),
  abono_semanal NUMERIC(18, 2),
  fecha_proxima_pago DATE,
  fecha_vencimiento DATE,
  producto TEXT,
  codigo_postal VARCHAR(20),
  datos_origen JSONB NOT NULL DEFAULT '{}'::JSONB,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartera_snapshots_cuenta_importacion_unica
    UNIQUE (
      importacion_id,
      cuenta_id
    )
);

CREATE INDEX ix_cartera_snapshots_importacion
  ON public.cartera_snapshots (importacion_id);

CREATE INDEX ix_cartera_snapshots_cuenta
  ON public.cartera_snapshots (
    cuenta_id,
    importacion_id DESC
  );

CREATE INDEX ix_cartera_snapshots_riesgo
  ON public.cartera_snapshots (id_nivel_riesgo);

CREATE INDEX ix_cartera_snapshots_nombre
  ON public.cartera_snapshots (LOWER(nombre));

CREATE TABLE public.cartera_asignaciones (
  id BIGSERIAL PRIMARY KEY,
  cuenta_id BIGINT NOT NULL
    REFERENCES public.cartera_cuentas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  usuario_id INTEGER NOT NULL
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  asignado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  metodo VARCHAR(30) NOT NULL
    CHECK (
      metodo IN (
        'round_robin',
        'manual',
        'reasignacion'
      )
    ),
  motivo TEXT,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  asignada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizada_at TIMESTAMPTZ,
  CONSTRAINT cartera_asignaciones_fechas_validas
    CHECK (
      finalizada_at IS NULL
      OR finalizada_at >= asignada_at
    ),
  CONSTRAINT cartera_asignaciones_estado_fechas
    CHECK (
      (activa = TRUE AND finalizada_at IS NULL)
      OR (activa = FALSE AND finalizada_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX ux_cartera_asignaciones_cuenta_activa
  ON public.cartera_asignaciones (cuenta_id)
  WHERE activa = TRUE;

CREATE INDEX ix_cartera_asignaciones_usuario_activa
  ON public.cartera_asignaciones (
    usuario_id,
    activa
  );

CREATE TABLE public.cartera_historial (
  id BIGSERIAL PRIMARY KEY,
  cuenta_id BIGINT NOT NULL
    REFERENCES public.cartera_cuentas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  importacion_id BIGINT
    REFERENCES public.cartera_importaciones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  asignacion_id BIGINT
    REFERENCES public.cartera_asignaciones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  usuario_id INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  evento VARCHAR(100) NOT NULL,
  detalle TEXT,
  valor_anterior JSONB,
  valor_nuevo JSONB,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_cartera_historial_cuenta_fecha
  ON public.cartera_historial (
    cuenta_id,
    creada_at DESC
  );

CREATE INDEX ix_cartera_historial_importacion
  ON public.cartera_historial (importacion_id);

CREATE TABLE public.cartera_round_robin_estado (
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  id_campania VARCHAR(100) NOT NULL,
  ultimo_usuario_id INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (
    empresa_id,
    id_campania
  )
);

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '001_create_cartera_tables',
  'Tablas iniciales del modulo Cartera Banco Azteca'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
