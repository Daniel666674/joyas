(function () {
  "use strict";

  // Homepage-only. Adds the two pieces of the v5 banner hero that need real
  // DOM rather than CSS: the rating line inside the hero copy block, and the
  // four-item guarantee strip directly under the hero section.
  //
  // Same safety model as store.js / premium.js / nav-funnel.js — bucket 2 in
  // CLAUDE.md. Nothing runs until well after window.load, and every operation
  // is purely additive: elements are appended or inserted as new siblings,
  // never moved, reparented or removed. React only re-renders on its own
  // state changes after hydration, so appended nodes persist.
  //
  // Both insertions are guarded by an id check so a double-load (or a React
  // re-render that somehow re-ran this) can't duplicate them.

  var HOME_PATHS = ["/joyas/", "/joyas", "/joyas/index.html"];

  function isHomepage() {
    var p = window.location.pathname;
    return HOME_PATHS.indexOf(p) !== -1 || /\/index\.html$/.test(p);
  }

  // Inline SVGs rather than an icon font: no extra request, no FOUT, and the
  // stroke colour inherits from .hje-trust-ico.
  var ICONS = {
    gem:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 3h12l4 6-10 12L2 9Z"/><path d="M11 3 8 9l4 12 4-12-3-6"/><path d="M2 9h20"/></svg>',
    chat:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
    truck:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>' +
      '<path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    camera:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4Z"/>' +
      '<circle cx="12" cy="13" r="3.5"/></svg>'
  };

  var ITEMS = [
    ["gem", "Oro 18K y laminado", "Material declarado en cada pieza"],
    ["chat", "Asesoria por WhatsApp", "Te respondemos el mismo dia"],
    ["truck", "Envios a toda Colombia", "Coordinamos despacho y seguimiento"],
    ["camera", "Fotos reales", "Cada pieza fotografiada por nosotros"]
  ];

  function heroSection() {
    return document.querySelector("section.relative.overflow-hidden");
  }

  function addRating(hero) {
    if (document.getElementById("hje-hero-rating")) return;
    var copy = hero.querySelector("div.max-w-2xl");
    if (!copy) return;
    var row = document.createElement("div");
    row.id = "hje-hero-rating";
    row.className = "hje-hero-rating";
    var stars = document.createElement("span");
    stars.className = "hje-stars";
    stars.setAttribute("aria-hidden", "true");
    stars.textContent = "★★★★★";
    var txt = document.createElement("span");
    var b = document.createElement("b");
    b.textContent = "4.9/5";
    txt.appendChild(b);
    txt.appendChild(document.createTextNode(" · clientas atendidas por WhatsApp e Instagram"));
    row.appendChild(stars);
    row.appendChild(txt);
    copy.appendChild(row); // append only — never reorder what React owns
  }

  function addTrustBar(hero) {
    if (document.getElementById("hje-trustbar")) return;
    var main = hero.parentElement;
    if (!main) return;

    var bar = document.createElement("div");
    bar.id = "hje-trustbar";
    bar.className = "hje-trustbar";

    var inner = document.createElement("div");
    inner.className = "hje-trustbar-inner";

    ITEMS.forEach(function (it) {
      var cell = document.createElement("div");
      cell.className = "hje-trust-item";

      var ico = document.createElement("span");
      ico.className = "hje-trust-ico";
      ico.setAttribute("aria-hidden", "true");
      ico.innerHTML = ICONS[it[0]];

      var txt = document.createElement("div");
      var t = document.createElement("div");
      t.className = "hje-trust-t";
      t.textContent = it[1];
      var s = document.createElement("div");
      s.className = "hje-trust-s";
      s.textContent = it[2];
      txt.appendChild(t);
      txt.appendChild(s);

      cell.appendChild(ico);
      cell.appendChild(txt);
      inner.appendChild(cell);
    });

    bar.appendChild(inner);
    // insert as a new sibling right after the hero; nothing existing moves
    if (hero.nextSibling) {
      main.insertBefore(bar, hero.nextSibling);
    } else {
      main.appendChild(bar);
    }
  }

  function init() {
    var hero = heroSection();
    if (!hero) return;
    addRating(hero);
    addTrustBar(hero);
  }

  function deferredInit() {
    setTimeout(function () {
      init();
      // One late re-check: if a slow React commit landed after our insert and
      // removed either node, put it back. Cheap, runs once, no observer.
      setTimeout(init, 1200);
    }, 450);
  }

  if (!isHomepage()) return;

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
