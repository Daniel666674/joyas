(function () {
  "use strict";

  var WHATSAPP_NUMBER = "573001234567";
  var CART_KEY = "hje_cart";
  var WISHLIST_KEY = "hje_wishlist";

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

  var cart = loadList(CART_KEY);
  var wishlist = loadList(WISHLIST_KEY);

  function findItem(list, slug) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === slug) return i;
    }
    return -1;
  }

  // ---------- product extraction (pure, no DOM writes) ----------
  function productFromCard(article) {
    var nameLink = article.querySelector(".mt-4 a[href*='/producto/']");
    var mainLink = article.querySelector("a[href*='/producto/']");
    var img = article.querySelector("img");
    var meta = article.querySelector(".mt-4 p");
    var link = nameLink || mainLink;
    var href = link ? link.getAttribute("href") : "";
    var slug = href ? href.replace(/\/$/, "").split("/producto/").pop() : "";
    return {
      slug: slug,
      name: nameLink ? nameLink.textContent.trim() : "",
      image: img ? img.getAttribute("src") : "",
      meta: meta ? meta.textContent.trim() : "",
      href: href
    };
  }

  function productFromDetailPage() {
    var h1 = document.querySelector("main h1");
    var img = document.querySelector("main img");
    // scoped to the category/material/availability pill row specifically -
    // a plain ".flex.flex-wrap.gap-2 span" also matches the breadcrumb <ol>
    // (same classes) and picks up its "/" separator instead
    var badge = document.querySelector("main span.rounded-full.border-border.bg-background");
    var slug = window.location.pathname.replace(/\/$/, "").split("/producto/").pop();
    return {
      slug: slug,
      name: h1 ? h1.textContent.trim() : document.title,
      image: img ? img.getAttribute("src") : "",
      meta: badge ? badge.textContent.trim() : "",
      href: window.location.pathname
    };
  }

  // ---------- icons ----------
  var ICON_BAG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>';
  var ICON_X =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  var ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

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
    ".hje-item-remove{background:none;border:0;cursor:pointer;color:#a8443a;padding:6px;align-self:flex-start;border-radius:6px}",
    ".hje-item-remove:hover{background:#f3e2df}",
    ".hje-drawer-foot{padding:16px 20px;border-top:1px solid #e6ddcd}",
    ".hje-btn-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border-radius:8px;border:0;cursor:pointer;background:#1a1a1a;color:#fff;font-weight:600;font-size:.9rem;text-decoration:none}",
    ".hje-btn-primary:hover{opacity:.9}",
    ".hje-btn-primary[disabled]{opacity:.4;pointer-events:none}",
    ".hje-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:#a8443a;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:700;pointer-events:none}",
    ".hje-card-cart-btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:6px;border:0;background:transparent;color:inherit;cursor:pointer}",
    ".hje-card-cart-btn:hover{background:rgba(0,0,0,.06)}",
    ".hje-card-cart-btn.added,.hje-detail-cart-btn.added{color:#2f6d3c}",
    ".hje-detail-cart-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid #d8cdb8;background:#fff;height:48px;padding:0 24px;font-weight:600;font-size:.9rem;cursor:pointer;grid-column:1/-1}",
    ".hje-detail-cart-btn:hover{background:#f5efe2}",
    ".hje-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,10px);background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:999px;font-size:.85rem;z-index:10000;opacity:0;transition:opacity .2s ease,transform .2s ease;pointer-events:none}",
    ".hje-toast.show{opacity:1;transform:translate(-50%,0)}"
  ].join("\n");

  // Everything below touches the live DOM. It must not run until the page's
  // own hydration has settled: Next.js hydrates via async chunks with no
  // fixed order relative to this (deferred) script, so mutating hydrated
  // markup (header, product cards) too early races React and can trigger a
  // hydration-mismatch error. Waiting for `load` sidesteps the race, and the
  // MutationObserver started at the end keeps everything self-healing if a
  // later client-side re-render replaces content we've already touched.
  function init() {
    var toastEl, backdrop, cartDrawer, wishlistDrawer, toastTimer;

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

    cartDrawer = document.createElement("div");
    cartDrawer.className = "hje-drawer";
    cartDrawer.innerHTML =
      '<div class="hje-drawer-head"><h2>Tu carrito</h2><button class="hje-drawer-close" type="button" aria-label="Cerrar carrito">' +
      ICON_X +
      '</button></div><div class="hje-drawer-body" id="hje-cart-body"></div><div class="hje-drawer-foot"><a class="hje-btn-primary" id="hje-cart-checkout" target="_blank" rel="noreferrer">' +
      ICON_BAG +
      " Enviar pedido por WhatsApp</a></div>";
    document.body.appendChild(cartDrawer);
    cartDrawer.querySelector(".hje-drawer-close").addEventListener("click", function () {
      closeDrawer(cartDrawer);
    });

    function renderCartDrawer() {
      var body = cartDrawer.querySelector("#hje-cart-body");
      var checkout = cartDrawer.querySelector("#hje-cart-checkout");
      if (!cart.length) {
        body.innerHTML = '<p class="hje-empty">Todavia no agregaste piezas al carrito.</p>';
        checkout.setAttribute("disabled", "disabled");
        checkout.removeAttribute("href");
        return;
      }
      checkout.removeAttribute("disabled");
      body.innerHTML = cart
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
            ' del carrito">' +
            ICON_TRASH +
            "</button></div>"
          );
        })
        .join("");
      Array.prototype.forEach.call(body.querySelectorAll(".hje-item-remove"), function (btn) {
        btn.addEventListener("click", function () {
          var i = findItem(cart, btn.getAttribute("data-slug"));
          if (i !== -1) {
            cart.splice(i, 1);
            saveList(CART_KEY, cart);
            renderBadges();
            renderCartDrawer();
          }
        });
      });
      var lines = cart.map(function (p) {
        return "- " + p.name;
      });
      var text = "Hola, quiero consultar disponibilidad de:\n" + lines.join("\n");
      checkout.setAttribute(
        "href",
        "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text)
      );
    }

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

    function addToCart(product) {
      if (findItem(cart, product.slug) === -1) {
        cart.push(product);
        saveList(CART_KEY, cart);
      }
      renderBadges();
      renderCartDrawer();
      toast("Agregado al carrito: " + product.name);
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

    function renderBadges() {
      Array.prototype.forEach.call(
        document.querySelectorAll('[aria-label="Carrito"]'),
        function (btn) {
          setBadge(btn, cart.length);
        }
      );
      Array.prototype.forEach.call(
        document.querySelectorAll('[aria-label="Favoritos"]'),
        function (btn) {
          setBadge(btn, wishlist.length);
        }
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
          btn.style.color = saved ? "#a8443a" : "";
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
      var product = productFromDetailPage();
      if (!product.slug) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hje-detail-cart-btn";
      if (findItem(cart, product.slug) !== -1) btn.classList.add("added");
      btn.innerHTML = ICON_BAG + " Agregar al carrito";
      btn.addEventListener("click", function () {
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

  function deferredInit() {
    setTimeout(init, 400);
  }

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
