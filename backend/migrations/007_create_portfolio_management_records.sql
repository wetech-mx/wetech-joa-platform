BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-007-create-portfolio-management-records')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_migrations
    WHERE version = '006_create_integration_execution_history'
  ) THEN
    RAISE EXCEPTION
      'La migracion 006_create_integration_execution_history no esta aplicada';
  END IF;
END
$$;

CREATE TABLE public.cartera_tipificaciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  codigo VARCHAR(100) NOT NULL
    CHECK (codigo ~ '^[a-z0-9][a-z0-9_]{0,99}$'),
  nombre VARCHAR(150) NOT NULL
    CHECK (CHAR_LENGTH(BTRIM(nombre)) BETWEEN 1 AND 150),
  prioridad SMALLINT NOT NULL
    CHECK (prioridad BETWEEN 1 AND 4),
  estado_resultante VARCHAR(50) NOT NULL
    CHECK (
      estado_resultante IN (
        'contactado',
        'no_localizado',
        'seguimiento',
        'promesa_pago',
        'promesa_incumplida',
        'convenio',
        'pago_realizado',
        'rechazo_pago',
        'datos_incorrectos',
        'cerrado'
      )
    ),
  contacto_efectivo BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_promesa BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_seguimiento BOOLEAN NOT NULL DEFAULT FALSE,
  cierra_cuenta BOOLEAN NOT NULL DEFAULT FALSE,
  orden SMALLINT NOT NULL DEFAULT 100
    CHECK (orden BETWEEN 1 AND 999),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartera_tipificaciones_empresa_id_unico
    UNIQUE (empresa_id, id),
  CONSTRAINT cartera_tipificaciones_empresa_codigo_unico
    UNIQUE (empresa_id, codigo)
);

CREATE INDEX ix_cartera_tipificaciones_empresa_activas
  ON public.cartera_tipificaciones (
    empresa_id,
    activa,
    prioridad,
    orden,
    id
  );

INSERT INTO public.cartera_tipificaciones
(
  empresa_id,
  codigo,
  nombre,
  prioridad,
  estado_resultante,
  contacto_efectivo,
  requiere_promesa,
  requiere_seguimiento,
  cierra_cuenta,
  orden
)
SELECT
  e.id,
  catalogo.codigo,
  catalogo.nombre,
  catalogo.prioridad,
  catalogo.estado_resultante,
  catalogo.contacto_efectivo,
  catalogo.requiere_promesa,
  catalogo.requiere_seguimiento,
  catalogo.cierra_cuenta,
  catalogo.orden
FROM public.empresas e
CROSS JOIN (
  VALUES
    ('promesa_parcial', 'Promesa parcial', 1, 'promesa_pago', TRUE, TRUE, FALSE, FALSE, 10),
    ('promesa_recurrencia', 'Promesa recurrencia', 1, 'promesa_pago', TRUE, TRUE, FALSE, FALSE, 20),
    ('promesa_inicial_convenio', 'Promesa inicial convenio', 1, 'convenio', TRUE, TRUE, FALSE, FALSE, 30),
    ('promesa_liquidacion', 'Promesa liquidación', 1, 'promesa_pago', TRUE, TRUE, FALSE, FALSE, 40),
    ('ya_pago', 'Ya pagó', 1, 'pago_realizado', TRUE, FALSE, FALSE, FALSE, 50),
    ('ya_pago_recurrencia', 'Ya pagó recurrencia', 1, 'pago_realizado', TRUE, FALSE, FALSE, FALSE, 60),
    ('prospecto', 'Prospecto', 2, 'seguimiento', TRUE, FALSE, TRUE, FALSE, 70),
    ('contacto_wp_sms', 'Contacto por WhatsApp o SMS', 2, 'contactado', TRUE, FALSE, FALSE, FALSE, 80),
    ('recado_familiar', 'Recado familiar', 2, 'seguimiento', TRUE, FALSE, TRUE, FALSE, 90),
    ('recado_tercero', 'Recado tercero', 2, 'seguimiento', TRUE, FALSE, TRUE, FALSE, 100),
    ('seguimiento', 'Seguimiento', 3, 'seguimiento', TRUE, FALSE, TRUE, FALSE, 110),
    ('carta', 'Carta', 3, 'seguimiento', FALSE, FALSE, TRUE, FALSE, 120),
    ('negativa_pago', 'Negativa de pago', 3, 'rechazo_pago', TRUE, FALSE, FALSE, FALSE, 130),
    ('incumplimiento', 'Incumplimiento', 3, 'promesa_incumplida', TRUE, FALSE, TRUE, FALSE, 140),
    ('informacion_adicional', 'Información adicional', 3, 'seguimiento', TRUE, FALSE, FALSE, FALSE, 150),
    ('buzon', 'Buzón de voz', 4, 'no_localizado', FALSE, FALSE, TRUE, FALSE, 160),
    ('no_contesta', 'No contesta', 4, 'no_localizado', FALSE, FALSE, TRUE, FALSE, 170),
    ('sin_contacto', 'Sin contacto', 4, 'no_localizado', FALSE, FALSE, TRUE, FALSE, 180),
    ('numero_equivocado', 'Número equivocado', 4, 'datos_incorrectos', FALSE, FALSE, FALSE, FALSE, 190),
    ('defuncion', 'Defunción', 4, 'cerrado', FALSE, FALSE, FALSE, TRUE, 200)
) AS catalogo(
  codigo,
  nombre,
  prioridad,
  estado_resultante,
  contacto_efectivo,
  requiere_promesa,
  requiere_seguimiento,
  cierra_cuenta,
  orden
);

