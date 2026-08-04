BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-006-create-integration-execution-history')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '005_link_portfolio_to_origins'
  ) THEN
    RAISE EXCEPTION
      'La migracion 005_link_portfolio_to_origins no esta aplicada';
  END IF;
END
$$;

CREATE TABLE public.crm_integracion_ejecuciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL,
  origen_id BIGINT NOT NULL,
  integracion_id BIGINT NOT NULL,
  etapa VARCHAR(30) NOT NULL
    CHECK (
      etapa IN (
        'extraccion',
        'importacion',
        'sincronizacion',
        'prueba'
      )
    ),
  disparador VARCHAR(20) NOT NULL
    CHECK (
      disparador IN (
        'manual',
        'programada',
        'evento'
      )
    ),
  estado VARCHAR(20) NOT NULL DEFAULT 'iniciada'
    CHECK (
      estado IN (
        'iniciada',
        'completada',
        'sin_datos',
        'fallida',
        'omitida'
      )
    ),
  iniciada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizada_at TIMESTAMPTZ,
  duracion_ms BIGINT
    CHECK (duracion_ms IS NULL OR duracion_ms >= 0),
  registros_recibidos INTEGER
    CHECK (
      registros_recibidos IS NULL
      OR registros_recibidos >= 0
    ),
  registros_procesados INTEGER
    CHECK (
      registros_procesados IS NULL
      OR registros_procesados >= 0
    ),
  metricas JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_codigo VARCHAR(100),
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_integracion_ejecuciones_integracion_fkey
    FOREIGN KEY (
      empresa_id,
      origen_id,
      integracion_id
    )
    REFERENCES public.crm_integraciones(
      empresa_id,
      origen_id,
      id
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT crm_integracion_ejecuciones_finalizacion_check
    CHECK (
      (
        estado = 'iniciada'
        AND finalizada_at IS NULL
        AND duracion_ms IS NULL
      )
      OR (
        estado <> 'iniciada'
        AND finalizada_at IS NOT NULL
        AND duracion_ms IS NOT NULL
      )
    ),
  CONSTRAINT crm_integracion_ejecuciones_error_check
    CHECK (
      (estado = 'fallida' AND error_codigo IS NOT NULL)
      OR (estado = 'sin_datos')
      OR (
        estado NOT IN ('fallida', 'sin_datos')
        AND error_codigo IS NULL
      )
    ),
  CONSTRAINT crm_integracion_ejecuciones_error_formato
    CHECK (
      error_codigo IS NULL
      OR error_codigo ~ '^[A-Z][A-Z0-9_]{0,99}$'
    )
);

COMMENT ON COLUMN
  public.crm_integracion_ejecuciones.metricas
IS
  'Metricas operativas permitidas; nunca credenciales, tokens ni mensajes de error crudos';

COMMENT ON COLUMN
  public.crm_integracion_ejecuciones.error_codigo
IS
  'Codigo controlado sin mensajes, respuestas ni valores sensibles';

CREATE INDEX ix_crm_integracion_ejecuciones_integracion_fecha
  ON public.crm_integracion_ejecuciones (
    empresa_id,
    integracion_id,
    iniciada_at DESC,
    id DESC
  );

CREATE INDEX ix_crm_integracion_ejecuciones_empresa_estado_fecha
  ON public.crm_integracion_ejecuciones (
    empresa_id,
    estado,
    iniciada_at DESC
  );

CREATE UNIQUE INDEX ux_crm_integracion_ejecuciones_activa
  ON public.crm_integracion_ejecuciones (integracion_id)
  WHERE estado = 'iniciada';

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '006_create_integration_execution_history',
  'Crear historial seguro y multi-origen de ejecuciones de integraciones'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
