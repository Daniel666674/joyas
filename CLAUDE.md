# Habibi Eisaa (joyas) — notes for future sessions

## What this repo is

This is the **compiled static export output** of a Next.js site — there is no
source project here (no `pages/`, `app/`, `package.json` build scripts that
regenerate anything). Every `.html`, `.css`, and `.js` file under the repo
root and `_next/` is build output, hand-edited in place since the original
source is not available. Deployed via GitHub Pages at
`daniel666674.github.io/joyas`, hence the `/joyas` basePath prefix on every
internal asset/link.

## The hydration trap (read this before editing any `.html` file)

**Editing the static HTML directly only works for some kinds of changes.**
This export still ships the full Next.js/React client bundle, and every page
hydrates into a live SPA after load. Verified empirically (2026-07-08):

- **Safe**: changing the *text content* or *attributes* of an element that
  already exists in the static HTML (e.g. renaming a product, fixing an
  `src`/`href`, translating a string, tweaking a `class` value in place).
  React's hydration reconciles these without complaint. This is how the
  Spanish translation, rebrand, and product-renaming work all shipped.
- **Unsafe / silently reverted**: *adding, removing, or reparenting*
  elements in the static HTML. React hydrates by diffing the DOM against its
  own client-rendered expectation; any structural mismatch gets patched back
  to what React expected, **within ~200ms of page load**. A structural edit
  will look correct when you open the raw HTML file, and will even render
  briefly in a browser — then vanish. This is easy to miss if you don't
  specifically test past the `load` event.
- This isn't limited to the `<header>` — it's the whole document (confirmed
  by testing a deletion inside `<main>` on the homepage too).

**How to make a structural change that actually survives:**
1. **Pure CSS**, restyling/repositioning/hiding *existing* elements via
   `premium.css` — never touches the DOM, so hydration is irrelevant. This is
   how the hero redesign and the homepage section compressions were done.
   Scope selectors defensively (`:has()`, exact `href`/class chains) since
   Tailwind class combos repeat across sections/pages.
2. **Post-hydration JS**, appending brand-new elements (never reparenting
   existing ones) well after `window.load` — see the `deferredInit()`
   pattern in `assets/store.js`, `assets/hero-video.js`, and
   `assets/nav-funnel.js`. Once hydration is done, React only re-renders on
   its own state changes, so appended siblings persist indefinitely as long
   as you don't move/remove nodes React still owns.
3. **A hand-authored standalone page** with no Next.js/React on it at all
   (e.g. `inventario.html`) — zero hydration risk because there's nothing to
   hydrate. Preferred for genuinely new features/tools rather than trying to
   extend an existing exported page.

If you're not sure which bucket an edit falls into, test it: load the page,
wait >1s past `load`, and re-check the DOM before trusting the change.

## Established safe JS patterns (see `assets/store.js` for the fullest example)

- `deferredInit()`: `window.addEventListener("load", () => setTimeout(init, 400-500))`.
  Never touch the DOM before this fires.
- Guard repeated `textContent` writes with an equality check
  (`if (el.textContent !== next) el.textContent = next`) before a
  `MutationObserver`-driven update, or you'll create an infinite mutation loop.
- Use capture-phase (`addEventListener(type, fn, true)`) for any delegated
  click handler that needs to `preventDefault()` before a Next.js `<Link>`'s
  own bubble-phase handler fires.
- Don't add a bare `position: relative` to anchor a decorative pseudo-element
  on something that already carries `.fixed`/`.sticky` — it silently
  overrides the positioning utility. `fixed`/`sticky` elements are already
  valid containing blocks for absolutely-positioned children.
- **Rewriting an existing `<Link>`'s `href` doesn't change where clicking it
  goes.** Verified empirically (2026-07-08, building `homepage-featured-refresh.js`):
  Next's `<Link>` click handler navigates using the href it captured in its
  component props at hydration time, not by reading the live DOM attribute.
  You can `setAttribute("href", newUrl")` on an existing hydrated link and it
  will *display* correctly (inspect/hover shows the new URL) while clicking
  it still silently navigates to the *original* destination. If you need an
  existing Next-owned link to navigate somewhere new after hydration, rewrite
  the href for display/SEO purposes as usual, but also add a capture-phase
  click listener on it that calls `preventDefault()` +
  `window.location.href = <the live href>` to force a real navigation. See
  `homepage-featured-refresh.js`'s `.hje-featured-link` handling for the
  concrete pattern.

## Test workflow

No dev server exists (no source project). To preview changes: serve the repo
root's *parent* directory with any static file server so `/joyas/...` paths
resolve correctly, e.g. `python3 -m http.server 8090 --directory ..` run from
inside `joyas/`. Use Playwright against `localhost:8090/joyas/...` for
screenshots/regression checks — Chromium in this environment has no H.264
support, so local `<video>` playback tests need a temporary VP9 transcode;
production browsers are unaffected.

When testing anything that involves the homepage's scroll-reveal animation
(`opacity: 0` until scrolled into view), don't judge a screenshot taken
during a fast automated scroll — the reveal needs real dwell time per
section to trigger. A blank-looking section in a rushed screenshot may just
be `opacity: 0` mid-animation, not a real bug.

## Product catalog data

