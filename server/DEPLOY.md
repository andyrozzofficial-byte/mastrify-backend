# Mastrify API server (canonical)

**Production:** Railway service `mastrify-backend-production` deploys from the **`mastrify` Git repo** with **Root Directory = `server`**.

Start command: `npm start` → `node server.js`

Verify deployed revision:

```bash
curl https://mastrify-backend-production.up.railway.app/debug-version
# {"debugVersion":"NEW_MASTER_RESPONSE_V2"}
```

The separate `mastrify-backend` GitHub repo is kept in sync with this folder for backup/history — **Railway does not deploy from that repo** (confirmed via production probe + `origin/main` diff).

Required env (Railway):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` (optional; local `/tmp` fallback)
- `MASTRIFY_RETENTION_SEC` or `MASTRIFY_SIGNED_URL_TTL_SEC` (optional; default **43200** = 12 hours — signed URLs and Supabase WAV/MP3 deletion)
- `MASTRIFY_STORAGE_CLEANUP_INTERVAL_MS` (optional; default **900000** = 15 minutes)
- `RESEND_API_KEY` (email delivery via `POST /master/deliver`)
- `STRIPE_SECRET_KEY` (same test/live secret as Vercel — verifies `POST /master/download` and `POST /master/deliver`)

Frontend env: see `mastrify/.env.example` (Stripe Checkout runs on Vercel/Next API routes).

**Local test flow:** set `STRIPE_SECRET_KEY=sk_test_...` in `.env.local` (frontend) and in the server env, set `NEXT_PUBLIC_APP_URL=http://localhost:3000`, run backend on `:3001` and `npm run dev` on `:3000`. Use card `4242 4242 4242 4242`.
