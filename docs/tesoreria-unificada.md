# Tesorería y aportaciones

La interfaz administrativa está en `/admin/tesoreria`. Las rutas antiguas `/tesoreria` y `/aportaciones` redirigen allí después de comprobar la sesión y el permiso `treasury.view`. La pantalla mantiene un resumen visible y permite abrir una sección principal a la vez: eventos y aportaciones, entradas y salidas, o estado de cuenta.

## Migración pendiente

Antes de utilizar la nueva interfaz en un entorno compartido, revisar y aplicar `supabase/migrations/20261118010000_unified_treasury.sql` mediante el proceso habitual del proyecto. **No se aplicó a Supabase remoto.** Hasta aplicarla, las llamadas nuevas a `add_fundraising_participants`, `remove_fundraising_participant`, `update_fundraising_event` y `register_fundraising_payment_once` no estarán disponibles.

La migración agrega estado de participación, una clave única de idempotencia por pago y RPC con validación de parroquia, evento activo y permiso `treasury.manage`. La función de cobro reutiliza la transacción existente que inserta el pago, la entrada financiera y la auditoría; ante un reintento con el mismo identificador devuelve el pago previo. La función anterior de cobro deja de estar disponible para el rol `authenticated` para impedir eludir esos controles.

Los pagos registrados no se borran al retirar a un participante: su participación se marca cancelada y se conserva el movimiento. La anulación de un pago específico sigue usando la función auditada existente y anula el movimiento relacionado en la misma transacción.

## Validación manual tras aplicar la migración

1. Crear un evento sin servidores y agregar uno o varios desde el detalle.
2. Registrar un pago completo y comprobar una sola entrada vinculada en el estado de cuenta.
3. Reintentar la misma solicitud y confirmar que no haya otra entrada.
4. Registrar un parcial, completar solo el saldo y anular un pago individual; comprobar el saldo y la auditoría.
5. Retirar un servidor sin pagos y cancelar la participación de otro con pagos; verificar que se conserva el historial.
6. Probar un usuario de otra parroquia y un usuario con `treasury.manage` denegado.
