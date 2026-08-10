(function () {
  "use strict";

  // Homepage-only: keeps "Favoritas para consultar hoy" in sync with
  // products.json without ever adding/removing a DOM node. The section is
  // hydrated by Next.js like the rest of the homepage, so structurally
  // changing the slot count would get reverted (see CLAUDE.md's hydration
  // trap). Instead this rewrites the 8 existing card slots' text/attributes
  // in place - the proven-safe bucket - guarded by an equality check before
  // every write, same pattern as store.js's badge updates.
  //
  // Rewriting an existing Link's href isn't enough on its own, though:
  // verified empirically that Next's <Link> click handler navigates using
  // the href it captured in its component props at hydration time, not by
  // reading the DOM attribute at click time - so a rewritten card would
  // *look* right (correct href visible on hover/inspect) but clicking it
  // would silently navigate to whatever product originally occupied that
  // slot. Every link this script touches gets a capture-phase interceptor
  // (same pattern as store.js's wishlist-heart fix in CLAUDE.md) that
  // forces a real navigation using the live href instead.

  if (!/\/(index\.html)?$/.test(window.location.pathname) && window.location.pathname !== "/joyas/" && window.location.pathname !== "/joyas") {
    return;
  }

  function formatPrice(price) {
    var n = Number(price) || 0;
    if (n <= 0) return null;
    return "$" + Math.round(n).toLocaleString("es-CO");
  }

  // Populated in init() from assets/material-prices.json. Kept in sync
  // with the identical helper in admin.js/category-render.js - see
  // CLAUDE.md for why Oro 18K/Plata prices are computed live from weight
  // instead of trusting the stored `price` field.
  var materialPrices = {};
  function computeDisplayPrice(p) {
    var perGram = materialPrices[p.material];
    var weight = Number(p.weight) || 0;
    if (weight > 0 && perGram) return Math.round(weight * perGram);
    return p.price;
  }

  // Idempotent per-slot badge stack (Destacado/Tag/Promocion) - this
  // section only ever holds already-featured products, so Destacado
  // always shows; Tag/Promocion are added/removed as needed on refresh
  // without disturbing badges that shouldn't change, same equality-guard
  // spirit as setText/setAttr above.
  function ensureBadge(wrap, key, className, text) {
    var el = wrap.querySelector("." + key);
    if (!el) {
      el = document.createElement("span");
      el.className = key + " " + className;
      wrap.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }
  function removeBadge(wrap, key) {
    var el = wrap.querySelector("." + key);
    if (el) el.remove();
  }

  function findFeaturedGrid() {
    var heading = Array.prototype.find.call(
      document.querySelectorAll("h2"),
      function (h) { return h.textContent.trim() === "Favoritas para consultar hoy"; }
    );
    if (!heading) return null;
    var section = heading.closest("section");
    return section ? section.querySelector(".grid.grid-cols-2") : null;
  }

  function selectTop8(products) {
    return products
      .filter(function (p) { return p.featured; })
      .sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); })
      .slice(0, 8);
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function setText(el, value) {
    if (el.textContent !== value) el.textContent = value;
  }

  function updateSlot(article, product) {
    var href = "/joyas/producto/" + product.slug;
    var img = product.images && product.images[0] ? product.images[0] : { src: "", alt: product.name };

    var mainLink = article.querySelector("a.block[href*='/producto/']");
    if (mainLink) {
      setAttr(mainLink, "href", href);
      mainLink.classList.add("hje-featured-link");
    }

    var image = article.querySelector("img");
    if (image) {
      setAttr(image, "src", img.src);
      setAttr(image, "alt", img.alt);
      var fit = product.photoFit === "contain" ? "contain" : "cover";
      if (image.style.objectFit !== fit) image.style.objectFit = fit;
    }

    var nameLink = article.querySelector(".mt-4 a[href*='/producto/']");
    if (nameLink) {
      setAttr(nameLink, "href", href);
      setText(nameLink, product.name);
      nameLink.classList.add("hje-featured-link");
    }

    var metaP = article.querySelector(".mt-4 p");
    if (metaP) {
      var newMeta = product.category + " · " + product.material;
      if (metaP.textContent.trim() !== newMeta) {
        metaP.textContent = product.category + " · " + product.material;
        // matches the source markup's comment-separated text nodes closely
        // enough for display purposes; exact node structure doesn't matter
        // since nothing else reads it structurally
      }
    }

    var priceSpan = article.querySelector(".flex.items-center.justify-between.gap-3 > span.text-sm.font-semibold");
    if (priceSpan) {
      var priceText = formatPrice(computeDisplayPrice(product)) || "Consultar precio";
      setText(priceSpan, priceText);
    }

    var waLink = article.querySelector("a[href^='https://wa.me/']");
    if (waLink) {
      var waHref = "https://wa.me/573001234567?text=" + encodeURIComponent("Hola, quiero consultar " + product.name);
      setAttr(waLink, "href", waHref);
    }

    var saveBtn = article.querySelector('button[aria-label^="Guardar "]');
    if (saveBtn) {
      setAttr(saveBtn, "aria-label", "Guardar " + product.name + " en favoritos");
    }

    var mediaDiv = article.querySelector(".relative.aspect-\\[4\\/5\\]");
    if (mediaDiv) {
      var legacyBadge = mediaDiv.querySelector(":scope > span.absolute.left-3.top-3");
      if (legacyBadge) legacyBadge.remove();
      var badgeWrap = mediaDiv.querySelector(".hje-badge-stack");
      if (!badgeWrap) {
        badgeWrap = document.createElement("div");
        badgeWrap.className = "hje-badge-stack absolute left-3 top-3 flex flex-col gap-2";
        mediaDiv.appendChild(badgeWrap);
      }
      // every product reaching this section is featured by construction
      // (selectTop8 filters on it), so Destacado always shows here
      ensureBadge(badgeWrap, "hje-badge-destacado", "inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium bg-white/90 text-gold-700", "Destacado");
      if (product.tag) {
        ensureBadge(badgeWrap, "hje-badge-tag", "inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium bg-white/90 text-gold-700", product.tag);
      } else {
        removeBadge(badgeWrap, "hje-badge-tag");
      }
      if (product.promotion) {
        ensureBadge(badgeWrap, "hje-badge-promo", "inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground", "Promocion");
      } else {
        removeBadge(badgeWrap, "hje-badge-promo");
      }
    }
  }

  function interceptStaleNextRouting() {
    document.addEventListener(
      "click",
      function (e) {
        var link = e.target.closest && e.target.closest(".hje-featured-link");
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        window.location.href = link.getAttribute("href");
      },
      true
    );
  }

  function init() {
    var pricesFetch = fetch("/joyas/assets/material-prices.json?v=" + Date.now())
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; });

    function applyProducts(products, prices) {
      materialPrices = prices || {};
      var grid = findFeaturedGrid();
      if (!grid) return;
      var articles = grid.querySelectorAll("article.group");
      var top8 = selectTop8(products);
      if (articles.length !== 8 || top8.length !== 8) return;
      for (var i = 0; i < 8; i++) updateSlot(articles[i], top8[i]);
      interceptStaleNextRouting();
    }

    if (window.APP_PRODUCTS && Array.isArray(window.APP_PRODUCTS)) {
      pricesFetch.then(function (prices) { applyProducts(window.APP_PRODUCTS, prices); })
        .catch(function () {});
      return;
    }

    Promise.all([
      fetch("/joyas/assets/products.json?v=" + Date.now()).then(function (r) { return r.json(); }),
      pricesFetch
    ])
      .then(function (results) { applyProducts(results[0], results[1]); })
      .catch(function () {
        // silent: keep whatever is already baked into the page
      });
  }

  function deferredInit() {
    setTimeout(init, 500);
  }

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
