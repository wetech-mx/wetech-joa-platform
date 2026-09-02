# Campañas abiertas y Casos

## Modos de distribución

Cada campaña conserva uno de estos modos:

- `round_robin`: cada cuenta nueva se asigna automáticamente al siguiente Ejecutivo activo.
- `manual`: la cuenta nueva queda sin responsable hasta que un Administrador la asigne.
- `abierta`: todos los Ejecutivos de la empresa pueden buscar, consultar y gestionar las cuentas de la campaña.

Las campañas existentes reciben `round_robin` al aplicar la migración 011. Cambiar el modo no elimina asignaciones ni historiales anteriores. En una campaña abierta, una asignación anterior deja de limitar el acceso; se conserva como evidencia histórica.

Cada cambio de nombre, estado o modo de campaña registra el Administrador, la fecha, el valor anterior y el nuevo.

## Trabajo simultáneo

Dos usuarios pueden mantener el mismo expediente abierto. Las consultas no bloquean la cuenta.

Al guardar una gestión, PostgreSQL bloquea únicamente esa cuenta dentro de una transacción. Por ello:

1. la primera gestión que llega se guarda completa;
2. la segunda espera unos instantes;
3. al liberarse la cuenta, la segunda vuelve a validar el estado vigente y se guarda como otro registro;
4. la hora se toma en el instante real de inserción, no al comenzar la espera;
5. ambas aparecen en el historial ordenadas por fecha e identificador, cada una con su autor.

Si la primera operación cerró la cuenta o dejó un pago pendiente de validación, la segunda no se fuerza sobre un estado anterior: se rechaza con un mensaje controlado para que el usuario actualice el expediente.

## Casos

Un Caso siempre pertenece a una cuenta de cartera. Contiene:

- título;
- prioridad;
- estado;
- Ejecutivo responsable;
- comentarios;
- solución;
- fecha de creación y modificación automáticas;
- versión de concurrencia e historial.

Los Ejecutivos crean el Caso asignado a sí mismos. Un Administrador puede seleccionar o cambiar al Ejecutivo responsable. La solución es obligatoria al resolver o cerrar.

Las fechas se generan en el servidor; el usuario no tiene que cambiarlas diariamente.

Cada actualización bloquea el Caso y compara su versión. Si otra persona lo modificó primero, el segundo guardado recibe un conflicto y debe actualizar la información. Esto evita que una edición silenciosamente borre la otra.

### Cierre y reapertura

Un Ejecutivo puede llevar el Caso hasta `Cerrado`, siempre con una solución. Una vez cerrado, todos sus campos quedan disponibles únicamente para consulta y la edición normal se bloquea tanto en la interfaz como en el servidor.

Solo Administración puede reabrirlo mediante la acción separada `Reabrir caso`. La acción exige un motivo, devuelve el Caso a `En proceso`, conserva la solución anterior como referencia y registra administrador, fecha, motivo, estado anterior y estado nuevo.

## Auditoría

La auditoría de la cuenta identifica la sección del movimiento:

- Gestiones;
- Asignaciones;
- Pagos;
- Casos;
- Notas;
- Estado;
- Importación;
- Expediente.

Crear o actualizar un Caso produce historial tanto dentro del Caso como en el expediente de la cuenta.

## Alertas y reportes

En Alertas, un Ejecutivo recibe la cartera abierta como una bandeja compartida. El supervisor la ve una sola vez bajo `Cartera compartida`, evitando multiplicar las mismas cuentas por el número de Ejecutivos.

En el corte general, las cuentas de campañas abiertas se agrupan en `Cartera compartida`. Las gestiones del día continúan atribuyéndose al usuario que realmente las registró.
