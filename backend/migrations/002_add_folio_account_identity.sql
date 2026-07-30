BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-002-add-folio-account-identity')
);

LOCK TABLE public.cartera_cuentas
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cartera_cuentas
  ) THEN
    RAISE EXCEPTION
      '002_add_folio_account_identity requiere cartera_cuentas vacía';
  END IF;
END
$$;

ALTER TABLE public.cartera_cuentas
  ADD COLUMN folio VARCHAR(255) NOT NULL;

ALTER TABLE public.cartera_cuentas
  DROP CONSTRAINT cartera_cuentas_identidad_unica;

ALTER TABLE public.cartera_cuentas
  ADD CONSTRAINT cartera_cuentas_identidad_unica
  UNIQUE (
    empresa_id,
    id_campania,
    id_cliente,
    folio
  );

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '002_add_folio_account_identity',
  'Agregar Folio a la identidad unica de cuentas'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
