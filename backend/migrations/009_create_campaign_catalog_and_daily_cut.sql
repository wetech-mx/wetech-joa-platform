BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-009-create-campaign-catalog-and-daily-cut')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '008_create_payment_validation_workflow'
  ) THEN
    RAISE EXCEPTION
      'La migracion 008_create_payment_validation_workflow no esta aplicada';
  END IF;
END
$$;

CREATE TABLE public.cartera_campanias (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  origen_id BIGINT NOT NULL,
  codigo VARCHAR(100) NOT NULL
    CHECK (CHAR_LENGTH(BTRIM(codigo)) BETWEEN 1 AND 100),
  nombre VARCHAR(150) NOT NULL
    CHECK (CHAR_LENGTH(BTRIM(nombre)) BETWEEN 1 AND 150),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  primera_fecha_cartera DATE NOT NULL,
  ultima_fecha_cartera DATE NOT NULL,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartera_campanias_origen_empresa_fkey
    FOREIGN KEY (empresa_id, origen_id)
    REFERENCES public.crm_origenes(empresa_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT cartera_campanias_empresa_id_unico
    UNIQUE (empresa_id, id),
  CONSTRAINT cartera_campanias_empresa_origen_codigo_unico
    UNIQUE (empresa_id, origen_id, codigo),
  CONSTRAINT cartera_campanias_fechas_validas
    CHECK (ultima_fecha_cartera >= primera_fecha_cartera)
);

INSERT INTO public.cartera_campanias
(
  empresa_id,
  origen_id,
  codigo,
  nombre,
  primera_fecha_cartera,
  ultima_fecha_cartera
)
SELECT
  c.empresa_id,
  c.origen_id,
  c.id_campania,
  CASE
    WHEN UPPER(BTRIM(c.id_campania)) = 'SIN CAMPAÑA'
      THEN 'Sin campaña'
    ELSE c.id_campania
  END,
  MIN(c.primera_fecha_cartera),
  MAX(c.ultima_fecha_cartera)
FROM public.cartera_cuentas c
GROUP BY
  c.empresa_id,
  c.origen_id,
  c.id_campania
ON CONFLICT (empresa_id, origen_id, codigo)
DO NOTHING;

CREATE INDEX ix_cartera_campanias_empresa_origen_activas
  ON public.cartera_campanias (
    empresa_id,
    origen_id,
    activa,
    nombre,
    id
  );

ALTER TABLE public.cartera_cuentas
  ADD COLUMN en_corte_actual BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX ix_cartera_cuentas_corte_actual
  ON public.cartera_cuentas (
    empresa_id,
    origen_id,
    en_corte_actual,
    activa,
    ultima_fecha_cartera DESC
  );

ALTER TABLE public.cartera_importaciones
  ADD COLUMN registros_fuera_corte INTEGER NOT NULL DEFAULT 0
    CHECK (registros_fuera_corte >= 0);

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '009_create_campaign_catalog_and_daily_cut',
  'Catalogo de campanias, corte vigente y base de reportes diarios'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
