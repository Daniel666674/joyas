# AI designer backend (Habibi Eisaa demo)

> **Status: NOT in use, on purpose.** The owner decided the demo must not use
> credits of any kind, so nothing here is deployed and the page runs its
> built-in simulation (`apiBase` in `assets/ai-designer-config.js` stays empty).
> Everything below is for the day that decision changes.

A small TypeScript backend that lets the page `disenador-ia.html` turn a pet
photo into a 3D jewelry preview. It exists for one reason: **the Meshy API key
must live on a server, never in the website's code.** The website (GitHub
Pages) talks to this backend, and only the backend talks to Meshy.

```
Browser (disenador-ia.html)  ->  this backend on Vercel  ->  Meshy
        no secrets                 holds the key            makes the 3D model
```

It runs in two modes, chosen by one setting (`PROVIDER`):

| `PROVIDER` | What happens | Cost |
|---|---|---|
| `mock` | Pretends to generate for ~12 s, then returns a ready-made sample model | free |
| `meshy` | Real generation through Meshy | about 15 credits per model on `meshy-6-lite` |

The page also has a built-in simulation that needs **no backend at all** (its
`apiBase` in `assets/ai-designer-config.js` is empty). That is what you see
today on GitHub Pages.

## Deploy it on Vercel (about 10 minutes, no coding)

1. Create a free account at vercel.com and connect your GitHub.
2. **Add New > Project**, pick the `joyas` repository.
3. Before pressing Deploy, set **Root Directory** to `ai-designer-api`.
   (Without this, Vercel looks at the whole website and finds nothing to run.)
4. Open **Environment Variables** and add:
   - `PROVIDER` = `mock` (start with fake results)
   - `DEMO_CODE` = any code you will give your client, e.g. `habibi-demo-26`
   - `ALLOWED_ORIGINS` = `https://daniel666674.github.io`
5. Press **Deploy**. You get an address like `https://something.vercel.app`.
6. Visit `https://something.vercel.app/api/health`. You should see
   `{"ok":true,"enabled":true,"provider":"mock","requiresCode":true}`.
7. Open `assets/ai-designer-config.js` in this repo and set
   `apiBase: "https://something.vercel.app"` (no trailing slash). Commit it.
8. Open the page, enter the demo code, upload a photo. The badge on the viewer
   says "resultados de ejemplo" while the backend is still on `mock`.

Notes: Vercel's free "Hobby" plan may be limited to non-commercial use. Check
their terms before showing this to a paying client. Vercel will also try to
redeploy whenever this repo changes; `vercel.json` tells it to skip builds that
did not touch this folder, so the admin panel's product saves do not trigger it.

## Switch to real 3D generation (Meshy)

1. Create a Meshy account and a **Pro** plan (API access is paid-only; the
   free plan has none). In the dashboard, buy API credits and **turn auto
   top-up off**: your balance is the hard spending limit.
2. Create an API key (it is shown only once) and add it in Vercel as
   `MESHY_API_KEY`. Change `PROVIDER` to `meshy`.
3. Environment variable changes only apply after **Redeploy**.

If `PROVIDER=meshy` and either `MESHY_API_KEY` or `DEMO_CODE` is missing, the
backend refuses to run (answers "no disponible") instead of running half-open.

### First real run: checklist

The Meshy part was written from their public docs and tested against a faked
Meshy, **not against the real service**. On the first real run, with one photo:

- [ ] It finishes, and the model appears in the viewer. If the viewer shows
      "No pudimos mostrar el modelo 3D", Meshy's file link is being blocked
      by the browser; tell the developer (a small relay in this backend fixes it).
- [ ] In Vercel > Logs, find `job_finished` and read `creditsUsed`. Expect
      about 15 on `meshy-6-lite`. If it is higher, set `MESHY_ENABLE_PBR` to
      `false` and compare.
- [ ] Note how long it took, so you can tell the client what to expect.
- [ ] Compare one photo on `MESHY_MODEL=meshy-7.1` (about 30 credits) only if
      the cheap model's quality is clearly too low.

Meshy keeps result files for about 3 days; the page shows them right away, so
nothing needs to be stored. Failed tasks are refunded by Meshy automatically.

## What protects your credits, and what does not

Protects: the key never reaches the browser; the demo code; only your site may
call the backend from a browser; photo type and size checks; the `ENABLED=false`
off switch; and your prepaid balance as a hard ceiling.

Does **not** protect: someone who has the demo code can generate until the
balance runs out (there is no per-person counter; that needs a small database,
see the plan for the full version). Share the code only with people you trust,
and change `DEMO_CODE` in Vercel to cut access off.

Photos are never saved or logged here: they pass through memory on their way
to Meshy. Logs contain only job ids, states and credit counts.

## Testing without spending credits

Use `PROVIDER=mock`. Type one of these words in the "Describe el estilo" box
(Foto + material mode) to see the error screens:

- `!rechazar` shows the "photo not accepted" message
- `!falla` shows the generic failure message
- `!lento` never finishes (see what the 8-minute wait looks like)

## Run it on your computer (optional)

```bash
cd ai-designer-api
npm install
cp .env.example .env     # then edit .env
npm run dev              # http://localhost:8787/api/health
npm test                 # automated checks (no network, no credits)
npm run typecheck
```

## Swapping Meshy for another provider (e.g. Tripo)

Everything outside `lib/providers/meshy.ts` only knows the two-function
contract in `lib/providers/types.ts` (`createJob`, `getJob`). Add
`lib/providers/tripo.ts` implementing it, add one line in
`lib/providers/index.ts`, and set `PROVIDER=tripo`.

## Regenerating the sample models

`node scripts/make-sample-models.mjs ../models/samples` rebuilds the three
paw-print pendants (gold, silver, rose gold) used before and instead of a real
generation.
