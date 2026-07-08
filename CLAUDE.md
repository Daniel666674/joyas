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

The product catalog (66 SKUs as of 2026-07-08) is baked into a webpack chunk
as a plain JS array — currently `_next/static/chunks/370-38b28494715c6f30.js`
(filename is content-hashed, so search for a known slug like
`"cadena-con-dije-virgen-001"` if it's been rebuilt/renamed). Each entry has
`id, slug, sku, name, category, material, price, currency, availability,
featured, popularity, images[], description, specifications, seo,
instagramUrl`.

`assets/products.json` is a hand-extracted, human-readable mirror of that
same data, kept for tooling that needs the catalog without parsing a webpack
chunk (e.g. `inventario.html`). **It can drift** — there's no build step
that keeps them in sync. Re-extract after any catalog change by locating the
chunk, grabbing the array literal, and running it through Node (`eval` the
snippet, since it uses bare `!0`/`!1` for booleans, not valid JSON) to dump
fresh JSON.

## PR lifecycle on this branch

PRs opened from `claude/spanish-translation-photo-fix-qp9s55` have
consistently been merged (often squash-merged) very shortly after creation
in every session so far. Before pushing new commits, check whether the
previous PR is already merged — if so, don't stack new commits on the old
branch tip; restart it from `origin/main`
(`git fetch origin main && git checkout -B claude/spanish-translation-photo-fix-qp9s55 origin/main`)
and expect to need a `--force-with-lease` push (confirm with the user first —
it's classified as a destructive git operation).

## The real fix, eventually

None of the above is a substitute for having the actual Next.js source and a
real build pipeline. At current catalog size (66 SKUs, low change velocity)
hand-editing is annoying but workable. It stops scaling once new-product
additions become frequent — each new product page currently has to be
hand-cloned from an existing one and every reference rewritten by hand,
which is slow and error-prone. If/when that becomes a bottleneck, recovering
or rebuilding the source project (product data in one structured file, CI
that runs `next build` and redeploys on change) is the actual fix, not
another layer of hand-editing conventions.
