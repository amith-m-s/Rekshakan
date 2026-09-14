# RescuerMap setup guide

Everything you need to do by hand to take RescuerMap from "runs on my laptop with sample data" to
"live on a public URL, backed by Supabase". Do the parts in order; each ends with a check so you
know it worked before moving on.

| Part | What | Time | Needed for |
| --- | --- | --- | --- |
| 1 | Rotate the leaked Groq key | 5 min | Safety, before anything is public |
| 2 | Supabase: keys and schema | 15 min | Saving zones, alerts, reports; realtime |
| 3 | Local environment and check | 10 min | Confirming 1–2 before deploying |
| 4 | Vercel deploy | 20 min | The mobile app (needs a public URL) |
| 5 | Final checklist | 5 min | |

All commands are for **PowerShell** in the project folder (`C:\Users\natha\OneDrive\Projects\Rekshakan`).
Inside Claude Code you can run one by prefixing it with `!`, for example `! npx vercel login`.

---

## Part 1: Rotate the Groq key

A Groq API key was typed into `test-groq.mjs`. The file is git-ignored, so it was never committed, but
treat the key as exposed and replace it.

1. Go to <https://console.groq.com/keys> and sign in.
2. Click **Create API Key**, name it `rescuermap`, and copy the new key (it starts with `gsk_`).
3. In the same list, **delete the old key**, the one that was in `test-groq.mjs`.
4. Delete the test file:
   ```powershell
   Remove-Item test-groq.mjs
   ```
5. You'll paste the new key into `.env.local` in Part 3.

---

## Part 2: Supabase

The project already exists (its URL and public key are in `.env.local`). You need one more key, and you
need to create the tables.

### 2.1 Find your keys

1. Open <https://supabase.com/dashboard> and select the RescuerMap project.
2. Go to **Project Settings → API Keys**.
3. Supabase shows keys in one of two styles. Either works; use the same style for both:

   | What the app calls it | New-style name | Legacy name (under "Legacy API keys") | Safe to expose? |
   | --- | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Publishable key** (`sb_publishable_…`) | `anon` `public` (starts `eyJ…`) | Yes, it's read-only under our rules |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Secret key** (`sb_secret_…`) | `service_role` (starts `eyJ…`) | **No, never** |

4. Copy the **secret / service_role** key. If there is no secret key yet, click **Create new secret key**.

> **The secret key bypasses all security rules.** Never put it in a variable starting with
> `NEXT_PUBLIC_`, never commit it, never paste it into the mobile app. It belongs only in
> `.env.local` and in Vercel's environment variables.

5. Also on this page (or **Project Settings → General**), note the **Project URL**
   (`https://<something>.supabase.co`). It should match `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`.

### 2.2 Create the tables

1. In the left sidebar open **SQL Editor → New query**.
2. Open `supabase/schema.sql` from this repo in VS Code, select all, copy, and paste it into the editor.
3. Click **Run** (or Ctrl+Enter). You should see **"Success. No rows returned"**.
   - If Supabase warns that the query has **destructive operations** (it drops and recreates
     policies), that's expected. Confirm and run.
   - The file is safe to run again later; it won't duplicate data.

What it creates:

| Table | Purpose | Public key can… |
| --- | --- | --- |
| `zones` | 5 editable demo zones (Santa Cruz Mountains) | read |
| `alerts` | Every alert generated from the dashboard | read |
| `reports` | Field reports from the mobile app | read |
| `report_rate` | Rate-limit ledger (hashed IPs) | nothing |

It also turns on **realtime** for `zones`, `alerts` and `reports`, so the dashboard updates instantly.

### 2.3 Check it worked

1. **Table Editor**: you should see the four tables, and `zones` should have 5 rows.
2. **Database → Publications → supabase_realtime**: `zones`, `alerts` and `reports` should be listed
   (toggled on).
