# MyLook (MVP)

Mobile-first web app (wrapper-ready for Android) to:
- Upload/store clothing, shoes, and accessories
- Generate outfit suggestions by look type
- Regenerate until accepted
- Save accepted looks to history
- Use season/weather/time context (with day/night override)
- Call OpenAI API for smarter, up-to-date styling suggestions

## Run locally

This app is plain HTML/CSS/JS. From this folder, run any static server:

```bash
npx serve .
```

or

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

## Core behavior

1. Add wardrobe items in `Wardrobe` (image + category + tags + season).
2. In `Home`, pick a predefined look type or enter a custom one.
3. App reads location + weather and infers season/time.
4. Click `Generate Look`.
5. If you like it, click `Accept Look` to store in `History`.
6. If not, click `Regenerate`.

## OpenAI integration

- Open `Settings`.
- Paste your OpenAI API key.
- Optional: choose model (default `gpt-4.1-mini`).

Notes:
- API key is stored in local storage for MVP convenience.
- For production, move OpenAI calls to your backend so the key is never shipped in-app.

## Supabase (implemented)

This app is now wired to Supabase using:
- Project URL: `https://fyvaczvzghtdnioxgrqo.supabase.co`
- Publishable key: your provided `sb_publishable_...`
- Storage bucket: `wardrobe-images`

### 1) Run SQL schema

Open Supabase SQL Editor and run `supabase/schema.sql`.

If you already created the original tables before this feature update, run:
- `supabase/migration_20260219_feature_pack.sql`

### 2) Create storage bucket

In Supabase Storage, create a public bucket named `wardrobe-images`.

### 3) Behavior

- Wardrobe items and history are synced to Supabase.
- Uploaded images are stored in Supabase Storage.
- App errors are logged in `public.app_logs`.
- Existing local wardrobe/history are auto-migrated on first successful sync if remote tables are empty.
- OpenAI API key remains local-only in browser storage.

Note:
- With no auth, table/storage policies are currently open to `anon` for MVP convenience.
- For production, add auth and user-scoped RLS policies.

## Android wrapper options

### Option A: Capacitor (recommended)

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init mylook com.mylook.app --web-dir=.
npx cap add android
npx cap open android
```

Build and run from Android Studio.

### Option B: Trusted Web Activity / WebView wrapper

Use this web app as embedded content in your existing Android project.

## Files

- `index.html` UI structure and screens
- `styles.css` mobile-first design
- `app.js` app logic, storage, weather context, OpenAI calls
