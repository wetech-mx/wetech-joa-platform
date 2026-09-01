# Monitor de sesiones

## Alcance

El monitor permite que un Administrador o Super Admin consulte los accesos de
su empresa y cierre de forma remota una sesión específica. Un Ejecutivo no
puede consultar ni operar este módulo.

Esta primera versión controla sesiones reales. No limita todavía una cantidad
contratada de licencias ni impide que un mismo usuario abra más de una sesión.

## Datos registrados

Cada inicio de sesión crea un identificador UUID independiente y conserva:

- empresa y usuario;
- fecha de inicio, última actividad y caducidad;
- dirección IP entregada por el proxy local;
- agente del navegador;
- fecha, responsable y motivo de cierre.

No se almacena el token JWT ni la contraseña. Las sesiones caducan después de
12 horas y la pantalla conserva como historial visible las finalizadas durante
las últimas 24 horas.

## Estados de la pantalla

- **En línea:** sesión vigente con actividad durante los últimos 150 segundos.
- **Sin actividad:** sesión vigente sin actividad durante ese periodo.
- **Cerrada:** sesión terminada por el usuario, por administración o por
  caducidad.

El frontend envía una señal de actividad cada 60 segundos mientras permanece
abierto. Las demás peticiones autenticadas también validan la sesión y pueden
actualizar la última actividad con una frecuencia máxima de una escritura cada
30 segundos.

## Cierre remoto

El Administrador puede cerrar cualquier otra sesión activa dentro de su misma
empresa. No puede cerrar desde el monitor la sesión que está utilizando; debe
usar el botón normal **Cerrar sesión**. Un Administrador tampoco puede cerrar
una sesión de Super Admin, salvo que quien ejecuta la acción sea Super Admin.

Después del cierre remoto, el token deja de ser válido en la siguiente petición
al servidor. El usuario será enviado al inicio de sesión.

## Compatibilidad al publicar

Los tokens emitidos antes de instalar esta versión no tienen identificador de
sesión. Por seguridad serán rechazados y cada usuario deberá iniciar sesión una
vez después de la publicación.
