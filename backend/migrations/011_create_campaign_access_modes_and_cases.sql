BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-011-campaign-access-modes-and-cases')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '010_create_session_control'
  ) THEN
    RAISE EXCEPTION
      'La migracion 010_create_session_control no esta aplicada';
  END IF;
END
$$;

ALTER TABLE public.cartera_campanias
  ADD COLUMN modo_distribucion VARCHAR(20)
    NOT NULL DEFAULT 'round_robin'
    CHECK (
      modo_distribucion IN (
        'round_robin',
        'manual',
        'abierta'
      )
    ),
  ADD COLUMN modo_actualizado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL;

CREATE INDEX ix_cartera_campanias_empresa_modo
  ON public.cartera_campanias (
    empresa_id,
    modo_distribucion,
    activa,
    id
  );

CREATE TABLE public.cartera_campanias_historial (
  id BIGSERIAL PRIMARY KEY,
  campania_id BIGINT NOT NULL
    REFERENCES public.cartera_campanias(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  usuario_id INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  evento VARCHAR(50) NOT NULL,
  valor_anterior JSONB,
  valor_nuevo JSONB,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_cartera_campanias_historial_fecha
  ON public.cartera_campanias_historial (
    campania_id,
    creada_at DESC,
    id DESC
  );

CREATE TABLE public.cartera_casos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  cuenta_id BIGINT NOT NULL
    REFERENCES public.cartera_cuentas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  titulo VARCHAR(200) NOT NULL
    CHECK (CHAR_LENGTH(BTRIM(titulo)) BETWEEN 1 AND 200),
  prioridad VARCHAR(20) NOT NULL DEFAULT 'media'
    CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  estado VARCHAR(20) NOT NULL DEFAULT 'nuevo'
    CHECK (
      estado IN (
        'nuevo',
        'en_proceso',
        'en_espera',
        'resuelto',
        'cerrado'
      )
    ),
  asignado_a INTEGER NOT NULL
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  comentarios TEXT NOT NULL
    CHECK (CHAR_LENGTH(BTRIM(comentarios)) BETWEEN 1 AND 5000),
  solucion TEXT,
  creado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  actualizado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_at TIMESTAMPTZ,
  cerrado_at TIMESTAMPTZ,
  CONSTRAINT cartera_casos_fechas_validas
    CHECK (
      actualizado_at >= creado_at
      AND (resuelto_at IS NULL OR resuelto_at >= creado_at)
      AND (cerrado_at IS NULL OR cerrado_at >= creado_at)
    ),
  CONSTRAINT cartera_casos_solucion_requerida
    CHECK (
      estado NOT IN ('resuelto', 'cerrado')
      OR CHAR_LENGTH(BTRIM(COALESCE(solucion, ''))) > 0
    )
);

CREATE INDEX ix_cartera_casos_empresa_estado
  ON public.cartera_casos (
    empresa_id,
    estado,
    prioridad,
    actualizado_at DESC,
    id DESC
  );

CREATE INDEX ix_cartera_casos_asignado_estado
  ON public.cartera_casos (
    asignado_a,
    estado,
    actualizado_at DESC,
    id DESC
  );

CREATE INDEX ix_cartera_casos_cuenta_fecha
  ON public.cartera_casos (
    cuenta_id,
    creado_at DESC,
    id DESC
  );

CREATE TABLE public.cartera_casos_historial (
  id BIGSERIAL PRIMARY KEY,
  caso_id BIGINT NOT NULL
    REFERENCES public.cartera_casos(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  usuario_id INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  seccion VARCHAR(50) NOT NULL,
  evento VARCHAR(50) NOT NULL,
  valor_anterior JSONB,
  valor_nuevo JSONB,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_cartera_casos_historial_fecha
  ON public.cartera_casos_historial (
    caso_id,
    creada_at DESC,
    id DESC
  );

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '011_create_campaign_access_modes_and_cases',
  'Modos de acceso por campania y casos operativos auditados'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
