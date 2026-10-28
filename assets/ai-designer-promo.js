(function () {
  "use strict";

  // Homepage-only entry point to the AI designer demo (disenador-ia.html).
  //
  // Bucket 2 in CLAUDE.md, same safety model as trust-bar.js: nothing runs
  // until well after window.load, and the only operation is inserting ONE new
  // sibling element; nothing React owns is moved, reparented or removed.
  //
  // It is a <div>, deliberately NOT a <section>: premium.css numbers the
  // homepage sections ("01", "02"...) with `main > section { counter-increment }`,
  // so an extra <section> would silently renumber every eyebrow below it.
  //
  // Its CSS lives inside the element it creates (a <style> as its first child)
  // so it touches neither premium.css nor <head>, and can't outlive the node.
  //
  // ZERO CREDITS: this file makes no network request except the one same-site
  // image below. The page it links to runs a built-in simulation as long as
  // assets/ai-designer-config.js has an empty apiBase.

  var HOME_PATHS = ["/joyas/", "/joyas", "/joyas/index.html"];
  var TARGET = "/joyas/disenador-ia.html";
  var IMG = "/joyas/brand/ai-designer-pendant.webp?v=20261028";

  function isHomepage() {
    var p = window.location.pathname;
    return HOME_PATHS.indexOf(p) !== -1 || /\/index\.html$/.test(p);
  }

  var CSS =
    ".hje-aipromo{padding:28px 16px 4px}" +
    "@media(min-width:640px){.hje-aipromo{padding:36px 24px 4px}}" +
    ".hje-aipromo-card{position:relative;display:grid;grid-template-columns:1fr;gap:8px;align-items:center;max-width:1180px;margin:0 auto;padding:24px 22px 26px;border-radius:22px;overflow:hidden;color:#fbf3e6;" +
    "background:radial-gradient(70% 120% at 82% 50%,rgba(223,185,104,.3),transparent 62%),linear-gradient(135deg,#4a1017 0%,#7a1c28 58%,#5d1520 100%);" +
    "box-shadow:0 24px 48px -18px rgba(74,16,23,.55),inset 0 0 0 1px rgba(223,185,104,.38)}" +
    "@media(min-width:860px){.hje-aipromo-card{grid-template-columns:1.15fr .85fr;gap:24px;padding:40px 56px}}" +
    ".hje-aipromo-media{display:flex;justify-content:center;order:-1}" +
    "@media(min-width:860px){.hje-aipromo-media{order:0}}" +
    ".hje-aipromo-img{display:block;width:min(60%,210px);height:auto}" +
    "@media(min-width:860px){.hje-aipromo-img{width:min(100%,400px);margin:-18px 0}}" +
    ".hje-aipromo-eyebrow{display:inline-block;margin:0 0 12px;padding:6px 12px;border:1px solid rgba(223,185,104,.55);border-radius:999px;font-size:.7rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#f0dfae}" +
    ".hje-aipromo-title{margin:0 0 10px;font-family:var(--font-serif,'Cormorant Garamond',Georgia,serif);font-size:clamp(1.9rem,4.2vw,2.9rem);font-weight:500;line-height:1.08;letter-spacing:-.01em;color:#fff7ee;text-wrap:balance}" +
    ".hje-aipromo-text{margin:0 0 20px;max-width:46ch;font-size:1rem;line-height:1.65;color:rgba(251,243,230,.88);text-wrap:pretty}" +
    ".hje-aipromo-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px}" +
    ".hje-aipromo-btn{display:inline-flex;align-items:center;gap:8px;min-height:50px;padding:0 24px;border-radius:12px;background:linear-gradient(135deg,#f7e6b0,#dfb968 40%,#a8782a);color:#2a1b06;font-size:.98rem;font-weight:700;text-decoration:none;box-shadow:0 10px 24px -8px rgba(0,0,0,.5);transition:transform .15s,filter .15s}" +
    ".hje-aipromo-btn:hover{transform:translateY(-1px);filter:brightness(1.05);color:#2a1b06}" +
    ".hje-aipromo-btn:focus-visible{outline:3px solid #f7e6b0;outline-offset:3px}" +
    ".hje-aipromo-note{font-size:.78rem;color:rgba(251,243,230,.72)}" +
    "@media(prefers-reduced-motion:reduce){.hje-aipromo-btn{transition:none}}";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    var wrap = el("div", "hje-aipromo");
    wrap.id = "hje-aipromo";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Diseñador de joyas con IA");

    var style = document.createElement("style");
    style.textContent = CSS;
    wrap.appendChild(style);

    var card = el("div", "hje-aipromo-card");

    var copy = el("div", "hje-aipromo-copy");
    copy.appendChild(el("p", "hje-aipromo-eyebrow", "Nuevo · Demostración"));
    copy.appendChild(el("h2", "hje-aipromo-title", "Diseña tu dije con inteligencia artificial"));
    copy.appendChild(
      el(
        "p",
        "hje-aipromo-text",
        "Sube una foto de tu mascota, elige el material y mira en 3D cómo podría verse tu pieza personalizada."
      )
    );

    var actions = el("div", "hje-aipromo-actions");
    var link = el("a", "hje-aipromo-btn", "Probar el diseñador →");
    link.href = TARGET;
    actions.appendChild(link);
    actions.appendChild(el("span", "hje-aipromo-note", "Demostración con resultados de ejemplo"));
    copy.appendChild(actions);

    var media = el("div", "hje-aipromo-media");
    var img = document.createElement("img");
    img.className = "hje-aipromo-img";
    img.src = IMG;
    img.width = 640;
    img.height = 640;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "Dije de huella de mascota en oro, vista previa 3D de ejemplo";
    media.appendChild(img);

    card.appendChild(copy);
    card.appendChild(media);
    wrap.appendChild(card);
    return wrap;
  }

  function insert() {
    if (document.getElementById("hje-aipromo")) return;
    var hero = document.querySelector("section.relative.overflow-hidden");
    if (!hero) return;
    var main = hero.parentElement;
    if (!main) return;

    // Right under the guarantee strip when it exists (trust-bar.js inserts it
    // as the hero's next sibling, so whichever script runs first, the order
    // ends up hero, strip, this band).
    var anchor = document.getElementById("hje-trustbar") || hero;
    var node = build();
    if (anchor.nextSibling) {
      main.insertBefore(node, anchor.nextSibling);
    } else {
      main.appendChild(node);
    }
  }

  function deferredInit() {
    setTimeout(function () {
      insert();
      // One late re-check, same as trust-bar.js: if a slow React commit removed
      // the node, put it back. Cheap, runs once, no observer.
      setTimeout(insert, 1400);
    }, 650);
  }

  if (!isHomepage()) return;

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
