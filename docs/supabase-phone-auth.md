# Autenticación por celular en Supabase

## Estado local

La pantalla de login admite correo/contraseña y celular mexicano de 10 dígitos. El celular se normaliza a \`+52XXXXXXXXXX\` y usa \`signInWithOtp\` con \`shouldCreateUser: false\`; por ello un número no registrado no crea una cuenta nueva. El OTP se verifica con \`verifyOtp({ type: "sms" })\`.

Los usuarios autenticados pueden vincular un celular desde \`Mi perfil\` en \`/portal\`. La vinculación usa \`auth.updateUser({ phone })\` y se confirma con \`verifyOtp({ type: "phone_change" })\`. No se escriben contraseñas, OTP ni teléfonos Auth en tablas propias; el perfil existente, su rol, permisos, historial y parroquia permanecen intactos.

## Configuración pendiente en Supabase

1. En Authentication > Providers > Phone, activar Phone Auth.
2. Configurar un proveedor SMS compatible disponible para el proyecto y verificar el remitente/plantilla exigidos por ese proveedor.
3. Mantener desactivada la creación automática de usuarios para este flujo; la aplicación también envía \`shouldCreateUser: false\`.
4. Confirmar que las URLs permitidas incluyan el origen local y los orígenes de producción autorizados. No se requieren redirecciones OAuth para OTP.
5. Revisar límites, costos por SMS, restricciones regionales y límites de frecuencia del proveedor. La aplicación aplica una espera local de 30 segundos para reenvíos, pero el proveedor/Supabase siguen siendo la autoridad final.

## Seguridad y operación

- No se debe asociar un teléfono solo porque coincida con \`profiles.phone_contact\`, \`people.phone\` o cualquier otro dato de perfil.
- Si el teléfono ya está asociado a otra identidad Auth, Supabase debe rechazar \`updateUser\`; la interfaz muestra un mensaje genérico y no revela la pertenencia del número.
- No se deben fusionar cuentas automáticamente ni cambiar roles durante la vinculación.
- RLS, \`profiles.active\`, \`profiles.parish_id\` y \`has_app_permission\` siguen gobernando el acceso posterior al login.
- La cookie de sesión de \`@supabase/ssr\` evita solicitar SMS en cada visita mientras la sesión siga vigente.

## Procedimiento para usuarios existentes

El usuario inicia sesión con correo y contraseña, abre \`Mi perfil\`, solicita la vinculación, introduce el OTP y vuelve a iniciar sesión con el celular en una visita posterior. Si falla porque el número ya está ocupado, Administración debe resolverlo manualmente; no se recomienda modificar identidades ni fusionar cuentas desde la aplicación.

No se aplicaron migraciones remotas ni cambios de configuración en Supabase.
