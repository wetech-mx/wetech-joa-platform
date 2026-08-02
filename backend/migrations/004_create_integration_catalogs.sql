BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('crm-migration-004-create-integration-catalogs')
);

CREATE TABLE public.crm_tipos_integracion (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  categoria VARCHAR(30) NOT NULL
    CHECK (
      categoria IN (
        'http',
        'transferencia',
        'archivo',
        'base_datos',
        'descubrimiento'
      )
    ),
  descripcion TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.crm_tipos_integracion (
  codigo,
  nombre,
  categoria,
  descripcion
)
VALUES
  (
    'api_rest',
    'API REST',
    'http',
    'Intercambio mediante servicios HTTP REST'
  ),
  (
    'api_soap',
    'API SOAP',
    'http',
    'Intercambio mediante servicios HTTP SOAP'
  ),
  (
    'webhook',
    'Webhook',
    'http',
    'Recepción de eventos HTTP enviados por el origen'
  ),
  (
    'sftp',
    'SFTP',
    'transferencia',
    'Transferencia segura de archivos mediante SSH'
  ),
  (
    'archivo_excel',
    'Archivo Excel',
    'archivo',
    'Importación controlada de archivos XLSX o XLS'
  ),
  (
    'archivo_csv',
    'Archivo CSV',
    'archivo',
    'Importación controlada de archivos CSV'
  ),
  (
    'carpeta_compartida',
    'Carpeta compartida',
    'archivo',
    'Lectura controlada desde una carpeta de red'
  ),
  (
    'firebird',
    'Firebird SQL',
    'base_datos',
    'Conexión de solo lectura a una base Firebird'
  ),
  (
    'sql_server',
    'Microsoft SQL Server',
    'base_datos',
    'Conexión de solo lectura a Microsoft SQL Server'
  ),
  (
    'odbc',
    'ODBC',
    'base_datos',
    'Conexión mediante un controlador ODBC compatible'
  ),
  (
    'aspel_dac',
    'Aspel DAC',
    'descubrimiento',
    'Localización controlada del Directorio de Archivos Comunes de Aspel'
  );

CREATE TABLE public.crm_origenes (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  codigo VARCHAR(100) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  tipo VARCHAR(30) NOT NULL
    CHECK (
      tipo IN (
        'cliente_cobranza',
        'sistema_interno',
        'otro'
      )
    ),
  descripcion TEXT,
  metadatos JSONB NOT NULL DEFAULT '{}'::JSONB,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_origenes_codigo_formato
    CHECK (codigo ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  CONSTRAINT crm_origenes_empresa_codigo_unico
    UNIQUE (empresa_id, codigo),
  CONSTRAINT crm_origenes_empresa_id_unico
    UNIQUE (empresa_id, id)
);

CREATE INDEX ix_crm_origenes_empresa_activo
  ON public.crm_origenes (
    empresa_id,
    activo,
    nombre
  );

CREATE TABLE public.crm_integraciones (
  id BIGSERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL
    REFERENCES public.empresas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  origen_id BIGINT NOT NULL,
  tipo_codigo VARCHAR(50) NOT NULL
    REFERENCES public.crm_tipos_integracion(codigo)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  codigo VARCHAR(100) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  producto VARCHAR(100),
  adaptador VARCHAR(100) NOT NULL,
  direccion VARCHAR(20) NOT NULL DEFAULT 'entrada'
    CHECK (
      direccion IN (
        'entrada',
        'salida',
        'bidireccional'
      )
    ),
  modo_ejecucion VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (
      modo_ejecucion IN (
        'manual',
        'programada',
        'evento'
      )
    ),
  configuracion_no_secreta JSONB NOT NULL
    DEFAULT '{}'::JSONB,
  referencia_secreto VARCHAR(255),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  ultima_ejecucion_at TIMESTAMPTZ,
  ultimo_estado VARCHAR(30),
  ultimo_error_codigo VARCHAR(100),
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_integraciones_codigo_formato
    CHECK (codigo ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  CONSTRAINT crm_integraciones_empresa_codigo_unico
    UNIQUE (empresa_id, codigo),
  CONSTRAINT crm_integraciones_origen_empresa_fkey
    FOREIGN KEY (empresa_id, origen_id)
    REFERENCES public.crm_origenes(empresa_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

COMMENT ON COLUMN
  public.crm_integraciones.configuracion_no_secreta
IS
  'Configuración operativa sin contraseñas, tokens ni llaves privadas';

COMMENT ON COLUMN
  public.crm_integraciones.referencia_secreto
IS
  'Referencia lógica a credenciales almacenadas únicamente en el servidor';

CREATE INDEX ix_crm_integraciones_origen_activa
  ON public.crm_integraciones (
    empresa_id,
    origen_id,
    activo
  );

CREATE INDEX ix_crm_integraciones_tipo_activa
  ON public.crm_integraciones (
    tipo_codigo,
    activo
  );

WITH banco_azteca AS (
  INSERT INTO public.crm_origenes (
    empresa_id,
    codigo,
    nombre,
    tipo,
    descripcion
  )
  SELECT
    empresa.id,
    'banco_azteca',
    'Banco Azteca',
    'cliente_cobranza',
    'Primer origen de cartera de Rosas y Asociados'
  FROM public.empresas empresa
  WHERE empresa.id = 1
  ON CONFLICT (empresa_id, codigo)
  DO UPDATE SET
    nombre = EXCLUDED.nombre,
    tipo = EXCLUDED.tipo,
    descripcion = EXCLUDED.descripcion,
    activo = TRUE,
    actualizado_at = NOW()
  RETURNING
    id,
    empresa_id
)
INSERT INTO public.crm_integraciones (
  empresa_id,
  origen_id,
  tipo_codigo,
  codigo,
  nombre,
  producto,
  adaptador,
  direccion,
  modo_ejecucion,
  referencia_secreto
)
SELECT
  banco_azteca.empresa_id,
  banco_azteca.id,
  'api_rest',
  'banco_azteca_api',
  'API Banco Azteca',
  'banco_azteca',
  'banco_azteca_api',
  'entrada',
  'programada',
  'servidor:backend_env_banco_azteca'
FROM banco_azteca
ON CONFLICT (empresa_id, codigo)
DO UPDATE SET
  origen_id = EXCLUDED.origen_id,
  tipo_codigo = EXCLUDED.tipo_codigo,
  nombre = EXCLUDED.nombre,
  producto = EXCLUDED.producto,
  adaptador = EXCLUDED.adaptador,
  direccion = EXCLUDED.direccion,
  modo_ejecucion = EXCLUDED.modo_ejecucion,
  referencia_secreto = EXCLUDED.referencia_secreto,
  activo = TRUE,
  actualizado_at = NOW();

INSERT INTO public.crm_migrations (
  version,
  descripcion
)
VALUES (
  '004_create_integration_catalogs',
  'Crear orígenes y conectores multi-origen sin alterar la cartera operativa'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
