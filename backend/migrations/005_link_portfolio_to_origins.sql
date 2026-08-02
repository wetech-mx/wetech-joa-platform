BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-005-link-portfolio-to-origins')
);

LOCK TABLE
  public.cartera_importaciones,
  public.cartera_cuentas,
  public.cartera_round_robin_estado
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '004_create_integration_catalogs'
  ) THEN
    RAISE EXCEPTION
      'La migracion 004_create_integration_catalogs no esta aplicada';
  END IF;
END
$$;

ALTER TABLE public.crm_integraciones
  ADD CONSTRAINT crm_integraciones_empresa_origen_id_unico
  UNIQUE (
    empresa_id,
    origen_id,
    id
  );

ALTER TABLE public.cartera_importaciones
  ADD COLUMN origen_id BIGINT,
  ADD COLUMN integracion_id BIGINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cartera_importaciones importacion
    LEFT JOIN public.crm_origenes origen
      ON origen.empresa_id = importacion.empresa_id
      AND origen.codigo = 'banco_azteca'
    LEFT JOIN public.crm_integraciones integracion
      ON integracion.empresa_id = importacion.empresa_id
      AND integracion.origen_id = origen.id
      AND integracion.codigo = 'banco_azteca_api'
    WHERE
      origen.id IS NULL
      OR integracion.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'No se puede identificar Banco Azteca para una importacion existente';
  END IF;
END
$$;

UPDATE public.cartera_importaciones importacion
SET
  origen_id = origen.id,
  integracion_id = integracion.id
FROM
  public.crm_origenes origen,
  public.crm_integraciones integracion
WHERE
  origen.empresa_id = importacion.empresa_id
  AND origen.codigo = 'banco_azteca'
  AND integracion.empresa_id = importacion.empresa_id
  AND integracion.origen_id = origen.id
  AND integracion.codigo = 'banco_azteca_api';

ALTER TABLE public.cartera_importaciones
  ALTER COLUMN origen_id SET NOT NULL,
  ALTER COLUMN integracion_id SET NOT NULL,
  ADD CONSTRAINT cartera_importaciones_origen_empresa_fkey
    FOREIGN KEY (empresa_id, origen_id)
    REFERENCES public.crm_origenes(empresa_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  ADD CONSTRAINT cartera_importaciones_integracion_origen_fkey
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
  ADD CONSTRAINT cartera_importaciones_empresa_origen_id_unico
    UNIQUE (
      empresa_id,
      origen_id,
      id
    ),
  DROP CONSTRAINT cartera_importaciones_sha256_unico,
  ADD CONSTRAINT cartera_importaciones_sha256_unico
    UNIQUE (
      empresa_id,
      origen_id,
      archivo_sha256
    );

DROP INDEX public.ux_cartera_importaciones_completada_fecha;

CREATE UNIQUE INDEX ux_cartera_importaciones_completada_fecha
  ON public.cartera_importaciones (
    empresa_id,
    origen_id,
    fecha_cartera
  )
  WHERE estado = 'completada';

DROP INDEX public.ix_cartera_importaciones_empresa_fecha;

CREATE INDEX ix_cartera_importaciones_empresa_fecha
  ON public.cartera_importaciones (
    empresa_id,
    origen_id,
    fecha_cartera DESC
  );

ALTER TABLE public.cartera_cuentas
  ADD COLUMN origen_id BIGINT;

UPDATE public.cartera_cuentas cuenta
SET origen_id = importacion.origen_id
FROM public.cartera_importaciones importacion
WHERE importacion.id = cuenta.ultima_importacion_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cartera_cuentas
    WHERE origen_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'No se puede identificar el origen de una cuenta existente';
  END IF;
END
$$;

ALTER TABLE public.cartera_cuentas
  ALTER COLUMN origen_id SET NOT NULL,
  ADD CONSTRAINT cartera_cuentas_origen_empresa_fkey
    FOREIGN KEY (empresa_id, origen_id)
    REFERENCES public.crm_origenes(empresa_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  DROP CONSTRAINT cartera_cuentas_ultima_importacion_id_fkey,
  ADD CONSTRAINT cartera_cuentas_ultima_importacion_origen_fkey
    FOREIGN KEY (
      empresa_id,
      origen_id,
      ultima_importacion_id
    )
    REFERENCES public.cartera_importaciones(
      empresa_id,
      origen_id,
      id
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  DROP CONSTRAINT cartera_cuentas_identidad_unica,
  ADD CONSTRAINT cartera_cuentas_identidad_unica
    UNIQUE (
      empresa_id,
      origen_id,
      id_campania,
      id_cliente,
      folio
    );

DROP INDEX public.ix_cartera_cuentas_busqueda;

CREATE INDEX ix_cartera_cuentas_busqueda
  ON public.cartera_cuentas (
    empresa_id,
    origen_id,
    id_campania,
    estado_gestion,
    activa
  );

DROP INDEX public.ix_cartera_cuentas_ultima_fecha;

CREATE INDEX ix_cartera_cuentas_ultima_fecha
  ON public.cartera_cuentas (
    empresa_id,
    origen_id,
    ultima_fecha_cartera DESC
  );

ALTER TABLE public.cartera_round_robin_estado
  ADD COLUMN origen_id BIGINT;

UPDATE public.cartera_round_robin_estado estado
SET origen_id = cuenta_origen.origen_id
FROM (
  SELECT
    empresa_id,
    id_campania,
    MIN(origen_id) AS origen_id
  FROM public.cartera_cuentas
  GROUP BY
    empresa_id,
    id_campania
  HAVING COUNT(DISTINCT origen_id) = 1
) cuenta_origen
WHERE
  cuenta_origen.empresa_id = estado.empresa_id
  AND cuenta_origen.id_campania = estado.id_campania;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cartera_round_robin_estado
    WHERE origen_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'No se puede identificar sin ambiguedad el origen de un cursor round robin';
  END IF;
END
$$;

ALTER TABLE public.cartera_round_robin_estado
  DROP CONSTRAINT cartera_round_robin_estado_pkey,
  ALTER COLUMN origen_id SET NOT NULL,
  ADD CONSTRAINT cartera_round_robin_estado_origen_empresa_fkey
    FOREIGN KEY (empresa_id, origen_id)
    REFERENCES public.crm_origenes(empresa_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  ADD CONSTRAINT cartera_round_robin_estado_pkey
    PRIMARY KEY (
      empresa_id,
      origen_id,
      id_campania
    );

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '005_link_portfolio_to_origins',
  'Relacionar cartera, importaciones y round robin con origenes e integraciones'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
