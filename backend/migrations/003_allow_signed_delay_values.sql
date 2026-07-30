BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-003-allow-signed-delay-values')
);

ALTER TABLE public.cartera_snapshots
  DROP CONSTRAINT
    cartera_snapshots_semanas_atraso_check;

ALTER TABLE public.cartera_snapshots
  DROP CONSTRAINT
    cartera_snapshots_dias_atraso_check;

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '003_allow_signed_delay_values',
  'Permitir valores negativos de atraso entregados por Banco Azteca'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
