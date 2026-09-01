BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-010-create-session-control')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '009_create_campaign_catalog_and_daily_cut'
  ) THEN
    RAISE EXCEPTION
      'La migracion 009_create_campaign_catalog_and_daily_cut no esta aplicada';
  END IF;
END
$$;

CREATE TABLE public.crm_sesiones (
  id UUID PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  usuario_id INTEGER NOT NULL
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  direccion_ip VARCHAR(64),
  agente_usuario VARCHAR(1000),
  iniciada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_actividad_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at TIMESTAMPTZ NOT NULL,
  cerrada_at TIMESTAMPTZ,
  cerrada_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  cierre_motivo VARCHAR(255),
  CONSTRAINT crm_sesiones_fechas_validas
    CHECK (
      expira_at > iniciada_at
      AND ultima_actividad_at >= iniciada_at
      AND (
        cerrada_at IS NULL
        OR cerrada_at >= iniciada_at
      )
    ),
  CONSTRAINT crm_sesiones_cierre_consistente
    CHECK (
      (cerrada_at IS NULL AND cerrada_por IS NULL)
      OR cerrada_at IS NOT NULL
    )
);

CREATE INDEX ix_crm_sesiones_empresa_activas
  ON public.crm_sesiones (
    empresa_id,
    ultima_actividad_at DESC,
    id
  )
  WHERE cerrada_at IS NULL;

CREATE INDEX ix_crm_sesiones_usuario_activas
  ON public.crm_sesiones (
    usuario_id,
    ultima_actividad_at DESC
  )
  WHERE cerrada_at IS NULL;

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '010_create_session_control',
  'Registro, monitoreo y cierre remoto de sesiones'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
