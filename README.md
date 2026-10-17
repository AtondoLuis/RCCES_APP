# RCCES App · Comisiones para la Santa Misa

Aplicación Next.js para administrar servidores, horarios y comisiones de la Parroquia Santo Toribio Romo.

## Requisitos

- Node.js 20+
- Proyecto Supabase
- Cuenta Vercel para producción

## Ejecutar localmente

```bash
npm install
copy .env.example .env.local
npm run dev
```

Configura `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o la clave anon compatible) en `.env.local`. Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` al navegador.

## Supabase

1. Crea un proyecto en Supabase.
2. Abre el SQL Editor y ejecuta `supabase/migrations/0001_initial_schema.sql`.
3. Ejecuta `supabase/seed.sql`.
4. Activa Email/Password en Authentication y crea el primer usuario.
5. Inserta su perfil en `profiles` con rol `ADMIN` y el `parish_id` de la parroquia.
6. Revisa Storage: se crean `parish-assets`, `mass-images` y `generated-schedules`.

El cliente SSR está preparado en `src/lib/supabase/client.ts`; el dashboard usa Supabase cuando las variables están configuradas y conserva datos demo como fallback de desarrollo visual.

## Validación y deploy

```bash
npm run lint
npm run typecheck
npm run build
```

En Vercel importa el repositorio, define las variables públicas y despliega. En Supabase agrega la URL de Vercel a Authentication > URL Configuration, incluyendo el Site URL y Redirect URLs.

## MVP incluido

- Dashboard responsive mobile/desktop.
- Editor de comisión con selectores filtrados por servicio.
- Advertencia ante asignaciones duplicadas.
- Persistencia de misa y asignaciones mediante Supabase cuando hay configuración.
- Vista previa estilo hoja, impresión, generación/descarga PNG y compartir por Web Share/WhatsApp.
- Migración SQL con modelo normalizado, índices, RLS y Storage.

La gestión de personas y catálogos está modelada en Supabase y queda lista para conectar pantallas CRUD administrativas en la siguiente iteración.


### Administracion de usuarios

Aplicar la migracion nueva `20261017201021_app_user_administration.sql` antes de desplegar esta version. No reaplicar las migraciones anteriores. Reutiliza `profiles` (id de Auth) y agrega `active` y `person_id` opcional, unico por servidor. Los perfiles historicos sin parroquia quedan sin acceso hasta que se regularicen administrativamente.

Configurar `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en el servidor y `APP_URL` con el origen publico de RCCES. Consultar `.env.example`; no publicar claves reales. En Supabase Auth, autorizar `${APP_URL}/auth/callback` como Redirect URL. La invitacion estandar por email llega a ese callback; tambien se admite una plantilla con `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite` (Site URL debe apuntar a RCCES). La cuenta verifica su perfil activo y establece su propia contrasena antes de entrar a comisiones.

Solo ADMIN administra usuarios de su propia parroquia. COORDINADOR mantiene comisiones y servidores; LECTOR solo lectura. No se cambia email ni se eliminan cuentas desde esta UI. `active=false` bloquea rutas, APIs y Data API aun con un JWT vigente; no se borra ni se banea la cuenta de Auth. RLS y un trigger serializado por parroquia impiden quitar el ultimo ADMIN activo. Se conservan las asignaciones y el historial.

El estado de invitacion se obtiene de Auth (`invited_at`, sin confirmacion ni ultimo acceso); no se infiere de la fecha del perfil. Sin clave administrativa el listado y la edicion de perfiles siguen disponibles, pero invitaciones/ultimo acceso no. Si el envio de email tiene exito y la preparacion del perfil falla, la API lo informa explicitamente y la cuenta queda sin acceso hasta reparar el perfil; no se elimina la cuenta de Auth como compensacion. No se agrego infraestructura de auditoria porque el proyecto no tenia una.
