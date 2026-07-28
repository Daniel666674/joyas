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
availability, featured, popularity, images[] (src/thumbnail/alt/width/
height), description, specifications{acabado,cuidado,origen,garantia},
seo{title,description}, instagramUrl`. `price`/`currency` are vestigial —
the UI always shows the literal string "Consultar precio", never a number
(WhatsApp-inquiry business model, no real pricing/checkout anywhere).

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
