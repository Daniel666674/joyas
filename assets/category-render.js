(function () {
  "use strict";

  // Runtime catalog renderer for the category/material listing pages and
  // shop.html. These pages used to be Next.js-hydrated with the product
  // grid frozen into static HTML (duplicated in the DOM and a separate RSC
  // flight-payload script) - editing that safely meant keeping both copies
  // in sync, which is exactly the hydration trap CLAUDE.md warns about.
  // These pages are now hand-authored (no Next.js/React on them at all),
  // so this script owns the whole product grid: fetches products.json
  // fresh on every load and renders straight into the DOM. Zero hydration
  // risk, and catalog changes from admin.js show up here automatically.

  var CATEGORY_LABEL_TO_SLUG = {
    Cadenas: "cadenas",
    Pulseras: "pulseras",
    Anillos: "anillos",
    Argollas: "argollas",
    Aretes: "aretes",
    Collares: "collares",
    Dijes: "dijes"
  };
  // Admin only offers 3 materials as of 2026-07-30 (Oro 18K / Plata / Oro
  // Laminado) - the other keys stay mapped here so any pre-existing
  // product still on a legacy material (Oro 14K/10K/Rosa, Esmeraldas,
  // Diamantes) keeps filtering/sorting correctly on shop.html.
  var MATERIAL_LABEL_TO_SLUG = {
    "Oro Laminado": "oro-laminado",
    "Oro 18K": "oro-18k",
    "Oro 14K": "oro-14k",
    "Oro 10K": "oro-10k",
    "Plata": "plata-925",
    "Oro Rosa": "oro-rosa",
    Esmeraldas: "esmeraldas",
    Diamantes: "diamantes"
  };

  var EMPTY_STATE_HTML =
    '<div class="rounded-md border border-dashed border-border p-10 text-center text-muted-foreground">No encontramos piezas con esos filtros.</div>';

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function waHref(text) {
    return "https://wa.me/573001234567?text=" + encodeURIComponent(text);
  }

  function formatPrice(price) {
    var n = Number(price) || 0;
    if (n <= 0) return null;
    return "$" + Math.round(n).toLocaleString("es-CO");
  }

  // Populated by init() from assets/material-prices.json before any card
  // renders. Oro 18K/Plata prices move daily, so their displayed price is
  // weight(g) x price-per-gram computed here at load time rather than a
  // stale number baked into products.json - see the identical helper (and
  // the "why") in assets/admin.js.
  var materialPrices = {};
  function computeDisplayPrice(p) {
    var perGram = materialPrices[p.material];
    var weight = Number(p.weight) || 0;
    if (weight > 0 && perGram) return Math.round(weight * perGram);
    return p.price;
  }

  // Kept in sync with the identical helper in assets/admin.js - every
  // class used here already ships in this static export's compiled CSS
  // (reused from the existing "Destacado" badge and WhatsApp/Instagram
  // buttons), since a *new* Tailwind class would have no CSS behind it.
  function badgeStackHtml(p) {
    var badges = "";
    if (p.featured) badges += '<span class="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium bg-white/90 text-gold-700">Destacado</span>';
    return badges ? '<div class="absolute left-3 top-3 flex flex-col gap-2">' + badges + "</div>" : "";
  }

  // Corner diagonal ribbon for promotion / tag — shown instead of the old pill
  // to match the Kevin's-style corner badge seen in reference catalog screenshots.
  function ribbonHtml(p) {
    if (!p.promotion && !p.tag) return "";
    var label = (p.tag && p.tag.length <= 10) ? p.tag : (p.promotion ? "OFERTA" : p.tag.slice(0, 10));
    return '<div class="hje-corner-ribbon" aria-hidden="true"><span>' + esc(label) + "</span></div>";
  }

  // Sold-out overlay — semi-transparent scrim with "Agotado" label
  function agotadoOverlay(p) {
    if (p.availability !== "Agotado") return "";
    return '<div class="hje-agotado-overlay" aria-hidden="true"><span class="hje-agotado-label">Agotado</span></div>';
  }

  function photoFitStyle(p) {
    return p.photoFit === "contain" ? ";object-fit:contain" : "";
  }

  // Exact article.group markup used sitewide for a product card (verified
  // against cadenas.html's grid and the related-products block on a real
  // product detail page). Keep this in sync with the equivalent template
  // string in assets/admin.js's page generator - both build the same card.
  function renderProductCard(p) {
    var img = p.images && p.images[0] ? p.images[0] : { src: "", alt: p.name };
    var badge = badgeStackHtml(p);
    var ribbon = ribbonHtml(p);
    var soldOut = agotadoOverlay(p);
    var href = "/joyas/producto/" + p.slug;
    var priceStr = formatPrice(computeDisplayPrice(p)) || "Consultar precio";
    var refNum = p.sku || ("JOY-" + (p.id || ""));
    return (
      '<article class="group">' +
      '<a class="block overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="' + href + '">' +
      '<div class="relative aspect-[4/5]">' +
      '<img alt="' + esc(img.alt) + '" loading="lazy" decoding="async" data-nimg="fill" class="object-cover transition-transform duration-500 group-hover:scale-105" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent' + photoFitStyle(p) + '" src="' + esc(img.src) + '"/>' +
      ribbon +
      soldOut +
      badge +
      '<button class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-foreground shadow-soft transition hover:bg-white" aria-label="Guardar ' + esc(p.name) + ' en favoritos">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-heart h-4 w-4"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>' +
      "</button>" +
      "</div></a>" +
      '<div class="mt-4 space-y-3">' +
      "<div>" +
      '<a class="font-medium hover:text-gold-700" href="' + href + '">' + esc(p.name) + "</a>" +
      '<p class="hje-sku">Ref. ' + esc(refNum) + "</p>" +
      '<p class="mt-1 text-sm text-muted-foreground">' + esc(p.category) + '<!-- --> · <!-- -->' + esc(p.material) + "</p>" +
      "</div>" +
      '<div class="flex items-center justify-between gap-3">' +
      '<span class="text-sm font-semibold">' + esc(priceStr) + "</span>" +
      '<div class="flex items-center gap-1">' +
      '<a href="' + esc(p.instagramUrl || "https://www.instagram.com/") + '" target="_blank" rel="noreferrer" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Ver en Instagram">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-instagram h-4 w-4"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line></svg>' +
      "</a>" +
      '<a href="' + waHref("Hola, quiero consultar " + p.name) + '" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Consultar por WhatsApp">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-4 w-4"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg>' +
      "</a>" +
      "</div></div></div></article>"
    );
  }

  function sortProducts(products, sort) {
    var list = products.slice();
    if (sort === "name") {
      list.sort(function (a, b) { return a.name.localeCompare(b.name, "es"); });
    } else if (sort === "newest") {
      list.sort(function (a, b) { return (b.id || "").localeCompare(a.id || ""); });
    } else if (sort === "price") {
      list.sort(function (a, b) { return (computeDisplayPrice(a) || 0) - (computeDisplayPrice(b) || 0); });
    } else {
      list.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    }
    return list;
  }

  function injectItemListSchema(products) {
    var existing = document.getElementById("hje-itemlist-ld");
    if (existing) existing.remove();
    if (!products.length) return;
    var items = products.map(function (p, i) {
      var price = computeDisplayPrice(p);
      var item = {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: p.name,
          url: "https://joyas-colombia.com/producto/" + p.slug,
          sku: p.sku || p.id,
          brand: { "@type": "Brand", name: "Habibi Eisaa" },
          description: p.description || "",
          offers: {
            "@type": "Offer",
            priceCurrency: "COP",
            availability: p.availability === "Disponible"
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock"
          }
        }
      };
      if (price > 0) item.item.offers.price = price;
      if (p.images && p.images[0]) item.item.image = p.images[0].src;
      return item;
    });
    var pageTitle = document.querySelector("h1");
    var ld = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: pageTitle ? pageTitle.textContent.trim() : "Catalogo",
      numberOfItems: products.length,
      itemListElement: items
    };
    var script = document.createElement("script");
    script.id = "hje-itemlist-ld";
    script.type = "application/ld+json";
    script.text = JSON.stringify(ld);
    document.head.appendChild(script);
  }

  function renderGrid(root, products) {
    if (!products.length) {
      root.innerHTML = EMPTY_STATE_HTML;
      return;
    }
    var grid = document.createElement("div");
    grid.className = "grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6";
    grid.innerHTML = products.map(renderProductCard).join("");
    root.innerHTML = "";
    root.appendChild(grid);
    injectItemListSchema(products);
  }

  // ---------- single category/material page mode ----------
  function initCategoryRoot(root, products) {
    var filterType = root.getAttribute("data-hje-filter-type");
    var filterValue = root.getAttribute("data-hje-filter-value");
    var matches = products.filter(function (p) { return p[filterType] === filterValue; });
    renderGrid(root, sortProducts(matches, "popularity"));
  }

  // ---------- shop.html full-catalog + filter-bar mode ----------
  function initShopRoot(root, products) {
    var params = new URLSearchParams(window.location.search);
    var q = (params.get("q") || "").trim().toLowerCase();
    var categorySlug = params.get("category") || "";
    var materialSlug = params.get("material") || "";
    var sort = params.get("sort") || "popularity";

    var matches = products.filter(function (p) {
      if (categorySlug && CATEGORY_LABEL_TO_SLUG[p.category] !== categorySlug) return false;
      if (materialSlug && MATERIAL_LABEL_TO_SLUG[p.material] !== materialSlug) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && p.category.toLowerCase().indexOf(q) === -1 && p.material.toLowerCase().indexOf(q) === -1) {
        return false;
      }
      return true;
    });
    renderGrid(root, sortProducts(matches, sort));

    // reflect current filters back into the filter form's inputs, if present
    var form = document.querySelector("form[action='/shop']");
    if (form) {
      var qInput = form.querySelector('[name="q"]');
      var categorySelect = form.querySelector('[name="category"]');
      var materialSelect = form.querySelector('[name="material"]');
      var sortSelect = form.querySelector('[name="sort"]');
      if (qInput) qInput.value = params.get("q") || "";
      if (categorySelect) categorySelect.value = categorySlug;
      if (materialSelect) materialSelect.value = materialSlug;
      if (sortSelect) sortSelect.value = sort;
    }
  }

  function init() {
    var root = document.getElementById("hje-cat-root");
    var shopRoot = document.getElementById("hje-shop-root");
    if (!root && !shopRoot) return;

    Promise.all([
      fetch("/joyas/assets/products.json").then(function (r) { return r.json(); }),
      fetch("/joyas/assets/material-prices.json").then(function (r) { return r.json(); }).catch(function () { return {}; })
    ])
      .then(function (results) {
        var products = results[0];
        materialPrices = results[1] || {};
        if (root) initCategoryRoot(root, products);
        if (shopRoot) initShopRoot(shopRoot, products);
      })
      .catch(function () {
        var target = root || shopRoot;
        target.innerHTML =
          '<p class="text-sm text-muted-foreground">No se pudo cargar el catalogo. Intenta recargar la pagina.</p>';
      });
  }

  window.HJE_renderProductCard = renderProductCard;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
