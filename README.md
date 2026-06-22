# Translyo

Translate documents (`.docx`, `.pptx`, `.xlsx`, `.txt`) while keeping the original formatting.
Deployed entirely on **Cloudflare** — Pages (frontend + functions) + KV (database).
Translation by **Volcano Ark (火山方舟)**. Payments by **Creem**. No other accounts needed.

## Architecture (why it can't be bypassed)

```
Browser (index.html)
   │  POST /api/translate  (raw file bytes + target language)
   ▼
Cloudflare Pages Function  /functions/api/translate.js
   ├─ getPlan(license)        ← KV: is this a paid user?
   ├─ checkAndCountFree(ip)   ← KV: daily free limit (server-side)
   ├─ size limit check        ← server-side
   └─ translateDocument()     ← calls Volcano Ark with ARK_API_KEY (server-only secret)
   ▼
Returns the translated file

Creem ──webhook──▶ /functions/api/webhook.js ──▶ KV "sub:<license>" (verified HMAC signature)
```

The API key, the quota counting, and the paid-user check all run on the server.
Editing the page in the browser cannot grant free or paid translations.

## Files
```
index.html  privacy.html  terms.html  refund.html   ← static frontend (served from repo root)
functions/api/translate.js   ← main endpoint
functions/api/webhook.js     ← Creem webhook
functions/_lib/engine.js     ← Ark call + docx/pptx/xlsx/txt rebuild
functions/_lib/quota.js      ← server-side quota + plan lookup (KV)
package.json                 ← lists fflate (bundled by Cloudflare at build)
.env.example                 ← variables to set in the dashboard
(the /api, /lib, /supabase folders are leftovers — safe to delete)
```

## Deploy — all on Cloudflare (~20 min, no new accounts)

### 1. Put the code on GitHub
You already have GitHub. Create a new repo (e.g. `translyo`) and upload all these files
(github.com → your repo → Add file → Upload files → drag the whole folder).

### 2. Create the KV database
Cloudflare dashboard → Storage & Databases → KV → Create namespace → name it `translyo`.

### 3. Create the Pages project
Cloudflare → Compute (Workers & Pages) → Create → Pages → Connect to Git → pick the repo.
- Framework preset: **None**
- Build command: leave empty
- Build output directory: `/`
Deploy.

### 4. Add variables + KV binding
Pages project → Settings:
- **Variables and Secrets**: add `ARK_API_KEY` (Secret), `ARK_MODEL`, and later `CREEM_WEBHOOK_SECRET` (Secret). Optionally the limit vars.
- **Bindings → KV namespace**: add binding, Variable name = `KV`, namespace = `translyo`.
- Redeploy so the settings take effect.

### 5. Connect the domain (DNS is automatic here)
Pages project → Custom domains → add `translyo.com` (and `www`).
Because the domain is already in this Cloudflare account, the DNS records are created
for you — no manual records needed.

### 6. Creem (after approval)
Create the product + checkout link, wire it to the "Upgrade" buttons, add a webhook to
`https://translyo.com/api/webhook`, and paste its signing secret into `CREEM_WEBHOOK_SECRET`.

## Notes
- Free Cloudflare Workers has a per-request CPU limit; normal documents are fine. If very large
  files time out, enable the Workers paid plan ($5/mo).
- Roadmap: v2 = PDF, EPUB, glossary, translation memory.
