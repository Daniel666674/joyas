(function () {
  "use strict";

  // Applies HJE_SITE_TEXT overrides and HJE_SECTION_VIDEOS overlays on the
  // homepage. Same safety model as store.js / hero-video.js: additive only,
  // nothing runs until well after window.load, degrades silently.

  if (
    !/\/(index\.html)?$/.test(window.location.pathname) &&
    window.location.pathname !== "/joyas/" &&
    window.location.pathname !== "/joyas"
  ) {
    return;
  }

  var SECTION_HREFS = ["cadenas", "pulseras", "anillos", "argollas", "aretes", "collares", "dijes"];

  var POS_TO_OBJECT = {
    tl: "0% 0%", tc: "50% 0%", tr: "100% 0%",
    cl: "0% 50%", cc: "50% 50%", cr: "100% 50%",
    bl: "0% 100%", bc: "50% 100%", br: "100% 100%"
  };

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function isDataSaver() {
    var c = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
    return !!(c && (c.saveData || /^(slow-2g|2g)$/.test(c.effectiveType || "")));
  }

  // ---------- site text ----------

  function applyText(texts) {
    if (!texts || typeof texts !== "object") return;

    // Hero headline
    if (texts.heroHeadline) {
      var hero = document.querySelector("section.relative.overflow-hidden");
      var h1 = hero ? hero.querySelector("h1") : document.querySelector("main h1.font-serif");
      if (!h1) h1 = document.querySelector("h1");
      if (h1 && h1.textContent !== texts.heroHeadline) h1.textContent = texts.heroHeadline;
    }

    // Hero subheadline
    if (texts.heroSubheadline) {
      var heroSec = document.querySelector("section.relative.overflow-hidden");
      var sub = heroSec ? heroSec.querySelector("p.mt-4") : null;
      if (sub && sub.textContent !== texts.heroSubheadline) sub.textContent = texts.heroSubheadline;
    }

    // Hero CTA button (first shop link in hero section)
    if (texts.heroCta) {
      var heroSec2 = document.querySelector("section.relative.overflow-hidden");
      var cta = heroSec2 ? heroSec2.querySelector('a[href="/joyas/shop"]') : null;
      if (cta && cta.textContent.trim() !== texts.heroCta) cta.textContent = texts.heroCta;
    }

    // Section h2 titles — matched by their default text so overrides survive
    // any reorder of sections. Guard with textContent equality to avoid
    // triggering a MutationObserver loop if this runs more than once.
    var DEFAULTS = {
      sec_categories: "Compra por tipo de pieza",
      sec_featured: "Favoritas para consultar hoy",
      sec_why: "Compras acompanadas de principio a fin",
      sec_testimonials: "La vitrina vive en redes",
      sec_faq: "Antes de comprar"
    };
    document.querySelectorAll("h2.font-serif").forEach(function (h2) {
      var raw = h2.textContent.trim();
      Object.keys(DEFAULTS).forEach(function (key) {
        if (!texts[key]) return;
        if (raw === DEFAULTS[key] || raw === texts[key]) {
          if (h2.textContent !== texts[key]) h2.textContent = texts[key];
        }
      });
    });
  }

  // ---------- section videos ----------

  function applySectionVideos(sectionVideos) {
    if (!sectionVideos || typeof sectionVideos !== "object") return;
    if (prefersReducedMotion() || isDataSaver()) return;

    SECTION_HREFS.forEach(function (cat) {
      var sv = sectionVideos[cat];
      if (!sv || !sv.video) return;

      var link = document.querySelector('a[href="/joyas/' + cat + '"]');
      if (!link) return;
      var slot = link.querySelector(".relative.overflow-hidden");
      if (!slot || slot.querySelector("video")) return;

      var vid = document.createElement("video");
      vid.src = sv.video;
      vid.className = "hje-section-video";
      vid.muted = true;
      vid.defaultMuted = true;
      vid.setAttribute("muted", "");
      vid.setAttribute("playsinline", "");
      vid.setAttribute("webkit-playsinline", "");
      vid.loop = true;
      vid.preload = "none";
      vid.disablePictureInPicture = true;
      vid.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.4s ease;pointer-events:none";

      if (sv.rotation === 90 || sv.rotation === 270) {
        vid.style.transform = "rotate(" + sv.rotation + "deg)";
        vid.style.transformOrigin = "50% 50%";
        vid.style.width = slot.offsetHeight + "px";
        vid.style.height = slot.offsetWidth + "px";
        vid.style.top = ((slot.offsetHeight - slot.offsetWidth) / 2) + "px";
        vid.style.left = ((slot.offsetWidth - slot.offsetHeight) / 2) + "px";
        vid.style.inset = "unset";
      } else if (sv.rotation === 180) {
        vid.style.transform = "rotate(180deg)";
      }

      slot.appendChild(vid);

      vid.play().then(function () {
        vid.style.opacity = "1";
      }).catch(function () {
        vid.remove();
      });
    });
  }

  function injectStyles() {
    if (document.getElementById("hje-hm-style")) return;
    var s = document.createElement("style");
    s.id = "hje-hm-style";
    s.textContent = ".hje-section-video{z-index:1}";
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    applyText(window.HJE_SITE_TEXT);
    applySectionVideos(window.HJE_SECTION_VIDEOS);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        document.querySelectorAll(".hje-section-video").forEach(function (v) { v.pause(); });
      } else {
        document.querySelectorAll(".hje-section-video").forEach(function (v) {
          v.play().catch(function () {});
        });
      }
    });
  }

  function deferredInit() {
    setTimeout(init, 600);
  }

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