**`assets/products.json` is the live source of truth as of 2026-07-08.**
`admin.html` (see below) reads and writes it directly via the GitHub
Contents API, and the storefront's category/material pages, `shop.html`,
and the homepage's featured section all render from it at runtime (see
"Category/material listing pages are now runtime-rendered" below). Each
entry has `id, slug, sku, name, category, material, price, currency,
availability, units, featured, popularity, images[] (src/thumbnail/alt/
width/height), description, specifications{acabado,cuidado,origen,
garantia}, seo{title,description}, instagramUrl, tag, promotion,
costoInterno, photoFit, variants{sizes[],colors[]}, weight` (the middle
five added 2026-07-29, see "Multi-photo gallery, size/color variants, and
extra fields" below; `weight` added 2026-07-30, see "Weight-based live
pricing for gold/silver" below).

**`price` became real and customer-facing on 2026-07-28** (previously
vestigial — every page always showed the literal string "Consultar
precio"). `formatPrice()` (duplicated in `admin.js`,
`category-render.js`, and `homepage-featured-refresh.js` — keep all
three in sync) renders `price > 0` as a Colombian-peso-grouped string
(`"$180.000"`, via `toLocaleString("es-CO")`); `price === 0` still falls
back to "Consultar precio" everywhere. The 66 legacy Next.js-hydrated
product pages were deliberately left untouched when `price` first shipped
(nothing to update while they were all still 0), since any product edited
via `admin.html` gets fully regenerated as a hand-authored page anyway,
which is where a real price would first render.

**All 66 products got fictitious placeholder prices on 2026-07-30**,
split evenly by material: the catalog's `material` field was rebalanced
to exactly 33 Oro Laminado / 33 Oro 18K (alternating by array order —
previously 64 of the 66 were Oro Laminado), each priced within a
category-aware realistic-looking COP range for that material tier (Oro
Laminado roughly $35.000–$220.000, Oro 18K roughly $500.000–$4.200.000,
higher for cadenas/collares than aretes/dijes). These are **placeholder
numbers for demo/testing purposes, not real prices** — same caveat as
`units: 5` when that was backfilled. The same "legacy pages stay stale
until next admin edit" rule applies here too: the 66 original Next.js
product detail pages still show their old (mostly 0/"Consultar precio")
price and material until each is individually re-saved through
`admin.html`.

**`units` was added 2026-07-28** as a real stock-count field, editable
in `admin.html`. It's admin-side bookkeeping only — the storefront still
only ever reads the pre-existing binary `availability` field
(Disponible/Agotado), unchanged. `admin.js`'s `stockStatus()` computes a
3-tier badge from it for the admin's own restock triage (`0` → Agotado,
`1-3` → Bajo stock, `4+` → Disponible, threshold in
`LOW_STOCK_THRESHOLD`) and auto-suggests `availability` when `units`
changes in the form — but `availability` stays a normal, independently
overridable dropdown (e.g. to hide an in-stock item temporarily without
zeroing its count). All 66 existing products were backfilled with
`units: 5` as a placeholder when this shipped — not real counts, the
admin needs to correct them over time as the tool gets used. A real
size/color variant system was added 2026-07-29 (see below) — when a
product has variants, `units` becomes computed from them instead of
manually set.

The **original 66 SKUs are still also baked into a webpack chunk** as a
plain JS array — `_next/static/chunks/370-38b28494715c6f30.js` (filename is
content-hashed; search for a known slug like `"cadena-con-dije-virgen-001"`
if it's been rebuilt/renamed). This is now legacy/frozen: it was the
original data source before `products.json` existed, individual *existing*
Next-hydrated product detail pages' own baked-in content still ultimately
traces back to it, but nothing added or edited via `admin.html` touches
this chunk — new products only ever exist in `products.json` plus their own
generated `producto/<slug>.html` file. Don't bother re-syncing the chunk
after a catalog change; it's not read by anything `products.json` now
drives.

## Category/material listing pages are now runtime-rendered

`cadenas.html, pulseras.html, anillos.html, argollas.html, aretes.html,
collares.html, oro-laminado.html, oro-18k.html, oro-14k.html, oro-10k.html,
plata-925.html, oro-rosa.html, esmeraldas.html, diamantes.html, dijes.html`,
and `shop.html` were migrated (2026-07-08) off Next's static+hydrated model
onto the same zero-hydration-risk pattern as `inventario.html`: each page
keeps its real header/footer/breadcrumb/intro-copy/SEO `<head>` verbatim
(all still valid, hand-editable static content), but the product grid
itself is now an empty `<div id="hje-cat-root" data-hje-filter-type="category|material"
data-hje-filter-value="...">` (or `#hje-shop-root` on `shop.html`) that
`assets/category-render.js` fills in at runtime by fetching `products.json`
and rendering matching `article.group` cards client-side. All Next chunk
`<script>` tags and RSC flight-payload blocks were stripped from these
pages — there's nothing left to hydrate.

Why: these pages previously froze each product's card into *both* the
visible DOM *and* a duplicate serialized copy in an RSC payload script — the
two had to match exactly for hydration to accept the page (the hydration
trap, precisely). Adding/editing/removing a product meant a fragile
dual-edit, once per affected page. Now a catalog change just needs
`products.json` updated; every migrated page reflects it automatically on
next load, no per-page edit at all.

If you need to touch one of these pages' surrounding copy (the intro
paragraph, FAQ, breadcrumb), it's a completely ordinary static HTML edit —
no hydration concerns apply anymore, since there's no Next.js left on the
page. Only the product grid itself is owned by `category-render.js`.

**Known residual gap**: `index.html` (the homepage) and the 66 individual
`producto/<slug>.html` pages are still real Next.js-hydrated pages. A
"related products" link on one of those, or any other still-hydrated page,
uses Next's own captured routing state when clicked (see the `<Link>`
capture-phase note above) — and even a hard-reload of that link's *target*
won't show new content via a soft client-side navigation, because Next's
router fetches the target's cached `.txt` RSC payload rather than
re-reading the actual `.html` file. Concretely: if `admin.html` edits an
*existing* product, visitors who reach it by clicking a link from another
still-un-migrated, still-hydrated page may see stale content until they
hard-navigate (typing the URL, following a search result, or arriving via
any of the now-migrated category/shop pages, all of which do plain browser
navigation with no client router involved). This resolves itself as more
pages get migrated/regenerated over time; not worth chasing with a
sweeping fix given the current traffic pattern (WhatsApp-first, most
traffic lands on category/shop pages or direct links, not by hopping
between two still-hydrated product detail pages).

## Admin panel (`admin.html`)

