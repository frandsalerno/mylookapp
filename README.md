# MyLook (React + Capacitor)

MyLook is now migrated to a React app with Framer Motion animations and Capacitor Android wrapping.

## Stack
- React + Vite
- Framer Motion
- Lucide React icons
- Supabase (Postgres + Storage)
- OpenAI Responses API

## Run (web)

```bash
npm install
npm run dev
```

## Build for Android wrapper

```bash
npm install
npm run cap:sync
npx cap open android
```

Capacitor uses `dist/` as `webDir`.

## Supabase SQL

If your base tables already exist, run:
- `supabase/migration_20260219_feature_pack.sql`

This adds:
- `is_favorite` fields on wardrobe/history
- `app_logs` table and anon insert/select policies

## Project structure
- `src/App.jsx` main app UI + logic
- `src/styles.css` design system and component styles
- `src/lib/*` constants/helpers/storage
- `supabase/*.sql` schema + migrations
