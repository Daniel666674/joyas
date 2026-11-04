# AI designer backend (Habibi Eisaa demo)

> **Status (2026-11-04): being prepared for live use, not deployed yet.** The
> owner chose Meshy for a real demo, so this backend is the path to it. Until it
> is deployed and `apiBase` in `assets/ai-designer-config.js` is set, the website
> runs its built-in simulation. The order of work is in `CLAUDE.md` ("Going live").

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
| `mock` | Pretends to generate for ~12 s, then returns a ready-made example piece | free |
| `meshy` | Real generation through Meshy | about 15 credits per model on `meshy-6-lite` |

The page also has a built-in simulation that needs **no backend at all** (its
`apiBase` in `assets/ai-designer-config.js` is empty). That is what you see
today on GitHub Pages.

## Where it runs today (2026-11-04)

Vercel project **habibi-ai-designer-api** (team AGENCY, free Hobby plan), live at
`https://habibi-ai-designer-api-agency6.vercel.app`, currently with
`PROVIDER=meshy` (real generation, since 2026-11-04; it started on `mock`). It was created **without** a GitHub link:
Vercel's GitHub app has no access to the `joyas` repository, so the code was
uploaded directly and **pushing to GitHub does not redeploy it**. To get
automatic deploys, give Vercel access to `joyas` (GitHub > Settings >
Applications > Vercel > Configure > Repository access) and then connect the
repo in the project's **Settings > Git** with Root Directory `ai-designer-api`.

`tsconfig.json` must keep `"module": "CommonJS"`. With `ESNext` Vercel emitted
`import` statements into plain `.js` files and every endpoint crashed with
`Cannot use import statement outside a module`.

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

1. You need a Meshy **Pro** plan (API access is paid-only; the free plan has
   none). If you buy extra credits, **turn auto top-up off**: your balance is
   the hard spending limit.
2. Create the API key on Meshy's **API Keys** page,
   <https://www.meshy.ai/developers/keys> (**Create API Key**). The key looks
   like `msy_...` and is shown **only once**, so copy it straight into Vercel.
   In the same dialog, set a **Monthly credit limit** for this key (for
   example 300 credits, about 20 models on `meshy-6-lite`): Meshy then refuses
   to spend more on this key whatever happens, even if the demo code leaks.
   Do not use the IP allow-list option: Vercel's outgoing addresses change.
3. In Vercel, project **habibi-ai-designer-api** > **Settings > Environment
   Variables**, add `MESHY_API_KEY` (mark it **Sensitive**) and `DEMO_CODE`
   (the code you give your client), and change `PROVIDER` from `mock` to
   `meshy`.
4. Environment variable changes only apply after **Redeploy**: **Deployments**
   > the latest one > **...** > **Redeploy**. Then open `/api/health`: it
   must say `"provider":"meshy"` and `"requiresCode":true`.

If `PROVIDER=meshy` and either `MESHY_API_KEY` or `DEMO_CODE` is missing, the
backend refuses to run (answers "no disponible") instead of running half-open.

### First real run: checklist

The Meshy part was checked against Meshy's official docs and tested against a
faked Meshy, but **not yet against the real service**. Do the first run with the
safe helper, from your own terminal (the key stays on your computer):

```bash
cd ai-designer-api && npm install
export MESHY_API_KEY=msy_...            # or put it in a .env file (git-ignored)
npm run smoke                           # FREE: key works? how many credits?
npm run smoke -- --image foto.jpg       # FREE dry run: what would be sent + cost
npm run smoke -- --image foto.jpg --spend --material oro   # REAL: spends ~15 credits
```

It prints the time taken, the credits Meshy says it charged, your balance
before and after, and saves the `.glb` straight away (Meshy's links expire in
about 3 days). Then, with the deployed site and one photo:

- [ ] It finishes, and the model appears in the viewer. (Meshy's own file link
      is blocked by browsers on other sites, so the page downloads the model
      through this backend's `/api/model` relay. If the viewer still says "No
      pudimos mostrar el modelo 3D", open
      `disenador-ia.html?job=<jobId from the Vercel log>` to retry the same
      design without spending credits.)
- [ ] In Vercel > Logs, find `job_finished` and read `creditsUsed`. Expect
      about 15 on `meshy-6-lite`. If it is higher, set `MESHY_ENABLE_PBR` to
      `false` and compare.
- [ ] Note how long it took, so you can tell the client what to expect.
- [ ] Compare one photo on `MESHY_MODEL=meshy-7.1` (about 30 credits) only if
      the cheap model's quality is clearly too low.

Meshy keeps result files for about 3 days; the page shows them right away, so
nothing needs to be stored. Failed tasks are refunded by Meshy automatically.

## How a real design is made (two steps)

Meshy's image-to-3D copies whatever is in the photo (a cat photo gives a 3D cat), so a
real generation first asks Meshy's image-to-image model to redraw the animal as the
jewelry the visitor chose (pendant, ring, earring or bracelet, in the chosen metal, plus
their own words), then builds the 3D model from that picture. About 18 credits and 2-4
minutes per design. `MESHY_RESTYLE=false` skips step 1 (old behaviour).

## Saved orders (quote on WhatsApp)

After a real design, the visitor can press **Cotizar esta joya por WhatsApp**: the page saves
the order here (name, notes, the 3D file, and the photo only if they tick the consent box) and
then opens WhatsApp with a ready message that includes the order id (`HE-yymmdd-XXXX`). The owner
sees every order in `admin.html` > **Pedidos IA**: view the piece in 3D, download the `.glb`,
download the photo, copy the WhatsApp message and mark the status.

Where it is stored: a **private Vercel Blob store** (the repository is public, so customer data
can never live in it). The 3D file is copied at order time because Meshy deletes its own copy
after about 3 days.

Nothing extra is needed to turn it on: it works as soon as the private Blob store is connected
(Vercel creates `BLOB_READ_WRITE_TOKEN` itself) and `/api/health` then says `"orders":true`. For a demo,
the **`DEMO_CODE` also opens the admin's order tab**. Before real customers use the designer, add a
different `ADMIN_CODE` (Vercel > Settings > Environment Variables, **Sensitive**, Production) and
**Redeploy**: the demo code then stops opening the orders.

The admin tab asks for the code (demo code, or `ADMIN_CODE` if set) once per browser session. Endpoints: `POST /api/order`
(demo code), `GET /api/orders`, `GET /api/order-file`, `POST /api/order-status` (admin code = demo code unless `ADMIN_CODE` is set).

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

## Regenerating the example pieces

`node scripts/make-realistic-pieces.mjs ../models/samples ../assets/studio-env.hdr`
rebuilds the three pet-themed pieces (paw ring, dog-face necklace, charm
bracelet) and the studio lighting map. They are hand-built examples used instead
of a real generation, not made from a visitor's photo. Re-validate the output
with the Khronos glTF validator after editing the script.