Write-capable catalog management: add, edit, and delete products, with
changes committed directly to this GitHub repo via the Contents API — no
server, no build step. Gated by a passcode (own constant in
`assets/admin.js`, distinct from `inventario.js`'s, independently
rotatable) followed by a GitHub Personal Access Token the admin pastes in
once per browser session (validated against the API before being accepted;
held only in `sessionStorage`, never sent anywhere but api.github.com
directly from the browser). The passcode is a casual deterrent only, same
caveat as `inventario.html` — the real access control is whoever holds a
repo-scoped PAT.

On publish it: uploads any new/replaced photos (canvas-downscaled to
~1200px, with a blank-canvas corruption guard — see inline comments in
`assets/admin.js`), merges this session's changes into a **freshly
re-fetched** `products.json` (never blindly overwrites — safe for two
admins publishing around the same time; retries with backoff on a 409 sha
conflict), regenerates/deletes the affected `producto/<slug>.html` pages
(hand-authored, bucket 3 from the hydration-trap section above — built from
verbatim header/footer strings captured from a real product page, so keep
those in sync with `assets/store.js`'s selector requirements if the header/
footer ever changes), updates `sitemap.xml` (parsed/mutated via
`DOMParser`/`XMLSerializer` — note `XMLSerializer` re-emits the source
document's own `<?xml ?>` prolog rather than dropping it, so the prolog is
stripped and re-added exactly once rather than blindly prepended), and
appends one entry to `assets/admin-changelog.json` (shown in the panel's
"Registro de cambios" tab; every Contents API write is additionally tagged
`[admin] <message>` in the commit message itself as a second, independent
audit trail in `git log`).

**Visual style (2026-07-28 restyle)**: bold black-bordered rectangular
buttons (`.hje-adm-btn-outline`/`.hje-adm-btn-primary` in `admin.css`,
not the gold-gradient pills used sitewide elsewhere), a mobile-first
card list (`.hje-adm-card`) instead of a table, colored 3-tier status
badges, an action-button grid, and a floating WhatsApp support bubble
(owner's own number, distinct from the storefront's customer-facing
one) — matched to a reference tool screenshot the owner shared, kept in
Habibi Eisaa's cream/burgundy/gold palette rather than the reference's
black/white.

**Bulk edit**: each card has a selection checkbox (`state.selected`);
"Edición masiva" opens a modal with Categoría/Material/Disponibilidad/
Destacado fields each defaulting to "Sin cambio" — only fields the admin
actually sets get applied, to every selected product, merged onto that
product's own current data via the same dirty-tracking mechanism as a
single edit. "Descartar cambios" clears all pending dirty/deleted/
selected state without publishing.

**Delete removes the product page, sitemap entry, and category-page
presence outright** (not an archive) — there's no order history or
external links worth preserving on a WhatsApp-inquiry site, and
`availability: "Agotado"` already covers a non-destructive "soft hide" if
that's what's actually wanted. Known accepted gap: other *still-hydrated*
pages' baked-in related-products blocks that reference a deleted slug
become dead links until those specific pages are next regenerated.

The card-rendering template (`article.group` markup) is intentionally
duplicated between `assets/admin.js` (page generation) and
`assets/category-render.js` (public runtime rendering) rather than shared
via one script — keep both in sync if the card markup ever changes.

## Multi-photo gallery, size/color variants, and extra fields (2026-07-29)

Modeled on a reference admin tool the owner built for a different
(BMX) store, adapted to Habibi Eisaa's palette and only the parts that
made sense for jewelry (no "Marca" field — Habibi Eisaa sells its own
designs, not resold brands).

**Multi-photo gallery**: `admin.js`'s form now supports any number of
photos per product via `state.photos` (an array, replacing the old
single `state.photo`). Each thumbnail in the grid has reorder (`‹ ›`),
rotate (`↻`), and remove (`×`) controls; the first slot is always
"Portada" (cover) — same convention as `images[0]` already being the
card/primary image everywhere on the site. Rotating an *existing*
(already-published) photo fetches it same-origin, rotates it via canvas,
and re-uploads to its **same path** so the public URL never changes —
`publish()`'s photo-upload step now fetches each target path's current
sha first (`ghGetFile` before `ghPutBlob`) rather than always assuming a
brand-new file, since overwriting-in-place is now a real case. New
uploads always encode as JPEG; a rotated *existing* photo preserves its
original format (most legacy photos are `.webp`) via `mimeForPath()` —
this matters because GitHub Pages infers `Content-Type` purely from the
file extension, so the bytes must actually match it. Only the generated
product detail page shows the full gallery (click a thumbnail to swap
the main image, via a small inline `<script>` — zero hydration risk,
same reasoning as everywhere else on hand-authored pages); grid cards
sitewide still only ever show `images[0]`, unchanged.

**Size/color variants**: optional per-product `variants: {sizes: [],
colors: []}`, each an array of `{label, units}`. Independent axes, not a
combinatorial size×color matrix (matches the reference tool, and fits
Habibi Eisaa's real need — `sizes` for anillos/argollas ring sizing,
`colors` rarely used since gold-tone variation is already covered by
`material`). Empty arrays (the default for all pre-existing products) =
fully unchanged legacy behavior — `units` stays a plain manually-edited
number. As soon as either list is non-empty, the admin form's "Unidades
en stock" field becomes computed (sum of whichever list is populated)
and disabled, mirroring `admin.js`'s `updateVariantTotals()`. Unlike the
previous round's units/stock work (admin-side only), this one **does**
reach the storefront: `generateProductPage()` renders a picker
(disabled buttons for any 0-stock option) on the hand-authored product
detail page, with an inline script that appends the selection to the
"Consultar por WhatsApp" link's prefilled message (`.hje-wa-consult`'s
`data-base-text` attribute holds the un-appended text so repeated
selections don't stack). No selection is required to still message via
WhatsApp — additive, not a hard gate.

