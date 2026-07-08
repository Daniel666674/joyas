(function () {
  "use strict";

  // Site-wide: turns the plain "Tienda" / "Materiales" nav links into
  // hover/focus dropdown shortcuts, and adds a persistent gold WhatsApp CTA
  // to the header. Same safety model as store.js/hero-video.js - this can't
  // be done by editing the static header HTML directly (verified: Next.js
  // hydration diffs the header against its own client-rendered version and
  // reverts any structural change within ~200ms, so an edited nav flashes
  // and disappears for real visitors). Instead this only appends brand new
  // elements after window.load and reads (never reparents) the existing
  // hydrated nav links, so it can't be undone by a later React re-render.

  var CATEGORY_LINKS = [
    ["Cadenas", "/joyas/cadenas"],
    ["Pulseras", "/joyas/pulseras"],
    ["Anillos", "/joyas/anillos"],
    ["Argollas", "/joyas/argollas"],
    ["Aretes", "/joyas/aretes"],
    ["Collares", "/joyas/collares"]
  ];
  var CATEGORY_ALL = ["Ver todo el catalogo →", "/joyas/shop"];

  var MATERIAL_LINKS = [
    ["Oro Laminado", "/joyas/oro-laminado"],
    ["Oro 18K", "/joyas/oro-18k"],
    ["Oro 14K", "/joyas/oro-14k"],
    ["Oro 10K", "/joyas/oro-10k"],
    ["Plata 925", "/joyas/plata-925"]
  ];
  var MATERIAL_ALL = ["Guia completa →", "/joyas/materials"];

  var CTA_HREF =
    "https://wa.me/573001234567?text=" +
    encodeURIComponent("Hola, quiero ver el catalogo de Habibi Eisaa");

  var CLOSE_DELAY = 220;
  var openPanel = null;
  var closeTimer = null;

  function buildPanel(links, allLink) {
    var panel = document.createElement("div");
    panel.className = "hje-nav-drop-panel";
    links.forEach(function (pair) {
      var a = document.createElement("a");
      a.href = pair[1];
      a.textContent = pair[0];
      panel.appendChild(a);
    });
    var all = document.createElement("a");
    all.className = "hje-nav-drop-all";
    all.href = allLink[1];
    all.textContent = allLink[0];
    panel.appendChild(all);
    document.body.appendChild(panel);
    return panel;
  }

  function positionPanel(panel, trigger) {
    var r = trigger.getBoundingClientRect();
    panel.style.top = r.bottom + "px";
    panel.style.left = r.left + r.width / 2 + "px";
  }

  function openDropdown(trigger, panel) {
    clearTimeout(closeTimer);
    if (openPanel && openPanel !== panel) closeDropdown(openPanel.trigger);
    positionPanel(panel, trigger);
    panel.classList.add("hje-nav-drop-open");
    trigger.classList.add("hje-nav-drop-open");
    trigger.setAttribute("aria-expanded", "true");
    panel.trigger = trigger;
    openPanel = panel;
  }

  function closeDropdown(trigger) {
    if (!openPanel) return;
    openPanel.classList.remove("hje-nav-drop-open");
    trigger.classList.remove("hje-nav-drop-open");
    trigger.setAttribute("aria-expanded", "false");
    openPanel = null;
  }

  function scheduleClose(trigger) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      closeDropdown(trigger);
    }, CLOSE_DELAY);
  }

  function attachDropdown(trigger, links, allLink) {
    if (!trigger) return;
    trigger.classList.add("hje-nav-drop-trigger");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");

    var panel = buildPanel(links, allLink);

    trigger.addEventListener("mouseenter", function () {
      openDropdown(trigger, panel);
    });
    trigger.addEventListener("focus", function () {
      openDropdown(trigger, panel);
    });
    trigger.addEventListener("mouseleave", function () {
      scheduleClose(trigger);
    });
    trigger.addEventListener("blur", function () {
      scheduleClose(trigger);
    });
    panel.addEventListener("mouseenter", function () {
      clearTimeout(closeTimer);
    });
    panel.addEventListener("mouseleave", function () {
      scheduleClose(trigger);
    });
    panel.addEventListener("focusout", function () {
      scheduleClose(trigger);
    });
  }

  function addHeaderCta() {
    var iconCluster = document.querySelector(
      "header .flex.items-center.gap-1"
    );
    if (!iconCluster || document.querySelector(".hje-nav-cta")) return;

    var cta = document.createElement("a");
    cta.href = CTA_HREF;
    cta.className = "hje-nav-cta";
    cta.setAttribute("aria-label", "Comprar por WhatsApp");
    cta.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-4 w-4"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg>' +
      '<span class="hje-nav-cta-label">Comprar</span>';
    iconCluster.appendChild(cta);
  }

  function init() {
    var nav = document.querySelector("header nav.hidden.lg\\:flex");
    if (nav) {
      var shopLink = nav.querySelector('a[href="/joyas/shop"]');
      attachDropdown(shopLink, CATEGORY_LINKS, CATEGORY_ALL);

      var materialsLink = nav.querySelector('a[href="/joyas/materials"]');
      attachDropdown(materialsLink, MATERIAL_LINKS, MATERIAL_ALL);

      window.addEventListener(
        "scroll",
        function () {
          if (openPanel && openPanel.trigger) closeDropdown(openPanel.trigger);
        },
        { passive: true }
      );
      window.addEventListener("resize", function () {
        if (openPanel && openPanel.trigger) closeDropdown(openPanel.trigger);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && openPanel && openPanel.trigger) {
          closeDropdown(openPanel.trigger);
        }
      });
    }

    addHeaderCta();
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
