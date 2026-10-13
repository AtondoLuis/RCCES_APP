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