**Tag / Promoción / Costo interno / Ajuste de foto**: `tag` (free text,
e.g. "Nuevo") and `promotion` (boolean) each render as an extra badge
pill — stacked with "Destacado" inside a shared `.hje-badge-stack`
wrapper (`badgeStackHtml()` in `admin.js`/`category-render.js`;
idempotent `ensureBadge()`/`removeBadge()` DOM-patching in
`homepage-featured-refresh.js`, since that script mutates an already-
hydrated homepage in place rather than re-rendering a string template).
There's deliberately **no** `/promociones` listing page yet — `promotion`
is just a badge for now; trivial to add later with the same
`category-render.js` runtime-filter pattern if wanted. `costoInterno`
(COP) is admin-only margin bookkeeping — new row in the admin card list,
never rendered anywhere on the public storefront or in generated
HTML/JSON-LD. `photoFit` (`"cover"` default, or `"contain"`) is applied
as an inline `style="...;object-fit:contain"` override on top of each
`<img>`'s existing Tailwind `object-cover` class (inline style wins, so
no class-string surgery needed) in every card-rendering location.

**Important constraint discovered while building this**: this is a
static Next.js export, so any Tailwind class you write into *new*
markup must already exist somewhere in the site's compiled CSS — there's
no build step left to generate a class you invent. Every class used in
the new badges/pills/variant-picker buttons above was verified to
already ship (reused verbatim from the existing "Destacado" badge and
the WhatsApp/Instagram button styling) rather than guessed at.

## Materials simplified to 3, admin visual redesign, ring-size presets (2026-07-30)

**`MATERIALS` in `admin.js` dropped from 8 values to exactly 3**: `Oro
18K`, `Plata`, `Oro Laminado`. Confirmed with the owner before changing
(the previous 8-value list — plus Oro 14K/10K/Rosa, Esmeraldas,
Diamantes — didn't reflect what's actually stocked). The 2 existing
products that were on a dropped material got auto-remapped:
`anillo-esmeralda-044` (Esmeraldas → Oro 18K, gemstone pieces are
mounted in real gold) and `anillo-sello-plata-925-064` (Plata 925 →
Plata). `category-render.js`'s `MATERIAL_LABEL_TO_SLUG` keeps all 8
original keys mapped to their pages (just `"Plata 925"` renamed to
`"Plata"`) so any future/legacy product on a dropped material still
filters correctly on `shop.html` — the 5 now-materialless pages
(`oro-14k.html` etc.) are simply unreachable via the admin dropdown
going forward, not deleted. `plata-925.html`'s `data-hje-filter-value`
was updated from `"Plata 925"` to `"Plata"` to match (a plain attribute
edit — this page has no Next.js left on it, see the runtime-rendering
section above). The two remapped products' own legacy Next-hydrated
detail pages (both frozen since 2026-07-08, never edited via admin)
still show their old material text in the pill — same accepted
stale-until-next-edit precedent as every other schema change in this
file, left alone rather than risking a hand-patch of their embedded RSC
flight payload. **Deliberately out of scope**: the public-facing
nav/footer/homepage material links still list all 8 — only the admin
dropdown and product data changed. Trimming customer-facing nav down to
3 materials too would be a much larger sweep (footer markup is repeated
across ~96 pages) and wasn't part of what was asked for.

**Ring-size quick-add presets**: `admin.js`'s `ANILLO_SIZE_PRESETS`
(sizes 5–12) render as one-click chips above "+ Añadir talla", shown
only when Categoria is Anillos or Argollas (`renderSizePresets()`,
wired to the category `<select>`'s change event and to every mutation
of `state.sizes`). Clicking an already-added size is a no-op instead of
creating a duplicate row.

**Admin visual redesign ("maximize visuals")**: the product card list
changed from a small-thumbnail-plus-text-rows layout to photo-forward
cards — a large `4:3` product photo as the card header with
Destacado/Tag/Promoción badges and the stock-status badge overlaid
directly on the image (mirrors how badges already overlay images on the
real storefront cards), the bulk-select checkbox as a corner overlay
instead of a separate row, and name/price/meta/stats below. A new stats
summary bar (`renderStats()`, called from `renderTable()`) shows total
products and the same Disponible/Bajo stock/Agotado 3-tier breakdown as
`stockStatus()` already computes, now visible at a glance instead of
only per-card. The add/edit modal gained section dividers
(`.hje-adm-section-legend`) grouping the long flat field list into
Información básica / Precio e inventario / Extras y visibilidad /
Fotos / Tallas y colores / Descripción y especificaciones, for
scannability now that the form has grown to ~20 fields across several
rounds of additions.

**Card list became a responsive grid (2026-07-30)**: `.hje-adm-card-list`
switched from a single-column stack to a CSS grid (2 columns on mobile →
3/4/5 at wider breakpoints, capped at 5 to read as a catalog rather than
a list), with `.hje-adm-main`'s max-width widened at the same breakpoints
so the grid has room to actually reach 5 columns. Card internals get a
denser treatment at ≥900px (smaller type, name/price stacked instead of
side-by-side, name clamped to 2 lines) since a 5-wide card is much
narrower than the original single-column design assumed.

## Inventory value stats + sales register + simulated Wompi/Siigo (2026-07-30)

Built for a sales demo ahead of a possible real Wompi (payments) + Siigo
(DIAN electronic invoicing) integration — see the two payment/invoicing
planning conversations for the real architecture that would eventually
replace the simulation described here. Nothing in this round adds any
new credential or external API call; it's an extension of the exact same
patterns already in `admin.js`.

**Inventory value stats**: `renderStats()`'s bar gained two more tiles —
total inventory value at cost (`sum(costoInterno * units)`) and at retail
(`sum(price * units)`) — computed live from the same `products.json`
fields already shown per-card, no new schema. `.hje-adm-stats-bar` went
from 4 to 3 columns at the ≥640px breakpoint (6 tiles total, 2 clean
rows) with the two money tiles spanning full width below 480px since COP
totals can be long strings.