CREATE TABLE public.cartera_gestiones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  cuenta_id BIGINT NOT NULL
    REFERENCES public.cartera_cuentas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  tipificacion_id BIGINT NOT NULL,
  usuario_id INTEGER
    REFERENCES public.usuarios(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  tipificacion_codigo VARCHAR(100) NOT NULL
    CHECK (
      tipificacion_codigo ~ '^[a-z0-9][a-z0-9_]{0,99}$'
    ),
  tipificacion_nombre VARCHAR(150) NOT NULL
    CHECK (
      CHAR_LENGTH(BTRIM(tipificacion_nombre)) BETWEEN 1 AND 150
    ),
  prioridad SMALLINT NOT NULL
    CHECK (prioridad BETWEEN 1 AND 4),
  estado_resultante VARCHAR(50) NOT NULL
    CHECK (
      estado_resultante IN (
        'contactado',
        'no_localizado',
        'seguimiento',
        'promesa_pago',
        'promesa_incumplida',
        'convenio',
        'pago_realizado',
        'rechazo_pago',
        'datos_incorrectos',
        'cerrado'
      )
    ),
  codigo_resultado VARCHAR(30)
    CHECK (
      codigo_resultado IS NULL
      OR codigo_resultado ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'
    ),
  canal VARCHAR(30) NOT NULL
    CHECK (
      canal IN (
        'telefono',
        'whatsapp',
        'correo',
        'sms',
        'visita',
        'otro'
      )
    ),
  telefono_contactado VARCHAR(100),
  persona_contactada VARCHAR(200),
  relacion_contacto VARCHAR(30)
    CHECK (
      relacion_contacto IS NULL
      OR relacion_contacto IN (
        'titular',
        'familiar',
        'referencia',
        'tercero',
        'sin_contacto'
      )
    ),
  promesa_monto NUMERIC(18, 2)
    CHECK (promesa_monto IS NULL OR promesa_monto > 0),
  promesa_fecha DATE,
  promesa_estado VARCHAR(20)
    CHECK (
      promesa_estado IS NULL
      OR promesa_estado IN (
        'pendiente',
        'cumplida',
        'incumplida',
        'cancelada'
      )
    ),
  proximo_seguimiento_at TIMESTAMPTZ,
  seguimiento_estado VARCHAR(20)
    CHECK (
      seguimiento_estado IS NULL
      OR seguimiento_estado IN (
        'pendiente',
        'completado',
        'cancelado'
      )
    ),
  notas TEXT,
  evidencia TEXT,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartera_gestiones_tipificacion_empresa_fkey
    FOREIGN KEY (empresa_id, tipificacion_id)
    REFERENCES public.cartera_tipificaciones(empresa_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT cartera_gestiones_promesa_completa
    CHECK (
      (
        promesa_monto IS NOT NULL
        AND promesa_fecha IS NOT NULL
        AND promesa_estado IS NOT NULL
      )
      OR (
        promesa_monto IS NULL
        AND promesa_fecha IS NULL
        AND promesa_estado IS NULL
      )
    ),
  CONSTRAINT cartera_gestiones_seguimiento_completo
    CHECK (
      (
        proximo_seguimiento_at IS NOT NULL
        AND seguimiento_estado IS NOT NULL
      )
      OR (
        proximo_seguimiento_at IS NULL
        AND seguimiento_estado IS NULL
      )
    ),
  CONSTRAINT cartera_gestiones_contenido_requerido
    CHECK (
      NULLIF(BTRIM(notas), '') IS NOT NULL
      OR NULLIF(BTRIM(evidencia), '') IS NOT NULL
    ),
  CONSTRAINT cartera_gestiones_notas_longitud
    CHECK (notas IS NULL OR CHAR_LENGTH(notas) <= 2000),
  CONSTRAINT cartera_gestiones_evidencia_longitud
    CHECK (evidencia IS NULL OR CHAR_LENGTH(evidencia) <= 1000)
);

CREATE INDEX ix_cartera_gestiones_empresa_fecha
  ON public.cartera_gestiones (
    empresa_id,
    creada_at DESC,
    id DESC
  );

CREATE INDEX ix_cartera_gestiones_cuenta_fecha
  ON public.cartera_gestiones (
    cuenta_id,
    creada_at DESC,
    id DESC
  );

CREATE INDEX ix_cartera_gestiones_seguimiento
  ON public.cartera_gestiones (
    empresa_id,
    seguimiento_estado,
    proximo_seguimiento_at,
    cuenta_id
  )
  WHERE proximo_seguimiento_at IS NOT NULL;

CREATE INDEX ix_cartera_gestiones_promesa
  ON public.cartera_gestiones (
    empresa_id,
    promesa_estado,
    promesa_fecha,
    cuenta_id
  )
  WHERE promesa_fecha IS NOT NULL;

ALTER TABLE public.cartera_historial
  ADD COLUMN gestion_id BIGINT
    REFERENCES public.cartera_gestiones(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX ux_cartera_historial_gestion
  ON public.cartera_historial (gestion_id)
  WHERE gestion_id IS NOT NULL;

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '007_create_portfolio_management_records',
  'Crear catálogo de tipificaciones y registro estructurado de gestiones'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
