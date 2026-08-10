(function () {
  "use strict";

  var WHATSAPP_NUMBER = "573001234567";
  var CART_KEY = "hje_cart";
  var WISHLIST_KEY = "hje_wishlist";
  var ORDERS_KEY = "hje_orders";

  // ---------- state ----------
  function loadList(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {}
  }

  function itemKey(slug, size, color) {
    return slug + "::" + (size || "") + "::" + (color || "");
  }

  // Backward-compat with carts saved before price/qty/variant tracking
  // existed - old entries just get sane defaults instead of breaking.
  function normalizeCart(list) {
    return list.map(function (item) {
      var size = item.size || null;
      var color = item.color || null;
      return {
        key: item.key || itemKey(item.slug, size, color),
        slug: item.slug,
        name: item.name,
        image: item.image,
        href: item.href,
        meta: item.meta || "",
        unitPrice: typeof item.unitPrice === "number" ? item.unitPrice : null,
        priceText: item.priceText || "Consultar precio",
        size: size,
        color: color,
        stock: typeof item.stock === "number" ? item.stock : null,
        qty: Number(item.qty) || 1
      };
    });
  }

  var cart = normalizeCart(loadList(CART_KEY));
  var wishlist = loadList(WISHLIST_KEY);

  function findItem(list, slug) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === slug) return i;
    }
    return -1;
  }
  function findItemByKey(list, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return i;
    }
    return -1;
  }

  // ---------- catalog (for real prices/stock/variants) ----------
  // Same computeDisplayPrice/formatPrice formula as admin.js,
  // category-render.js, homepage-featured-refresh.js - keep in sync.
  var catalogBySlug = {};
  var materialPrices = {};

  function computeDisplayPrice(p) {
    var perGram = materialPrices[p.material];
    var weight = Number(p.weight) || 0;
    if (weight > 0 && perGram) return Math.round(weight * perGram);
    return p.price;
  }
  function formatPrice(n) {
    var v = Number(n) || 0;
    if (v <= 0) return "Consultar precio";
    return "$" + Math.round(v).toLocaleString("es-CO");
  }
  // Fallback when the catalog fetch fails: parse the price already
  // rendered into the card/detail page ("$180.000" -> 180000).
  function parsePriceText(text) {
    if (!text) return null;
    var digits = text.replace(/[^\d]/g, "");
    return digits ? Number(digits) : null;
  }

  function loadCatalog() {
    var pricesFetch = fetch("/joyas/assets/material-prices.json?v=" + Date.now())
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; });
    var productsFetch = window.APP_PRODUCTS && Array.isArray(window.APP_PRODUCTS)
      ? Promise.resolve(window.APP_PRODUCTS)
      : fetch("/joyas/assets/products.json?v=" + Date.now())
          .then(function (r) { return r.json(); })
          .catch(function () { return []; });
    return Promise.all([productsFetch, pricesFetch]).then(function (results) {
      materialPrices = results[1] || {};
      (results[0] || []).forEach(function (p) { catalogBySlug[p.slug] = p; });
    });
  }

  // ---------- product extraction (pure, no DOM writes) ----------
  function productFromCard(article) {
    var nameLink = article.querySelector(".mt-4 a[href*='/producto/']");
    var mainLink = article.querySelector("a[href*='/producto/']");
    var img = article.querySelector("img");
    var meta = article.querySelector(".mt-4 p");
    var priceEl = article.querySelector(".text-sm.font-semibold");
    var link = nameLink || mainLink;
    var href = link ? link.getAttribute("href") : "";
    var slug = href ? href.replace(/\/$/, "").split("/producto/").pop() : "";
    var catalogP = slug ? catalogBySlug[slug] : null;

    var hasVariants = !!(catalogP && catalogP.variants && (
      (catalogP.variants.sizes && catalogP.variants.sizes.length) ||
      (catalogP.variants.colors && catalogP.variants.colors.length)
    ));
    var stock = catalogP ? (hasVariants ? null : Number(catalogP.units) || 0) : null;
    var unitPrice = catalogP ? computeDisplayPrice(catalogP) : parsePriceText(priceEl ? priceEl.textContent : "");
    if (!(unitPrice > 0)) unitPrice = null;

    return {
      slug: slug,
      name: nameLink ? nameLink.textContent.trim() : "",
      image: img ? img.getAttribute("src") : "",
      meta: meta ? meta.textContent.trim() : "",
      href: href,
      unitPrice: unitPrice,
      priceText: unitPrice !== null ? formatPrice(unitPrice) : (priceEl ? priceEl.textContent.trim() : "Consultar precio"),
      stock: stock,
      requiresVariant: hasVariants,
      available: catalogP ? catalogP.availability !== "Agotado" : true
    };
  }

  function productFromDetailPage() {
    var h1 = document.querySelector("main h1");
    var img = document.querySelector("main img");
    // scoped to the category/material/availability pill row specifically -
    // a plain ".flex.flex-wrap.gap-2 span" also matches the breadcrumb <ol>
    // (same classes) and picks up its "/" separator instead
    var badge = document.querySelector("main span.rounded-full.border-border.bg-background");
    var priceEl = document.querySelector("main p.mt-3.text-2xl.font-semibold");
    var slug = window.location.pathname.replace(/\/$/, "").split("/producto/").pop();
    var catalogP = slug ? catalogBySlug[slug] : null;

    var sizes = (catalogP && catalogP.variants && catalogP.variants.sizes) || [];
    var colors = (catalogP && catalogP.variants && catalogP.variants.colors) || [];
    var selection = window.__hjeVariantSelection || {};
    var size = sizes.length ? (selection["Talla"] || null) : null;
    var color = (!sizes.length && colors.length) ? (selection["Color"] || null) : null;

    var stock = null;
    if (sizes.length) {
      var sOpt = size ? sizes.filter(function (o) { return o.label === size; })[0] : null;
      stock = sOpt ? Number(sOpt.units) || 0 : null;
    } else if (colors.length) {
      var cOpt = color ? colors.filter(function (o) { return o.label === color; })[0] : null;
      stock = cOpt ? Number(cOpt.units) || 0 : null;
    } else if (catalogP) {
      stock = Number(catalogP.units) || 0;
    }

    var unitPrice = catalogP ? computeDisplayPrice(catalogP) : parsePriceText(priceEl ? priceEl.textContent : "");
    if (!(unitPrice > 0)) unitPrice = null;

    return {
      slug: slug,
      name: h1 ? h1.textContent.trim() : document.title,
      image: img ? img.getAttribute("src") : "",
      meta: badge ? badge.textContent.trim() : "",
      href: window.location.pathname,
      unitPrice: unitPrice,
      priceText: unitPrice !== null ? formatPrice(unitPrice) : (priceEl ? priceEl.textContent.trim() : "Consultar precio"),
      stock: stock,
      requiresSize: sizes.length > 0,
      requiresColor: !sizes.length && colors.length > 0,
      size: size,
      color: color
    };
  }

  // ---------- icons ----------
  var ICON_BAG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>';
  var ICON_X =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  var ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  var ICON_PLUS =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>';
  var ICON_MINUS =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path></svg>';
  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';

  var STYLES = [
    "#hje-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;opacity:0;pointer-events:none;transition:opacity .2s ease}",
    "#hje-backdrop.open{opacity:1;pointer-events:auto}",
    ".hje-drawer{position:fixed;top:0;right:0;height:100%;width:100%;max-width:400px;background:#faf6ef;color:#1a1a1a;z-index:9999;box-shadow:-8px 0 24px rgba(0,0,0,.25);transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;font-family:inherit}",
    ".hje-drawer.open{transform:translateX(0)}",
    ".hje-drawer-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e6ddcd}",
    ".hje-drawer-head h2{font-size:1.15rem;font-weight:600;margin:0}",
    ".hje-drawer-close{background:none;border:0;cursor:pointer;color:#1a1a1a;padding:6px;border-radius:6px}",
    ".hje-drawer-close:hover{background:#eee3d0}",
    ".hje-drawer-body{flex:1;overflow-y:auto;padding:12px 20px}",
    ".hje-empty{color:#77706a;font-size:.9rem;padding:24px 0;text-align:center}",
    ".hje-item{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #eee3d0}",
    ".hje-item img{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#eee3d0;flex-shrink:0}",
    ".hje-item-info{flex:1;min-width:0}",
    ".hje-item-info a{font-weight:600;text-decoration:none;color:#1a1a1a;font-size:.92rem}",
    ".hje-item-info p{margin:2px 0 0;font-size:.8rem;color:#77706a}",
    ".hje-item-remove{background:none;border:0;cursor:pointer;color:#7a1c28;padding:6px;align-self:flex-start;border-radius:6px}",
    ".hje-item-remove:hover{background:rgba(122,28,40,.1)}",
    ".hje-item-price-row{display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:8px}",
    ".hje-item-price{font-weight:700;font-size:.85rem;color:#1a1a1a}",
    ".hje-qty-stepper{display:flex;align-items:center;gap:6px;border:1px solid #d8cdb8;border-radius:999px;padding:2px 6px;flex-shrink:0}",
    ".hje-qty-btn{background:none;border:0;cursor:pointer;width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;border-radius:999px}",
    ".hje-qty-btn:hover{background:#eee3d0}",
    ".hje-qty-btn:disabled{opacity:.35;cursor:not-allowed}",
    ".hje-qty-val{min-width:14px;text-align:center;font-size:.82rem;font-weight:600}",
    ".hje-drawer-foot{padding:16px 20px;border-top:1px solid #e6ddcd}",
    ".hje-cart-subtotal-row{display:flex;align-items:center;justify-content:space-between;padding:0 0 12px;font-size:.92rem}",
    ".hje-cart-note{font-size:.72rem;color:#8a7a5f;margin:-6px 0 10px}",
    ".hje-btn-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border-radius:8px;border:0;cursor:pointer;background-image:linear-gradient(135deg,#f7e6b0 0%,#dfb968 22%,#a8782a 48%,#7a5320 68%,#e3c077 88%,#f7e6b0 100%);color:#2a1c08;font-weight:700;font-size:.9rem;text-decoration:none;box-shadow:0 8px 20px -6px rgba(168,120,42,.45);transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s}",
    ".hje-btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 26px -6px rgba(168,120,42,.55)}",
    ".hje-btn-primary[disabled]{opacity:.4;pointer-events:none}",
    ".hje-btn-secondary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:11px;border-radius:8px;border:1.5px solid #1a1a1a;cursor:pointer;background:transparent;color:#1a1a1a;font-weight:600;font-size:.85rem;text-decoration:none;margin-top:8px;transition:background .15s ease}",
    ".hje-btn-secondary:hover{background:#eee3d0}",
    ".hje-btn-secondary[disabled]{opacity:.4;pointer-events:none}",
    ".hje-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:#7a1c28;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:700;pointer-events:none}",
    ".hje-card-cart-btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:6px;border:0;background:transparent;color:inherit;cursor:pointer}",
    ".hje-card-cart-btn:hover{background:rgba(0,0,0,.06)}",
    ".hje-card-cart-btn.added,.hje-detail-cart-btn.added{color:#2f6d3c}",
    ".hje-detail-cart-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid #d8cdb8;background:#fff;height:48px;padding:0 24px;font-weight:600;font-size:.9rem;cursor:pointer;grid-column:1/-1}",
    ".hje-detail-cart-btn:hover{background:#f5efe2}",
    ".hje-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,10px);background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:999px;font-size:.85rem;z-index:10000;opacity:0;transition:opacity .2s ease,transform .2s ease;pointer-events:none;max-width:88vw;text-align:center}",
    ".hje-toast.show{opacity:1;transform:translate(-50%,0)}",
    // ---- simulated checkout ----
    ".hje-checkout-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .2s ease}",
    ".hje-checkout-overlay.open{opacity:1;pointer-events:auto}",
    ".hje-checkout-modal{position:relative;background:#faf6ef;color:#1a1a1a;border-radius:12px;max-width:420px;width:100%;max-height:88vh;overflow-y:auto;padding:26px 24px;box-shadow:0 24px 48px -12px rgba(0,0,0,.35);font-family:inherit}",
    ".hje-checkout-close{position:absolute;top:12px;right:12px;background:none;border:0;cursor:pointer;color:#1a1a1a;padding:6px;border-radius:6px}",
    ".hje-checkout-close:hover{background:#eee3d0}",
    ".hje-checkout-overlay.hje-processing .hje-checkout-close{display:none}",
    ".hje-checkout-step{display:none}",
    ".hje-checkout-step.hje-show{display:block}",
    ".hje-checkout-modal h2{font-size:1.2rem;font-weight:700;margin:0 0 6px}",
    ".hje-checkout-sub{font-size:.82rem;color:#77706a;margin:0 0 16px;line-height:1.45}",
    ".hje-checkout-modal form label{display:block;font-size:.8rem;font-weight:600;margin-bottom:12px}",
    ".hje-checkout-modal form input{width:100%;margin-top:4px;padding:10px 12px;border:1.5px solid #d8cdb8;border-radius:8px;font-size:.9rem;font-family:inherit;box-sizing:border-box}",
    ".hje-checkout-modal form input:focus{outline:none;border-color:#a8782a}",
    ".hje-checkout-error{color:#a12626;font-size:.78rem;min-height:1em;margin:-4px 0 10px}",
    ".hje-checkout-order-summary{border-top:1px solid #e6ddcd;border-bottom:1px solid #e6ddcd;padding:8px 0;margin:4px 0 16px}",
    ".hje-checkout-order-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:.82rem;padding:4px 0;color:#4a4438}",
    ".hje-checkout-order-total{font-weight:700;color:#1a1a1a;font-size:.9rem;border-top:1px dashed #d8cdb8;margin-top:4px;padding-top:8px}",
    ".hje-checkout-sim-step{display:flex;align-items:center;gap:10px;padding:12px 0;font-size:.85rem;color:#4a4438}",
    ".hje-checkout-spinner{width:18px;height:18px;border-radius:50%;border:2.5px solid #e6ddcd;border-top-color:#a8782a;animation:hje-spin .8s linear infinite;flex-shrink:0}",
    ".hje-checkout-check{display:none;color:#2f6d3c;flex-shrink:0}",
    ".hje-checkout-sim-step.hje-done .hje-checkout-spinner{display:none}",
    ".hje-checkout-sim-step.hje-done .hje-checkout-check{display:inline-flex}",
    "@keyframes hje-spin{to{transform:rotate(360deg)}}",
    ".hje-checkout-step-done{text-align:center}",
    ".hje-checkout-success-icon{width:52px;height:52px;border-radius:50%;background:rgba(47,109,60,.12);color:#2f6d3c;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}",
    ".hje-checkout-disclaimer{font-size:.74rem;color:#8a7a5f;line-height:1.5;margin:0 0 16px}"
  ].join("\n");

  // Everything below touches the live DOM. It must not run until the page's
  // own hydration has settled: Next.js hydrates via async chunks with no
  // fixed order relative to this (deferred) script, so mutating hydrated
  // markup (header, product cards) too early races React and can trigger a
  // hydration-mismatch error. Waiting for `load` sidesteps the race, and the
  // MutationObserver started at the end keeps everything self-healing if a
  // later client-side re-render replaces content we've already touched.
  function setupUI() {
    var toastEl, backdrop, cartDrawer, wishlistDrawer, checkoutOverlay, toastTimer;
    var pendingContact = null;

    var style = document.createElement("style");
    style.textContent = STYLES;
    document.head.appendChild(style);

    toastEl = document.createElement("div");
    toastEl.className = "hje-toast";
    document.body.appendChild(toastEl);
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.classList.remove("show");
      }, 1800);
    }

    backdrop = document.createElement("div");
    backdrop.id = "hje-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", function () {
      closeDrawer(cartDrawer);
      closeDrawer(wishlistDrawer);
    });

    function openDrawer(el) {
      closeDrawer(el === cartDrawer ? wishlistDrawer : cartDrawer);
      el.classList.add("open");
      backdrop.classList.add("open");
    }
    function closeDrawer(el) {
      el.classList.remove("open");
      if (!cartDrawer.classList.contains("open") && !wishlistDrawer.classList.contains("open")) {
        backdrop.classList.remove("open");
      }
    }

    // ---------- pricing helpers shared by drawer + checkout ----------

    function cartTotals() {
      var known = 0;
      var hasUnknown = false;
      cart.forEach(function (item) {
        if (typeof item.unitPrice === "number") known += item.unitPrice * item.qty;
        else hasUnknown = true;
      });
      return { known: known, hasUnknown: hasUnknown };
    }

    function orderRowsHtml() {
      return cart.map(function (item) {
        var lineTotal = typeof item.unitPrice === "number" ? item.unitPrice * item.qty : null;
        var variantLine = item.size ? (" · Talla " + item.size) : (item.color ? (" · Color " + item.color) : "");
        return (
          '<div class="hje-checkout-order-row"><span>' + item.qty + "&times; " + esc(item.name) + esc(variantLine) +
          "</span><strong>" + (lineTotal !== null ? formatPrice(lineTotal) : (item.priceText || "Consultar")) + "</strong></div>"
        );
      }).join("");
    }

    function orderSummaryHtml() {
      var totals = cartTotals();
      return (
        orderRowsHtml() +
        '<div class="hje-checkout-order-row hje-checkout-order-total"><span>Total</span><strong>' +
        formatPrice(totals.known) + (totals.hasUnknown ? " +" : "") + "</strong></div>" +
        (totals.hasUnknown ? '<p class="hje-cart-note">* Algunos precios se confirman por WhatsApp.</p>' : "")
      );
    }

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    // ---------- cart drawer ----------

    cartDrawer = document.createElement("div");
    cartDrawer.className = "hje-drawer";
    cartDrawer.innerHTML =
      '<div class="hje-drawer-head"><h2>Tu carrito</h2><button class="hje-drawer-close" type="button" aria-label="Cerrar carrito">' +
      ICON_X +
      '</button></div><div class="hje-drawer-body" id="hje-cart-body"></div>' +
      '<div class="hje-drawer-foot"><div id="hje-cart-summary"></div>' +
      '<button type="button" class="hje-btn-primary" id="hje-cart-checkout-btn">' + ICON_BAG + ' Finalizar compra (pago simulado)</button>' +
      '<a class="hje-btn-secondary" id="hje-cart-wa-link" target="_blank" rel="noreferrer">Continuar por WhatsApp</a></div>';
    document.body.appendChild(cartDrawer);
    cartDrawer.querySelector(".hje-drawer-close").addEventListener("click", function () {
      closeDrawer(cartDrawer);
    });
    cartDrawer.querySelector("#hje-cart-checkout-btn").addEventListener("click", openCheckout);

    function renderCartDrawer() {
      var body = cartDrawer.querySelector("#hje-cart-body");
      var summary = cartDrawer.querySelector("#hje-cart-summary");
      var checkoutBtn = cartDrawer.querySelector("#hje-cart-checkout-btn");
      var waLink = cartDrawer.querySelector("#hje-cart-wa-link");

      if (!cart.length) {
        body.innerHTML = '<p class="hje-empty">Todavia no agregaste piezas al carrito.</p>';
        summary.innerHTML = "";
        checkoutBtn.setAttribute("disabled", "disabled");
        waLink.setAttribute("disabled", "disabled");
        waLink.removeAttribute("href");
        return;
      }
      checkoutBtn.removeAttribute("disabled");
      waLink.removeAttribute("disabled");

      body.innerHTML = cart.map(function (item) {
        var lineTotal = typeof item.unitPrice === "number" ? item.unitPrice * item.qty : null;
        var priceDisplay = lineTotal !== null ? formatPrice(lineTotal) : (item.priceText || "Consultar precio");
        var variantLine = item.size ? ("Talla: " + item.size) : (item.color ? ("Color: " + item.color) : "");
        var atMax = typeof item.stock === "number" && item.qty >= item.stock;
        return (
          '<div class="hje-item" data-key="' + esc(item.key) + '">' +
          '<img src="' + esc(item.image) + '" alt=""/>' +
          '<div class="hje-item-info">' +
          '<a href="' + esc(item.href) + '">' + esc(item.name) + "</a>" +
          "<p>" + esc(item.meta) + (variantLine ? " · " + esc(variantLine) : "") + "</p>" +
          '<div class="hje-item-price-row">' +
          '<span class="hje-item-price">' + esc(priceDisplay) + "</span>" +
          '<div class="hje-qty-stepper">' +
          '<button type="button" class="hje-qty-btn hje-qty-minus" data-key="' + esc(item.key) + '" aria-label="Reducir cantidad">' + ICON_MINUS + "</button>" +
          '<span class="hje-qty-val">' + item.qty + "</span>" +
          '<button type="button" class="hje-qty-btn hje-qty-plus" data-key="' + esc(item.key) + '" aria-label="Aumentar cantidad"' + (atMax ? " disabled" : "") + ">" + ICON_PLUS + "</button>" +
          "</div></div></div>" +
          '<button class="hje-item-remove" type="button" data-key="' + esc(item.key) + '" aria-label="Quitar ' + esc(item.name) + ' del carrito">' +
          ICON_TRASH +
          "</button></div>"
        );
      }).join("");

      var totals = cartTotals();
      summary.innerHTML =
        '<div class="hje-cart-subtotal-row"><span>Subtotal</span><strong>' +
        formatPrice(totals.known) + (totals.hasUnknown ? " +" : "") + "</strong></div>" +
        (totals.hasUnknown ? '<p class="hje-cart-note">* Algunos productos requieren confirmar precio por WhatsApp.</p>' : "");

      Array.prototype.forEach.call(body.querySelectorAll(".hje-item-remove"), function (btn) {
        btn.addEventListener("click", function () {
          var i = findItemByKey(cart, btn.getAttribute("data-key"));
          if (i !== -1) {
            cart.splice(i, 1);
            saveList(CART_KEY, cart);
            renderBadges();
            renderCartDrawer();
          }
        });
      });
      Array.prototype.forEach.call(body.querySelectorAll(".hje-qty-minus"), function (btn) {
        btn.addEventListener("click", function () { changeQty(btn.getAttribute("data-key"), -1); });
      });
      Array.prototype.forEach.call(body.querySelectorAll(".hje-qty-plus"), function (btn) {
        btn.addEventListener("click", function () { changeQty(btn.getAttribute("data-key"), 1); });
      });

      var lines = cart.map(function (p) {
        var variantLine = p.size ? (" (Talla " + p.size + ")") : (p.color ? (" (Color " + p.color + ")") : "");
        return "- " + p.qty + "x " + p.name + variantLine;
      });
      var text = "Hola, quiero consultar disponibilidad de:\n" + lines.join("\n");
      waLink.setAttribute("href", "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text));
    }

    function changeQty(key, delta) {
      var idx = findItemByKey(cart, key);
      if (idx === -1) return;
      var item = cart[idx];
      var next = item.qty + delta;
      var cap = typeof item.stock === "number" ? item.stock : Infinity;
      if (next < 1) return; // use the trash icon to remove a line entirely
      if (next > cap) {
        toast("Solo quedan " + cap + " disponibles");
        return;
      }
      item.qty = next;
      saveList(CART_KEY, cart);
      renderCartDrawer();
      renderBadges();
    }

    // ---------- wishlist drawer (unchanged behavior) ----------

    wishlistDrawer = document.createElement("div");
    wishlistDrawer.className = "hje-drawer";
    wishlistDrawer.innerHTML =
      '<div class="hje-drawer-head"><h2>Tus favoritos</h2><button class="hje-drawer-close" type="button" aria-label="Cerrar favoritos">' +
      ICON_X +
      '</button></div><div class="hje-drawer-body" id="hje-wishlist-body"></div>';
    document.body.appendChild(wishlistDrawer);
    wishlistDrawer.querySelector(".hje-drawer-close").addEventListener("click", function () {
      closeDrawer(wishlistDrawer);
    });

    function renderWishlistDrawer() {
      var body = wishlistDrawer.querySelector("#hje-wishlist-body");
      if (!wishlist.length) {
        body.innerHTML = '<p class="hje-empty">Todavia no guardaste piezas en favoritos.</p>';
        return;
      }
      body.innerHTML = wishlist
        .map(function (p) {
          return (
            '<div class="hje-item"><img src="' +
            p.image +
            '" alt=""/><div class="hje-item-info"><a href="' +
            p.href +
            '">' +
            p.name +
            "</a><p>" +
            p.meta +
            '</p></div><button class="hje-item-remove" type="button" data-slug="' +
            p.slug +
            '" aria-label="Quitar ' +
            p.name +
            ' de favoritos">' +
            ICON_TRASH +
            "</button></div>"
          );
        })
        .join("");
      Array.prototype.forEach.call(body.querySelectorAll(".hje-item-remove"), function (btn) {
        btn.addEventListener("click", function () {
          var i = findItem(wishlist, btn.getAttribute("data-slug"));
          if (i !== -1) {
            wishlist.splice(i, 1);
            saveList(WISHLIST_KEY, wishlist);
            renderBadges();
            renderWishlistDrawer();
            applyHeartStates();
          }
        });
      });
    }

    // ---------- cart mutation ----------

    function addToCart(p) {
      if (!p || !p.slug) return;
      var key = itemKey(p.slug, p.size, p.color);
      var idx = findItemByKey(cart, key);
      var cap = typeof p.stock === "number" ? p.stock : Infinity;
      if (cap <= 0) {
        toast("Agotado");
        return;
      }
      if (idx === -1) {
        cart.push({
          key: key,
          slug: p.slug,
          name: p.name,
          image: p.image,
          href: p.href,
          meta: p.meta || "",
          unitPrice: p.unitPrice,
          priceText: p.priceText,
          size: p.size || null,
          color: p.color || null,
          stock: cap === Infinity ? null : cap,
          qty: 1
        });
      } else {
        if (cart[idx].qty >= cap) {
          toast("Solo quedan " + cap + " disponibles");
          return;
        }
        cart[idx].qty += 1;
      }
      saveList(CART_KEY, cart);
      renderBadges();
      renderCartDrawer();
      var variantSuffix = p.size ? (" (Talla " + p.size + ")") : (p.color ? (" (Color " + p.color + ")") : "");
      toast("Agregado al carrito: " + p.name + variantSuffix);
    }

    function toggleWishlist(product) {
      var i = findItem(wishlist, product.slug);
      if (i === -1) {
        wishlist.push(product);
      } else {
        wishlist.splice(i, 1);
      }
      saveList(WISHLIST_KEY, wishlist);
      renderBadges();
      renderWishlistDrawer();
      applyHeartStates();
    }

    // ---------- simulated checkout ----------

    checkoutOverlay = document.createElement("div");
    checkoutOverlay.id = "hje-checkout-overlay";
    checkoutOverlay.className = "hje-checkout-overlay";
    checkoutOverlay.innerHTML =
      '<div class="hje-checkout-modal" role="dialog" aria-modal="true" aria-label="Finalizar compra">' +
      '<button type="button" class="hje-checkout-close" aria-label="Cerrar">' + ICON_X + "</button>" +
      '<div id="hje-checkout-step-contact" class="hje-checkout-step hje-show">' +
      "<h2>Datos de contacto</h2>" +
      '<p class="hje-checkout-sub">Pago simulado: aun no esta conectado a un proveedor real. Un asesor confirmara tu pedido y el metodo de pago por WhatsApp.</p>' +
      '<div id="hje-checkout-order-summary" class="hje-checkout-order-summary"></div>' +
      '<form id="hje-checkout-form">' +
      '<label>Nombre completo<input type="text" id="hje-co-name" required autocomplete="name"/></label>' +
      '<label>Telefono / WhatsApp<input type="tel" id="hje-co-phone" required placeholder="Ej: 300 123 4567" autocomplete="tel"/></label>' +
      '<label>Ciudad (opcional)<input type="text" id="hje-co-city" autocomplete="address-level2"/></label>' +
      '<label>Direccion (opcional)<input type="text" id="hje-co-address" autocomplete="street-address"/></label>' +
      '<p class="hje-checkout-error" id="hje-checkout-error"></p>' +
      '<button type="submit" class="hje-btn-primary">Continuar al pago simulado</button>' +
      "</form></div>" +
      '<div id="hje-checkout-step-processing" class="hje-checkout-step">' +
      "<h2>Procesando</h2>" +
      '<div class="hje-checkout-sim-step" id="hje-checkout-sim-wompi"><span class="hje-checkout-spinner"></span><span class="hje-checkout-check">' + ICON_CHECK + '</span><span>Procesando pago simulado...</span></div>' +
      '<div class="hje-checkout-sim-step" id="hje-checkout-sim-confirm"><span class="hje-checkout-spinner"></span><span class="hje-checkout-check">' + ICON_CHECK + '</span><span>Confirmando pedido...</span></div>' +
      "</div>" +
      '<div id="hje-checkout-step-done" class="hje-checkout-step hje-checkout-step-done">' +
      '<div class="hje-checkout-success-icon">' + ICON_CHECK + "</div>" +
      "<h2>Pedido registrado</h2>" +
      '<p class="hje-checkout-sub" id="hje-checkout-order-id"></p>' +
      '<div id="hje-checkout-final-summary" class="hje-checkout-order-summary"></div>' +
      '<p class="hje-checkout-disclaimer">Este pago es simulado. Un asesor de Habibi Eisaa confirmara tu pedido, disponibilidad y metodo de pago real por WhatsApp.</p>' +
      '<a class="hje-btn-primary" id="hje-checkout-wa-final" target="_blank" rel="noreferrer">' + ICON_BAG + " Enviar resumen por WhatsApp</a>" +
      '<button type="button" class="hje-btn-secondary" id="hje-checkout-close-done">Cerrar</button>' +
      "</div></div>";
    document.body.appendChild(checkoutOverlay);

    function showCheckoutStep(step) {
      Array.prototype.forEach.call(checkoutOverlay.querySelectorAll(".hje-checkout-step"), function (el) {
        el.classList.remove("hje-show");
      });
      checkoutOverlay.querySelector("#hje-checkout-step-" + step).classList.add("hje-show");
    }

    function openCheckout() {
      if (!cart.length) return;
      var errorEl = checkoutOverlay.querySelector("#hje-checkout-error");
      if (errorEl) errorEl.textContent = "";
      checkoutOverlay.querySelector("#hje-checkout-order-summary").innerHTML = orderSummaryHtml();
      Array.prototype.forEach.call(checkoutOverlay.querySelectorAll(".hje-checkout-sim-step"), function (el) {
        el.classList.remove("hje-done", "hje-active");
      });
      showCheckoutStep("contact");
      closeDrawer(cartDrawer);
      closeDrawer(wishlistDrawer);
      checkoutOverlay.classList.add("open");
    }
    function closeCheckout() {
      checkoutOverlay.classList.remove("open");
    }

    checkoutOverlay.querySelector(".hje-checkout-close").addEventListener("click", closeCheckout);
    checkoutOverlay.querySelector("#hje-checkout-close-done").addEventListener("click", closeCheckout);
    checkoutOverlay.addEventListener("click", function (e) {
      if (e.target === checkoutOverlay) closeCheckout();
    });

    checkoutOverlay.querySelector("#hje-checkout-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = checkoutOverlay.querySelector("#hje-co-name").value.trim();
      var phone = checkoutOverlay.querySelector("#hje-co-phone").value.trim();
      var errorEl = checkoutOverlay.querySelector("#hje-checkout-error");
      var digits = phone.replace(/\D/g, "");
      if (!name) {
        errorEl.textContent = "Ingresa tu nombre.";
        return;
      }
      if (digits.length < 7) {
        errorEl.textContent = "Ingresa un telefono valido.";
        return;
      }
      errorEl.textContent = "";
      pendingContact = {
        name: name,
        phone: phone,
        city: checkoutOverlay.querySelector("#hje-co-city").value.trim(),
        address: checkoutOverlay.querySelector("#hje-co-address").value.trim()
      };
      runCheckoutSimulation();
    });

    function runCheckoutSimulation() {
      showCheckoutStep("processing");
      checkoutOverlay.classList.add("hje-processing");
      var wompiStep = checkoutOverlay.querySelector("#hje-checkout-sim-wompi");
      var confirmStep = checkoutOverlay.querySelector("#hje-checkout-sim-confirm");
      wompiStep.classList.add("hje-active");
      setTimeout(function () {
        wompiStep.classList.add("hje-done");
        confirmStep.classList.add("hje-active");
        setTimeout(function () {
          confirmStep.classList.add("hje-done");
          checkoutOverlay.classList.remove("hje-processing");
          finalizeOrder();
        }, 1000);
      }, 1100);
    }

    function saveOrder(order) {
      var orders = loadList(ORDERS_KEY);
      orders.unshift(order);
      if (orders.length > 20) orders = orders.slice(0, 20);
      saveList(ORDERS_KEY, orders);
    }

    function finalizeOrder() {
      var orderId = "HE-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      var totals = cartTotals();
      var order = {
        id: orderId,
        timestamp: new Date().toISOString(),
        contact: pendingContact,
        items: cart.map(function (item) {
          return { slug: item.slug, name: item.name, size: item.size, color: item.color, qty: item.qty, unitPrice: item.unitPrice };
        }),
        total: totals.known,
        hasUnknownPricing: totals.hasUnknown,
        simulated: true
      };
      saveOrder(order);

      checkoutOverlay.querySelector("#hje-checkout-order-id").textContent = "Pedido " + orderId;
      checkoutOverlay.querySelector("#hje-checkout-final-summary").innerHTML = orderRowsHtml() +
        '<div class="hje-checkout-order-row hje-checkout-order-total"><span>Total</span><strong>' +
        formatPrice(totals.known) + (totals.hasUnknown ? " +" : "") + "</strong></div>";

      var lines = cart.map(function (item) {
        var variantLine = item.size ? (" (Talla " + item.size + ")") : (item.color ? (" (Color " + item.color + ")") : "");
        return "- " + item.qty + "x " + item.name + variantLine;
      });
      var text =
        "Hola, confirmo mi pedido " + orderId + ":\n" + lines.join("\n") +
        "\nTotal estimado: " + formatPrice(totals.known) + (totals.hasUnknown ? " (mas productos a confirmar precio)" : "") +
        "\nNombre: " + pendingContact.name +
        "\nTelefono: " + pendingContact.phone +
        (pendingContact.city ? "\nCiudad: " + pendingContact.city : "") +
        (pendingContact.address ? "\nDireccion: " + pendingContact.address : "");
      checkoutOverlay.querySelector("#hje-checkout-wa-final").setAttribute(
        "href",
        "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text)
      );

      cart = [];
      saveList(CART_KEY, cart);
      renderBadges();
      renderCartDrawer();

      showCheckoutStep("done");
    }

    // ---------- badges / hearts / scanning ----------

    function renderBadges() {
      var cartCount = cart.reduce(function (sum, item) { return sum + (Number(item.qty) || 1); }, 0);
      Array.prototype.forEach.call(
        document.querySelectorAll('[aria-label="Carrito"]'),
        function (btn) { setBadge(btn, cartCount); }
      );
      Array.prototype.forEach.call(
        document.querySelectorAll('[aria-label="Favoritos"]'),
        function (btn) { setBadge(btn, wishlist.length); }
      );
    }
    function setBadge(btn, count) {
      if (getComputedStyle(btn).position === "static") {
        btn.style.position = "relative";
      }
      var badge = btn.querySelector(".hje-badge");
      if (!count) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "hje-badge";
        btn.appendChild(badge);
      }
      var text = count > 9 ? "9+" : String(count);
      // Guard against a no-op write: textContent always replaces the text
      // node even when the value is unchanged, which the MutationObserver
      // below would see as a fresh mutation and re-scan forever.
      if (badge.textContent !== text) {
        badge.textContent = text;
        badge.classList.remove("hje-pulse");
        // eslint-disable-next-line no-unused-expressions
        void badge.offsetWidth; // restart the CSS animation
        badge.classList.add("hje-pulse");
      }
    }

    function applyHeartStates() {
      Array.prototype.forEach.call(
        document.querySelectorAll('button[aria-label^="Guardar "]'),
        function (btn) {
          var article = btn.closest("article");
          if (!article) return;
          var product = productFromCard(article);
          var saved = findItem(wishlist, product.slug) !== -1;
          var svg = btn.querySelector("svg");
          if (svg) svg.setAttribute("fill", saved ? "currentColor" : "none");
          btn.style.color = saved ? "#7a1c28" : "";
          // only replay the pop animation on an actual state change, not on
          // every scan() re-run
          var wasSaved = btn.classList.contains("hje-fav-active");
          if (saved && !wasSaved) {
            btn.classList.add("hje-fav-active");
          } else if (!saved && wasSaved) {
            btn.classList.remove("hje-fav-active");
          }
        }
      );
    }

    function injectCardCartButtons() {
      Array.prototype.forEach.call(document.querySelectorAll("article"), function (article) {
        var actionRow = article.querySelector(".flex.items-center.gap-1");
        if (!actionRow || actionRow.querySelector(".hje-card-cart-btn")) return;
        var product = productFromCard(article);
        if (!product.slug) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hje-card-cart-btn";
        btn.setAttribute("aria-label", "Agregar " + product.name + " al carrito");
        btn.innerHTML = ICON_BAG;
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (product.requiresVariant) {
            toast("Elige talla o color en la pagina del producto");
            return;
          }
          if (!product.available || product.stock === 0) {
            toast("Agotado");
            return;
          }
          addToCart(product);
          btn.classList.add("added");
        });
        actionRow.insertBefore(btn, actionRow.firstChild);
        if (findItem(cart, product.slug) !== -1) btn.classList.add("added");
      });
    }

    function injectDetailCartButton() {
      if (!/\/producto\//.test(window.location.pathname)) return;
      var ctaLink = document.querySelector("main a[href^='https://wa.me/']");
      if (!ctaLink) return;
      var grid = ctaLink.parentElement;
      if (!grid || grid.querySelector(".hje-detail-cart-btn")) return;
      var initialSlug = window.location.pathname.replace(/\/$/, "").split("/producto/").pop();
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hje-detail-cart-btn";
      if (findItem(cart, initialSlug) !== -1) btn.classList.add("added");
      btn.innerHTML = ICON_BAG + " Agregar al carrito";
      btn.addEventListener("click", function () {
        var product = productFromDetailPage(); // re-read fresh so a live variant selection is captured
        if (!product.slug) return;
        if (product.requiresSize && !product.size) {
          toast("Selecciona una talla");
          return;
        }
        if (product.requiresColor && !product.color) {
          toast("Selecciona un color");
          return;
        }
        if (product.stock === 0) {
          toast("Agotado");
          return;
        }
        addToCart(product);
        btn.classList.add("added");
      });
      grid.appendChild(btn);
    }

    document.addEventListener("click", function (e) {
      var cartBtn = e.target.closest('[aria-label="Carrito"]');
      if (cartBtn) {
        e.preventDefault();
        openDrawer(cartDrawer);
        return;
      }
      var wishBtn = e.target.closest('[aria-label="Favoritos"]');
      if (wishBtn) {
        e.preventDefault();
        openDrawer(wishlistDrawer);
        return;
      }
      var heartBtn = e.target.closest('button[aria-label^="Guardar "]');
      if (heartBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        var article = heartBtn.closest("article");
        if (article) {
          var product = productFromCard(article);
          if (product.slug) toggleWishlist(product);
        }
      }
    }, true); // capture phase: must run before Next.js's own Link click handler
    // (attached closer to the target), otherwise its router navigation already
    // fires before our later bubble-phase preventDefault would take effect.

    function scan() {
      injectCardCartButtons();
      injectDetailCartButton();
      applyHeartStates();
      renderBadges();
    }

    renderCartDrawer();
    renderWishlistDrawer();
    scan();

    var observer = new MutationObserver(function () {
      scan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    loadCatalog().then(setupUI).catch(setupUI);
  }

  function deferredInit() {
    setTimeout(init, 400);
  }

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