**"Registrar venta" (real feature, not simulated)**: a per-card button
(hidden when `units <= 0`) opens a modal to log a sale — quantity, unit
price (prefilled from `product.price`), optional buyer name/phone. On
confirm this decrements `units` via the *same dirty-tracking mechanism as
any other edit* (`state.dirty[slug] = updated`, regenerates that
product's page on next Publish same as always) and stages a record in a
new `state.sales` array. Publishing writes accumulated sales to a new
`assets/sales-log.json` (same fetch-fresh/append/`putWithRetry` pattern
as `admin-changelog.json`) and appends a changelog entry mentioning the
sale count. A new "Registro de ventas" tab (`loadSalesLog()`, mirrors
`loadChangelog()`) shows sale history with a small summary bar (count +
total revenue). `discardChanges()`/`updatePublishBar()` were extended to
account for `state.sales` alongside the existing dirty/deleted tracking.

**Simulated Wompi + Siigo steps (genuinely fake, by design)**: submitting
the sale form shows a two-step animated sequence — "Procesando pago con
Wompi..." then "Generando factura electronica en Siigo..." — each with a
spinner that resolves to a checkmark after ~1.1s (`runSaleSimulation()`),
producing fake-but-realistic-looking reference numbers (`fakeRef()`) that
get stored on the sale record alongside the real stock/sales-log update.
This is explicitly a preview of what the real integrations would produce,
not a real payment or invoice — the on-screen note says so, and the code
makes zero network calls to any payment or invoicing provider. Deliberate
design choice: this needed **no new credential of any kind**, including
no GitHub token beyond the admin's own existing one — a real Wompi/Siigo
build (see the payment/invoicing planning notes) would need its own
backend and secrets entirely separate from this admin tool.

**Clickable sale detail (2026-07-30)**: every row in "Registro de ventas"
opens `#hje-adm-sale-view-backdrop` (`openSaleDetail()`) — a receipt-style
modal with the product photo (looked up live from `displayProducts()` by
`sale.slug`, falls back gracefully if that product was since deleted),
full price breakdown, buyer info with a generated `wa.me` deep link when
a phone is present (10-digit local numbers get `57` prepended), the
simulated Wompi/Siigo references with one-click copy buttons
(`navigator.clipboard`, with a no-op fallback if unavailable), and a "Ver
producto" button that switches to the Productos tab and pre-fills the
search box with that product's SKU. `loadSalesLog()` now keeps the merged
(published + pending) list in `state.salesListCache` so row clicks can
look the full record back up by index.

## Weight-based live pricing for gold/silver (2026-07-30)

Gold and silver spot prices move daily, so a flat per-product `price` for
Oro 18K/Plata items would go stale constantly. This adds a second pricing
mode alongside the existing manual one, **computed at render time** (not
at admin-save time) so a single price-per-gram update instantly reflects
across every product that has a weight set — no need to re-save each
product individually.

**`assets/material-prices.json`** (new file): `{"Oro 18K": <COP/gram>,
"Plata": <COP/gram>, "updatedAt": <ISO timestamp>}`. Only these two
materials track a live per-gram price — `MATERIAL_PRICE_KEYS` in
`admin.js`. Oro Laminado deliberately keeps a plain manual `price` like
before this feature existed (confirmed with the owner): its value is
mostly base metal + labor, not gold content, so spot-pricing it doesn't
make sense. Edited on its own **"Precios de metales"** admin tab
(`loadMaterialPrices()`/`saveMaterialPrices()`) with its own immediate
publish action, independent of the main product dirty/publish flow, since
the owner expects to update this daily and shouldn't need to route it
through unrelated pending product edits.

**`weight` (grams)** was added to the product schema, editable in the
admin form. When a product's material is one of `MATERIAL_PRICE_KEYS` and
`weight > 0`, the "Precio" field becomes computed and disabled
(`renderWeightPricing()`, wired to both the material `<select>` and the
weight input) — same UX pattern as `units` becoming computed once
size/color variants are added. `weight = 0` (the default, backfilled onto
all existing products) or Oro Laminado material means Precio stays
exactly as it always has: a normal manually-typed number. **No making-
charge/margin field was added** (confirmed with the owner) — the
customer-facing price for a weighed item is exactly `weight *
pricePerGram`, no markup layered on top.

`computeDisplayPrice(product, materialPrices)` (duplicated in `admin.js`,
`category-render.js`, and `homepage-featured-refresh.js` — keep all three
in sync, same convention as `formatPrice()`) is the single formula: falls
back to the product's stored `price` whenever weight is 0 or the material
doesn't track a per-gram price. `products.json`'s `price` field is still
written on every save (computed at that moment) so it stays a sensible
fallback/JSON-LD value if `material-prices.json` ever fails to load — but
the *live* customer-facing number always recomputes fresh from
`weight` + the current per-gram price, both on the runtime-rendered pages
(category-render.js, homepage-featured-refresh.js, which already fetch
`products.json` fresh on every load) and on the hand-authored
`producto/<slug>.html` pages, which are otherwise static snapshots frozen
at publish time. The latter needed a small inline script
(`.hje-price-recompute` elements carrying `data-material`/`data-weight`,
one shared script appended by `generateProductPage()`) that re-fetches
`material-prices.json` on page load and corrects both the main price and
every related-product card's price — without this, a detail page
generated last week would keep showing last week's gold price even
though the shop/category pages right next to it had already moved on.

## Maximized visual pass v2 (2026-08-10)

Requested ahead of a client sign-up demo: "fully maximize the website
visuals... way more premium and elaborated design." Pure CSS additions to
`assets/premium.css` (a new section appended at the end, `MAXIMIZED VISUAL
PASS v2`) — same zero-DOM-edit, zero-hydration-risk constraint as every
other rule in that file, verified via Playwright screenshots on
`index.html`, `shop.html`, `cadenas.html`, and a legacy product detail
page before shipping. Covers, sitewide (broad Tailwind-chain selectors, so
it applies consistently across the homepage, the runtime-rendered
shop/category pages, and both legacy and admin-generated product detail
pages without any per-page work):

- **Section eyebrows** ("Categorias", "Confianza", etc. and the hero's own
  eyebrow line): a small rotated gold-foil diamond mark before the text,
  pairing with the pre-existing underline rule for a proper kicker.
- **Section headings** (`h2.font-serif...`): tighter letter-spacing and a
  larger size at `lg:` for a more editorial feel.
- **Section rhythm**: every `bg-background`/`bg-[#f8f3eb]` content section
  gets a barely-there radial dot-grain texture plus a centered gold
  hairline at its top edge — reads as "designed," stays invisible enough
  to not compete with product photography.
- **Price display**: both the card price (`span.text-sm.font-semibold`
  inside the card's price row) and the product-detail price
  (`p.mt-3.text-2xl.font-semibold`) switch from plain sans to serif,
  gold-deep colored — a boutique price-tag treatment instead of a plain
  label. Purely cosmetic; doesn't touch `computeDisplayPrice`/
  `formatPrice` or any pricing logic.
- **Testimonial cards**: oversized serif quotation mark watermark, solid
  gold left-edge accent, hover lift.
- **FAQ accordion**: custom +/− indicator (native marker was already
  hidden by Tailwind's `list-none`), per-row hover/open tint, and a
  shadow+radius on the whole list container.
- **Category tiles / footer / hero**: stronger hover lift+glow on the
  homepage category tiles, a gold-foil hairline replacing the footer's
  flat top border plus gold-deep footer column headings, and slightly
  tighter hero heading tracking.

No HTML, JS, or `products.json` changes in this pass — everything lives in
the one CSS file, so there is nothing to regenerate on any product page.

## Atelier pass v3 — senior design pass (2026-09-14)

Requested ahead of a client sign-up demo: "professional level design work...
more than WordPress, premium and high end, fully maximize." Where v1/v2
added polish on top of the exported template, v3 re-cuts the page as a
**system**: one modular type scale (`--hje-display` / `--hje-h2` / `--hje-h3`
/ `--hje-micro` clamps), one accent (gold used as hairline and rule, not
fill), a real vertical rhythm, and photography given room to carry the page.

Still **pure CSS appended to `assets/premium.css`** — zero DOM edits, so the
same zero-hydration-risk profile as every other rule in that file, and it
applies identically to `index.html`, the runtime-rendered shop/category
pages, and both legacy and admin-generated product detail pages with no
per-page work. Verified with Playwright across index, shop, cadenas,
collections, about, a legacy product page, and 390px mobile.

Where a v1/v2 rule is superseded the same selector is repeated in the v3
block and wins on source order; the older rule is left in place so the
intent history stays readable. `admin.html` and `inventario.html` do not
load `premium.css`, so neither is affected.

**The headline moves:**

- **Transparent masthead over a full-bleed hero (homepage only).** The hero
  is pulled up under the sticky header (`margin-top: calc(-1 * var(--hje-hdr))`)
  and the header goes transparent with cream type until `premium.js` adds
  `.hje-scrolled`, at which point it resolves into cream glass with the gold
  foil hairline. Scoped by `body:has(<hero class chain>)` — that chain
  exists only on index.html (verified by grep). `--hje-hdr` (4rem, 5rem at
  lg) is the single source of truth for the header height and the hero's
  pull-up; it is deliberately **constant per breakpoint, never animated** —
  a sticky header that shrinks on scroll shifts everything below it and
  jitters. The transparent state also gets its own gradient scrim
  (`header::before`, `z-index:-1` inside the header's own z-40 stacking
  context): the hero scrim alone can't be trusted when the footage rotates
  through bright frames.
- **The hero's media layer was never actually full-bleed.** It is
  `position:absolute; inset:0` against the `mx-auto max-w-7xl px-8`
  container, so above 1280px it left 80px letterbox bars. Broken out with
  `inset: 0 auto 0 50%; width:100vw; transform:translateX(-50%)` — the
  section's own `overflow-hidden` clips it.
- **Section numerals.** `main { counter-reset }` / `main > section
  { counter-increment }` renders `01`, `02`, … into each eyebrow's
  `::before`. Homepage only: inner pages nest their sections
  (`main > div > section`), so the counter never incremented there and every
  eyebrow rendered a literal "00". Non-homepage eyebrows get a gold hairline
  mark instead.
- **Categories** went from the v1 funnel-compression strip (six squat
  thumbnails, reads as a filter bar) to six portrait plates, 3-up on
  desktop / 2-up on mobile, with a deep caption gradient, an inner hairline
  frame on hover, and a "Ver piezas" line that rises in. The gradient has to
  be much deeper than a stock overlay because the source photography is
  mostly bright white jewellery-box lining.
- **Materials** went from bare pills to five equal-width plates spanning the
  container, each re-showing the photo the link already carried (v1 hid it)
  as a round 54px thumbnail, plus a trailing hairline arrow.
- **Product cards** sitewide: gold-foil `Destacado` pill (the badge's own
  class chain is the only reliable hook — three different renderers emit it,
  and `homepage-featured-refresh.js` wraps it in `.hje-badge-stack` while
  `category-render.js`/`admin.js` emit a bare positioned div), serif name,
  letterspaced-caps meta, hairline-separated price row, ghost circular
  action controls, wishlist heart revealed on hover/focus, and a "Ver pieza"
  plate rising from the foot of the photo (`a::after` — the photo div's own
  `::after` is already v1's warm-light sweep).
- **Instagram wall** restored to the full 4x2 (v1 clipped it to 4 tiles).
- Testimonials, FAQ (now a centred editorial Q&A list, not a boxed
  accordion), newsletter band, footer, product detail page (framed image,
  caps meta pills, price with a gold rule, engraved-caps CTAs, spec table),
  and the shop/category filter bar all re-cut to the same system.

**Things worth knowing next time:**

- The shop's filter form posts to `/joyas/shop.html`, **not** `/shop`, so
  v1's `form[action="/shop"]` rules never applied to the page they were
  written for. v3 uses `form[action*="shop"]`.
- `store.js` adds a cart `<button>` to the card action row and a
  `.hje-detail-cart-btn` to the detail page; both carry their own classes,
  not the template's button utilities, so they need explicit rules or the
  row looks half-styled.
- `--muted-foreground` shipped at rgb(118,105,96) on the cream ground —
  5.1:1, clears AA but reads washed at the longer measures this pass opens
  up. Nudged to `25 11% 37%` (~6.3:1), same hue and warmth.
- A two-up product grid at 390px overflowed the viewport by 24px (price +
  three 40px controls in one non-wrapping row). Fixed by letting that row
  wrap and tightening the controls below 640px — worth re-checking
  `document.documentElement.scrollWidth` vs `clientWidth` after any card
  change.
- `text-wrap: balance` on display type and `pretty` on body copy does the
  rag control that would otherwise need hand-inserted breaks in the Spanish
  copy ("Compras acompanadas de principio a / fin").
- When screenshotting with Playwright, `html { scroll-behavior: smooth }` is
  set sitewide — inject `html{scroll-behavior:auto}` before scripted
  scrolling or captures land mid-animation at the wrong offset.

## Hero v4 — editorial split, cover video removed (2026-09-14)

Asked for directly: "remove the whole cover video and redesign the whole
hero thing." Supersedes v3's full-bleed cover treatment entirely.

**Why the cover had to go**: the clips are phone footage of a chain on a
white backdrop. At full-bleed size their softness and blown highlights are
the first thing a visitor sees, and a scrim heavy enough to keep cream type
legible over them turned the whole frame muddy. No scrim fixes weak source
material, so the layout stops leaning on it.

**The exported markup was always a two-column editorial hero** — a text
column beside a three-plate collage (one 4:5 portrait + two squares). v3
flattened that into a background layer; v4 restores the real structure and
designs it: a deep vitrine-dark ground (near-black with a burgundy radial
top-left and a gold one bottom-right, plus fine grain so the large dark
field doesn't band), cream serif display type carrying the page, and the
photography reduced to small gold-hairline-framed plates where its
weaknesses don't show. A large low-opacity gold arc sits behind the collage.

Still pure CSS in `premium.css`. Because several v3 hero rules were
*structural* (absolute positioning, `display:none` on the stacked pair, a
100vw break-out), v4 reverses each one explicitly rather than relying on
cascade order alone.

**Collage proportions are load-bearing**: at `1fr / 0.72fr` the stacked pair
(2 squares + gap) is taller than the 4:5 plate beside it, so the stagger
read as accidental. At `1.25fr / 0.75fr` the columns resolve to the same
height — the plate is `h = 1.25w`, the pair is `2(0.6w) + gap ≈ 1.25w` — so
the remaining ±4.5% translate reads as a deliberate stagger. Below 1024px
the pair becomes `display: contents` and all three plates sit in one
three-up row of squares, which keeps the hero at exactly 100vh on a phone.

**`assets/hero-video.js` no longer starts its default clip rotation.** Its
`init()` now returns after the manifest branch. `CLIPS`, `initVideoClips()`
and `playSafely()` are left intact rather than deleted for two reasons: the
admin's "Hero — Diapositivas" tool still drives the same slot through
`initManifestSlides()` when the owner configures slides, and restoring the
default rotation is a one-line change. **Do not delete that dead code
without also checking the Homepage Manager tab.**

`h1` sets to `max-width: 18ch`; 15ch broke the Spanish headline into four
short lines with a ragged left-heavy shape.

## Hero v5 — wide banner (2026-09-14). SUPERSEDES v3 AND v4.

v3 (full-bleed cover video) and v4 (dark editorial split) were both
rejected. The brief all along was **"WordPress/professional"** — a bright,
conventional, obviously-finished commercial hero — and v3/v4 were pushing
the opposite way, toward editorial luxury-house minimalism. Three directions
were mocked as standalone HTML and screenshotted for the owner to choose
from; they picked the wide banner.

**If a future pass is asked to "make it more premium", re-read this
paragraph first.** The owner's reference point is a polished commercial
theme, not a fashion house.

Shape: full-width photographic banner, a white-to-transparent wash from the
left, copy in dark ink over the light side, and a four-item guarantee strip
directly underneath. Header is solid white/cream again (v4's transparent
masthead and the hero's negative top margin are both reversed).

**`brand/hero-banner.jpg`** is a purpose-made 16:9 crop of
`producto-066-pulsera-set-dorado-066.webp`, generated by drawing the source
into a canvas in headless Chromium (no PIL or ffmpeg in this environment).
The crop deliberately starts 24% down the frame: **the source photo has the
owner's green marker annotation across its top**, which was visible in a
full-bleed crop. Don't swap the hero back to the raw product file.

The hero `<img>`'s `src` is edited directly in `index.html` — an
attribute-only change, the safe bucket, verified to survive 5s past
hydration.

**`assets/trust-bar.js`** (new, bucket 2) injects the two pieces that need
real DOM: the rating line appended inside the hero copy block, and the
guarantee strip inserted as a new sibling immediately after the hero
section. Both are id-guarded against duplication and re-checked once at
+1.2s in case a late React commit removed them. Verified present, correctly
ordered, and un-reverted 5s past load at 1440px and 390px.

**Placeholder copy warning**: the rating line reads "4.9/5 · clientas
atendidas por WhatsApp e Instagram" and the guarantee strip promises
same-day WhatsApp replies and nationwide shipping. **None of these are
verified claims** — they came from the mockup the owner approved, same
status as the placeholder prices and `units: 5` documented above. The owner
should confirm or replace them before this is shown as a live storefront
rather than a demo.

**The pseudo-element trap, hit three times in this file now**: v4 used the
media wrapper's `::after` as a decorative gold arc and set `display: none`
on it below 1024px. v5 repurposed that same `::after` as the legibility
wash, redeclaring `content`, `position`, `inset`, `background-image` — but
not `display`. Media queries add no specificity, so v4's `display: none`
still won on mobile and the copy sat unreadable straight on the photo while
`getComputedStyle` reported a perfectly correct gradient. **When
repurposing a pseudo-element across passes, reset every property the
previous pass set, not just the ones you care about.** The same class of bug
also hid the admin rail's active tab and the hero lede's colour (v3's
`section…bg-[#f8f3eb] p.max-w-xl.text-base.leading-7.text-muted-foreground`
scores (0,7,2) and out-specified an `h1 + p` shorthand, keeping the
paragraph cream-on-cream).

## Admin console redesign (2026-09-14)

The 2026-07-28 restyle copied a reference tool's "2px black border on every
surface" language. It reads as unfinished rather than considered, and it
flattens hierarchy: a six-up wall of identical outline rectangles gave
"Publicar cambios" exactly the same weight as "Exportar CSV", and six
billboard stat tiles shouted louder than the catalog they describe.

This pass re-cuts `admin.html` as a real internal console. **CSS only** —
appended to `assets/admin.css`, no `admin.html` and no `admin.js` changes;
every hook it needs already existed.

- **Left navigation rail.** `.hje-adm-main` already holds `.hje-adm-tabs`
  plus the sibling `.hje-adm-panel` blocks, so a two-column CSS grid at
  >=1024px turns the tab strip into a sticky rail with no markup change at
  all (hidden panels are `display:none` and claim no cell). Below that
  breakpoint it stays a horizontal strip.
- **Surface language**: 1px hairlines + soft elevation on white cards over a
  warm off-white app ground, a 6/9/14px radius scale, tabular figures
  everywhere, and one accent — gold, reserved for the publish action, the
  pending-change marker, and focus rings.
- **Action hierarchy**: one filled primary per context. `+ Agregar producto`
  leads the toolbar, `Publicar cambios` is pinned right and turns gold only
  when something is actually pending, `Descartar cambios` is a quiet
  tertiary that only reddens on hover, CSV actions are plain ghosts. Done
  with `order` on the existing flex children.
- **Stat strip**: one bordered card with hairline-divided cells instead of
  six framed boxes; values bottom-align so a two-line label
  ("Valor inventario (venta)") doesn't knock its figure out of line.
- **Product cards**: `aspect-ratio` corrected from 4:3 to 4:5 to match the
  source photography — the old crop cut the actual piece out of frame on
  most products, the one thing an admin card has to show. Status became a
  dot-plus-label chip, `Editar` leads and `Eliminar` recedes until hovered,
  and a dirty card now carries a gold "Sin publicar" flag rather than
  signalling pending state by border colour alone.
- **Modals**: sticky title and sticky footer actions, so the ~20-field
  product form never hides its own Guardar behind a scroll. The form (or,
  on the wrapper-less modals, the grid) is the scroll container and
  `.hje-adm-modal-actions` is `position: sticky; bottom: 0` inside it, which
  works across all five modal shapes without touching their markup.

**Bugs this surfaced, worth remembering:**

- Every field rule in the original sheet is scoped to `.hje-adm-modal`
  (`.hje-adm-modal label { display:block }`, `.hje-adm-modal input
  { width:100% }`). The Inicio tab reuses `.hje-adm-form-grid` *outside* a
  modal, so its labels sat inline against browser-default-width inputs —
  "Titular del hero [tiny box]". Field styling now belongs to the grid, not
  to the modal that happened to be its first user.
- `.hje-adm-card` carries no padding of its own (product cards get it from
  `.hje-adm-card-body`). The Inicio tab uses `.hje-adm-card` as a plain
  section container, so its content ran flush against the border.
- `.hje-adm-modal-actions button { flex: 1 }` stretched Cancelar and Guardar
  to half the modal each, reading as two equal choices.
- `renderSalesChart()` emits `<svg width="100%" viewBox="0 0 300 80">`. At
  the rail layout's content width that scales to a ~290px-tall near-empty
  band; it is now capped and wrapped in a card.
- The app bar's fixed height plus `flex-wrap: nowrap` let the wordmark wrap
  to three lines and overflow at 390px.

**Previewing the admin locally**: both gates can be opened without a real
token by intercepting `https://api.github.com/**` in Playwright — return
`{permissions:{push:true}}` for the repo validation call, and for
`/contents/<path>` return `{content: <base64 of the local file>}` so the
sales-log and changelog tabs render real data. The passcode is the
`PASSCODE` constant at the top of `assets/admin.js`.


## Stylesheet cache-busting

`premium.css` / `admin.css` / `inventario.css` / `fonts.css` are linked with
a `?v=<YYYYMMDD>` query across all 100 HTML files (added 2026-09-14, bumped to `20260914b` with hero v4, which also busts `hero-video.js`; after a
design pass appeared not to land for a returning visitor). GitHub Pages
serves CSS with a `max-age` long enough that a repeat visitor can keep the
previous file, so **bump the version on every visual change** or the work
ships invisibly. `generateProductPage()` builds new product pages from a
real existing page fetched as a template, so generated pages inherit
whatever version the template carries — no separate update needed in
`admin.js`.

## PR lifecycle on this branch

PRs opened from `claude/spanish-translation-photo-fix-qp9s55` have
consistently been merged (often squash-merged) very shortly after creation
in every session so far. Before pushing new commits, check whether the
previous PR is already merged — if so, don't stack new commits on the old
branch tip; restart it from `origin/main`
(`git fetch origin main && git checkout -B claude/spanish-translation-photo-fix-qp9s55 origin/main`)
and expect to need a `--force-with-lease` push (confirm with the user first —
it's classified as a destructive git operation).

## The real fix, eventually (partially done)

The original version of this note said hand-editing "stops scaling once
new-product additions become frequent" and that the actual fix was
recovering the Next.js source + a real build pipeline. `admin.html` (above)
delivers most of that value without needing the source: products.json as
one structured data file, a real write path via the GitHub API, and
automatic propagation to shop/category/homepage pages. What it does *not*
solve: individual `producto/<slug>.html` pages are still generated
one-file-per-product rather than templated at request time, and there's
still no real backend — `admin.html`'s "backend" is a GitHub PAT living in
the admin's browser session, not a proper auth/authorization system. If
this ever needs real multi-admin accounts, granular permissions, or a
UI-driven history/rollback beyond `git log`, recovering the actual Next.js
source and a CI-driven build is still the eventual answer — but for the
current scale and WhatsApp-first business model, the gap it would close is
small now.
