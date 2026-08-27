BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-008-create-payment-validation-workflow')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '007_create_portfolio_management_records'
  ) THEN
    RAISE EXCEPTION
      'La migracion 007_create_portfolio_management_records no esta aplicada';
  END IF;
END
$$;

ALTER TABLE public.cartera_tipificaciones
  DROP CONSTRAINT IF EXISTS
    cartera_tipificaciones_estado_resultante_check;

ALTER TABLE public.cartera_tipificaciones
  ADD CONSTRAINT cartera_tipificaciones_estado_resultante_check
    CHECK (
      estado_resultante IN (
        'contactado',
        'no_localizado',
        'seguimiento',
        'promesa_pago',
        'promesa_incumplida',
        'convenio',
        'pago_reportado',
        'pago_realizado',
        'rechazo_pago',
        'datos_incorrectos',
        'cerrado'
      )
    );

ALTER TABLE public.cartera_gestiones
  DROP CONSTRAINT IF EXISTS
    cartera_gestiones_estado_resultante_check;

ALTER TABLE public.cartera_gestiones
  ADD CONSTRAINT cartera_gestiones_estado_resultante_check
    CHECK (
      estado_resultante IN (
        'contactado',
        'no_localizado',
        'seguimiento',
        'promesa_pago',
        'promesa_incumplida',
        'convenio',
        'pago_reportado',
        'pago_realizado',
        'rechazo_pago',
        'datos_incorrectos',
        'cerrado'
      )
    );

ALTER TABLE public.cartera_tipificaciones
  ADD COLUMN requiere_validacion_pago BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.cartera_tipificaciones
SET
  estado_resultante = 'pago_reportado',
  requiere_validacion_pago = TRUE,
  cierra_cuenta = FALSE,
  actualizada_at = NOW()
WHERE codigo IN ('ya_pago', 'ya_pago_recurrencia');

CREATE TABLE public.cartera_pago_validaciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  gestion_id BIGINT NOT NULL UNIQUE
    REFERENCES public.cartera_gestiones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  cuenta_id BIGINT NOT NULL
    REFERENCES public.cartera_cuentas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  estado_cuenta_anterior VARCHAR(50) NOT NULL
    CHECK (
      estado_cuenta_anterior IN (
        'sin_gestionar',
        'contactado',
        'no_localizado',
        'seguimiento',
        'promesa_pago',
        'promesa_incumplida',
        'convenio',
        'pago_realizado',
        'rechazo_pago',
        'datos_incorrectos'
      )
    ),
  reportado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  revisado_por INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  notas_revision TEXT
    CHECK (
      notas_revision IS NULL
      OR CHAR_LENGTH(notas_revision) <= 1000
    ),
  reportado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revisado_at TIMESTAMPTZ,
  CONSTRAINT cartera_pago_validaciones_revision_completa
    CHECK (
      (
        estado = 'pendiente'
        AND revisado_por IS NULL
        AND revisado_at IS NULL
      )
      OR (
        estado IN ('aprobado', 'rechazado')
        AND revisado_por IS NOT NULL
        AND revisado_at IS NOT NULL
      )
    )
);

CREATE INDEX ix_cartera_pago_validaciones_pendientes
  ON public.cartera_pago_validaciones (
    empresa_id,
    estado,
    reportado_at,
    id
  );

CREATE UNIQUE INDEX ux_cartera_pago_validacion_pendiente_cuenta
  ON public.cartera_pago_validaciones (cuenta_id)
  WHERE estado = 'pendiente';

CREATE INDEX ix_cartera_pago_validaciones_cuenta
  ON public.cartera_pago_validaciones (
    cuenta_id,
    reportado_at DESC,
    id DESC
  );

ALTER TABLE public.cartera_historial
  ADD COLUMN pago_validacion_id BIGINT
    REFERENCES public.cartera_pago_validaciones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX ux_cartera_historial_pago_validacion
  ON public.cartera_historial (pago_validacion_id)
  WHERE pago_validacion_id IS NOT NULL;

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '008_create_payment_validation_workflow',
  'Separar el reporte de pago de su validacion administrativa'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