3. **Authentication → Policies** (or each table's "RLS policies"): `zones`, `alerts`, `reports` each
   have one **SELECT** policy; `report_rate` has none. RLS is **enabled** on all four.

---

## Part 3: Local environment and check

### 3.1 `.env.local`

Open `.env.local` and make it look like this (keep your existing values; add the new lines):

```dotenv
# NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/api/map_key/)
FIRMS_MAP_KEY=...

# Groq: the NEW key from Part 1
GROQ_API_KEY=gsk_...

# CARTO basemap key (public, used in the browser)
NEXT_PUBLIC_CARTO_KEY=...

# Supabase (Part 2)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...          # publishable / anon key
SUPABASE_SERVICE_ROLE_KEY=...              # secret / service_role key (NEW)

# Optional: password for the dashboard (see below). Leave unset locally if you like.
DASHBOARD_PASSWORD=choose-a-long-passphrase

# Optional: report rate limits per client (defaults shown)
# REPORTS_PER_MINUTE=20
# REPORTS_PER_HOUR=300

# Optional: override the Groq model
# GROQ_MODEL=openai/gpt-oss-120b
```

Reference:

| Variable | Required | Secret | Used for |
| --- | --- | --- | --- |
| `FIRMS_MAP_KEY` | yes | yes | Satellite fire hotspots |
| `GROQ_API_KEY` | yes | yes | Writing alerts |
| `NEXT_PUBLIC_CARTO_KEY` | yes | no (public) | Basemap tiles without the "API key required" watermark |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | no (public) | Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | no (public, read-only) | Realtime in the browser; reads |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **yes** | Server writes (status changes, alerts, reports) |
| `DASHBOARD_PASSWORD` | recommended when deployed | yes | Protects the dashboard and paid/rate-limited APIs |
| `REPORTS_PER_MINUTE`, `REPORTS_PER_HOUR` | no | no | Spam limits on `POST /api/reports` |
| `GROQ_MODEL` | no | no | Alternative Groq model |

**About `DASHBOARD_PASSWORD`:** when set, the browser shows a sign-in box for the dashboard. Type any
username and the password. These stay open without it, because the mobile app needs them:
`GET /api/zones`, `GET /api/fires`, `GET /api/alert`, `GET /api/reports`, `POST /api/reports`.
Everything else (the dashboard page, changing zone status, generating alerts, geocoding, routing)
needs the password.

### 3.2 Run it

The laptop is short on memory, so prefer the production build over `npm run dev`:

```powershell
npm run build
npx next start
```

Open <http://localhost:3000>.

### 3.3 Check it worked

In the dashboard header you should see three green badges:

- **Cal OES live**: statewide evacuation zones loaded
- **Supabase**: demo zones are coming from your database (amber **Seed data** means the tables weren't
  found; recheck Part 2.2)
- **Realtime**: live updates connected (amber **Polling** means realtime isn't on; recheck Part 2.3 step 2)

Then, in a **second** PowerShell window, send a test field report:

```powershell
Invoke-RestMethod http://localhost:3000/api/reports -Method Post -ContentType application/json `
  -Body '{"kind":"smoke","message":"Setup test","lat":37.12,"lng":-122.12,"reporter":"setup"}'
```

- The report should appear under **Field reports** on the dashboard **within a second**, without refreshing.
- In Supabase **Table Editor → reports**, the row should be there.

Finally, click a **demo** zone (filter: Demo), change its status, and check the `zones` row changed in
Supabase. Delete the test report row afterwards if you like.

---

## Part 4: Deploy to Vercel

The Git repo belongs to `amith-m-s`, so there are two ways to deploy. **Option A (CLI)** works from your
laptop with just your own Vercel account. **Option B (GitHub)** redeploys automatically on every push,
but needs access to that repo.

### 4.1 Create a Vercel account

1. Go to <https://vercel.com/signup>, choose the **Hobby** (free) plan, and sign up. Signing up with
   GitHub is easiest if you plan to use Option B later.

### Option A: Deploy with the Vercel CLI (recommended)

1. **Log in** (opens a browser to confirm):
   ```powershell
   npx vercel login
   ```
2. **Link the folder to a new Vercel project:**
   ```powershell
   npx vercel link
   ```
   Answer the prompts:
   - *Set up and deploy?* → **yes**
   - *Which scope?* → your personal account
   - *Link to existing project?* → **no**
   - *Project name?* → `rescuermap`
   - *In which directory is your code located?* → `./`
   - It should detect **Next.js**; accept the default build settings.

   This creates a `.vercel` folder, which is already git-ignored.

3. **Add the environment variables.** The easiest way is the dashboard:
   1. Open <https://vercel.com/dashboard> → **rescuermap** → **Settings → Environment Variables**.
   2. Copy the contents of `.env.local` and paste them into the **Key** field. Vercel splits a pasted
      `.env` file into separate variables automatically.
   3. Tick the **Production** and **Preview** environments.
   4. Mark `GROQ_API_KEY`, `FIRMS_MAP_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `DASHBOARD_PASSWORD` as
      **Sensitive**.
   5. **Set `DASHBOARD_PASSWORD`** if it isn't in your `.env.local`. A public URL without it lets anyone
      change zone statuses and spend your Groq quota.
   6. Click **Save**.

   Or, from the CLI, add each one (it prompts for the value; repeat for `preview` if you want previews):
   ```powershell
   npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
   ```

4. **Deploy a preview** and try it:
   ```powershell
   npx vercel deploy
   ```
   It prints a `https://rescuermap-<hash>-<you>.vercel.app` URL. Preview URLs are behind **Vercel
   Authentication** by default, so you'll be asked to log in to Vercel. That's normal for previews.

5. **Deploy to production:**
   ```powershell
   npx vercel deploy --prod
   ```
   It prints the production URL, e.g. `https://rescuermap.vercel.app`. **This is the URL the mobile app will use.**

6. **Redeploy after any change** to code or environment variables. `NEXT_PUBLIC_*` values are baked in at
   build time, so changing them requires a new deploy:
   ```powershell
   npx vercel deploy --prod
   ```

### Option B: Deploy from GitHub (the current setup)

The project is imported from `amith-m-s/Rekshakan` into a Vercel account, with the Supabase integration
connected. Production builds `main`; every other pushed branch gets a preview.

1. **Get the dashboard onto `main`:** open a pull request from `feature/dashboard-supabase` into `main`:
   <https://github.com/amith-m-s/Rekshakan/compare/main...feature/dashboard-supabase?expand=1>.
   When it's merged, Vercel deploys production automatically.
   - Vercel also builds a **preview** of the branch as soon as it's pushed. Check that it builds
     (Vercel → project → **Deployments**) before merging.
   - The repo root is the Next.js dashboard. `backend/` is a separate Express app and is excluded from the
     Next.js type check and lint; Vercel doesn't build or run it.
2. **Check the environment variables** (Vercel → project → **Settings → Environment Variables**).
   The Supabase integration adds the Supabase ones for you. Confirm these exist for **Production** and
   **Preview**:
   - From the integration: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` (it also adds `POSTGRES_*` and other `SUPABASE_*` variables the app
     doesn't use; leave them).
   - Add by hand: `FIRMS_MAP_KEY`, `GROQ_API_KEY` (the new key from Part 1), `NEXT_PUBLIC_CARTO_KEY`,
     `DASHBOARD_PASSWORD`.
   - If the integration named a variable differently (for example `SUPABASE_ANON_KEY` without
     `NEXT_PUBLIC_`), add a copy under the name above.
3. **Run the schema** (Part 2.2) in the Supabase project the integration connected. The integration
   connects the database but doesn't create the tables.
4. After changing variables, **redeploy**: Deployments → latest → **⋯ → Redeploy**.

### 4.2 Recommended project settings

In **Settings** for the project:

- **Deployment Protection**: keep the default (**Standard Protection**: previews protected, production
  public). The mobile app must be able to reach the production URL without a Vercel login.
- **Functions → Function Region**: pick the region closest to your Supabase project (Supabase shows it
  under **Project Settings → General**). For example, Supabase `us-west-1` → Vercel `sfo1`, or Supabase
  `ap-south-1` → Vercel `bom1`. Redeploy after changing.

### 4.3 Check the deployment

Replace the URL with your production URL:

```powershell
$u = "https://rescuermap.vercel.app"

# Public endpoints (no password)
(Invoke-RestMethod "$u/api/zones").sources
Invoke-RestMethod "$u/api/reports" -Method Post -ContentType application/json `
  -Body '{"kind":"smoke","message":"Deploy test","lat":34.05,"lng":-118.24,"reporter":"setup"}'

# Protected page: should fail with 401 when DASHBOARD_PASSWORD is set
try { Invoke-WebRequest "$u/" -UseBasicParsing } catch { $_.Exception.Response.StatusCode }
```

Expected:

- `sources` shows `live = caloes` and `demo = supabase`.
- The POST returns the new report with an `id`.
- The page request shows `Unauthorized`.

Then open the URL in a browser, sign in with the password, and confirm the three green badges and the
test report.

If something's wrong, open **Vercel → rescuermap → Logs**. Server warnings from the app are prefixed
`[data]` or `[zones]`.

---

## Part 5: Final checklist

- [ ] Old Groq key deleted in the Groq console; `test-groq.mjs` removed
- [ ] `supabase/schema.sql` run; 4 tables; realtime publication has `zones`, `alerts`, `reports`
- [ ] `.env.local` has `SUPABASE_SERVICE_ROLE_KEY` and the new `GROQ_API_KEY`
- [ ] Local dashboard shows **Cal OES live**, **Supabase**, **Realtime**
- [ ] A test report appears instantly on the dashboard
- [ ] Vercel project deployed to production with all environment variables
- [ ] `DASHBOARD_PASSWORD` set on Vercel; the page asks for it; `/api/zones` doesn't
- [ ] Production URL noted for the mobile app: `https://__________________.vercel.app`

---

## Troubleshooting

**Start here:** open `https://<your-app>/api/health` (sign in with the dashboard password). It shows which
variables are set (yes/no only), which Supabase project the server is connected to, whether each table is
reachable, and hints for what to fix.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Badge says **Seed data** | Tables missing, or URL/key mismatch | Rerun Part 2.2; check `NEXT_PUBLIC_SUPABASE_URL` matches the project |
| Badge says **Supabase** but status changes / alerts don't save; logs show `[data] … failed, using memory` | `SUPABASE_SERVICE_ROLE_KEY` missing or wrong | Add the secret key (Part 2.1), restart / redeploy |
| Badge says **Polling** | Realtime publication missing, or the public key is wrong | Part 2.3 step 2; recheck `NEXT_PUBLIC_SUPABASE_ANON_KEY`; redeploy |
| Map says **API KEY REQUIRED** | `NEXT_PUBLIC_CARTO_KEY` missing at build time | Add it and redeploy; hard-refresh the browser (Ctrl+Shift+R) |
| **Cal OES down** badge | The state feed is briefly unavailable | Wait a few minutes; demo zones still work |
| Generate alert fails with 401 | Groq key revoked or wrong | New key in `.env.local` and Vercel; redeploy |
| `POST /api/reports` returns **429** | Rate limit hit | Wait a minute, or raise `REPORTS_PER_MINUTE` / `REPORTS_PER_HOUR` |
| `POST /api/reports` returns **400** "inside California" | Coordinates are outside the state outline | Use California coordinates |
| Mobile app gets a Vercel login page | It's calling a **preview** URL | Use the production URL |
| `npm run dev` gets killed | Low memory | Use `npm run build` then `npx next start` |
