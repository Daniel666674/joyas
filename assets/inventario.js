(function () {
  "use strict";

  // Internal inventory tool. Standalone page, no Next.js/React involved,
  // so none of the hydration caveats in CLAUDE.md apply here - this script
  // can freely build/rebuild the DOM.

  var WHATSAPP_NUMBER = "573136662777";
  // NOTE: this passcode is a casual deterrent, not real security - it ships
  // in this file's plain text, same as anything else on a static site with
  // no backend. It only keeps out people who don't know to look, not a
  // determined visitor. Fine for gating a low-stakes internal tool in
  // front of data that's mostly already public on the site itself; change
  // it any time by editing the line below. If this ever needs to protect
  // something actually sensitive, it needs a real auth backend instead.
  var PASSCODE = "habibi2026";
  var SESSION_KEY = "hje_inv_unlocked";

  var REQUEST_TYPES = [
    "Marcar como agotado",
    "Volver a marcar disponible",
    "Actualizar foto(s)",
    "Corregir nombre o descripcion",
    "Cambiar categoria o material",
    "Eliminar producto del catalogo",
    "Otro (ver nota)"
  ];

  var state = {
    products: [],
    filtered: []
  };

  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function buildWhatsAppLink(message) {
    return "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(message);
  }

  // ---------- gate ----------
  function initGate() {
    var form = $("#hje-inv-gate-form");
    var input = $("#hje-inv-passcode");
    var error = $("#hje-inv-gate-error");

    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      unlock();
      return;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (input.value === PASSCODE) {
        sessionStorage.setItem(SESSION_KEY, "1");
        unlock();
      } else {
        error.classList.add("hje-show");
        input.value = "";
        input.focus();
      }
    });
  }

  function unlock() {
    $("#hje-inv-gate").style.display = "none";
    $("#hje-inv-main").classList.add("hje-show");
    loadProducts();
  }

  // ---------- data ----------
  function loadProducts() {
    fetch("/joyas/assets/products.json")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        state.products = data;
        state.filtered = data;
        populateFilters(data);
        render();
      })
      .catch(function () {
        $("#hje-inv-grid").innerHTML =
          '<p style="grid-column:1/-1;color:#8a7a5f">No se pudo cargar el inventario. Intenta recargar la pagina.</p>';
      });
  }

  function populateFilters(products) {
    var categorySelect = $("#hje-inv-filter-category");
    var materialSelect = $("#hje-inv-filter-material");
    var categories = uniqueSorted(products.map(function (p) { return p.category; }));
    var materials = uniqueSorted(products.map(function (p) { return p.material; }));

    categories.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categorySelect.appendChild(opt);
    });
    materials.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      materialSelect.appendChild(opt);
    });
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr)).sort();
  }

  // ---------- filtering ----------
  function applyFilters() {
    var q = $("#hje-inv-search").value.trim().toLowerCase();
    var category = $("#hje-inv-filter-category").value;
    var material = $("#hje-inv-filter-material").value;

    state.filtered = state.products.filter(function (p) {
      if (category && p.category !== category) return false;
      if (material && p.material !== material) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && p.sku.toLowerCase().indexOf(q) === -1) {
        return false;
      }
      return true;
    });
    render();
  }

  // ---------- render ----------
  function render() {
    var grid = $("#hje-inv-grid");
    var count = $("#hje-inv-count");
    count.textContent = state.filtered.length + " de " + state.products.length + " productos";

    grid.innerHTML = "";
    state.filtered.forEach(function (p) {
      var card = document.createElement("div");
      card.className = "hje-inv-card";

      var img = document.createElement("img");
      img.loading = "lazy";
      img.src = (p.images && p.images[0] && p.images[0].thumbnail) || (p.images && p.images[0] && p.images[0].src) || "";
      img.alt = p.name;
      card.appendChild(img);

      var body = document.createElement("div");
      body.className = "hje-inv-card-body";

      var badge = document.createElement("span");
      badge.className = "hje-inv-badge" + (p.availability === "Disponible" ? " hje-inv-badge-ok" : "");
      badge.textContent = p.availability;
      body.appendChild(badge);

      var name = document.createElement("div");
      name.className = "hje-inv-card-name";
      name.textContent = p.name;
      body.appendChild(name);

      var meta = document.createElement("div");
      meta.className = "hje-inv-card-meta";
      meta.textContent = p.sku + " · " + p.category + " · " + p.material;
      body.appendChild(meta);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hje-inv-card-request";
      btn.textContent = "Solicitar cambio";
      btn.addEventListener("click", function () {
        openRequestModal(p);
      });
      body.appendChild(btn);

      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  // ---------- request modal (existing product) ----------
  function openRequestModal(product) {
    var backdrop = $("#hje-inv-modal-backdrop");
    var title = $("#hje-inv-modal-title");
    var productLine = $("#hje-inv-modal-product");
    var typeSelect = $("#hje-inv-modal-type");
    var note = $("#hje-inv-modal-note");
    var sendBtn = $("#hje-inv-modal-send");

    title.textContent = "Solicitar cambio";
    productLine.textContent = product.name + " (" + product.sku + ")";
    note.value = "";

    typeSelect.innerHTML = "";
    REQUEST_TYPES.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      typeSelect.appendChild(opt);
    });

    sendBtn.onclick = function () {
      var message =
        "Hola, tengo una solicitud de actualizacion de inventario:\n" +
        "Producto: " + product.name + " (" + product.sku + ")\n" +
        "Tipo: " + typeSelect.value +
        (note.value.trim() ? "\nNota: " + note.value.trim() : "");
      window.open(buildWhatsAppLink(message), "_blank", "noopener");
      closeModal();
    };

    backdrop.classList.add("hje-show");
  }

  // ---------- request modal (new product) ----------
  function openNewProductModal() {
    var backdrop = $("#hje-inv-modal-backdrop");
    var title = $("#hje-inv-modal-title");
    var productLine = $("#hje-inv-modal-product");
    var typeSelect = $("#hje-inv-modal-type");
    var note = $("#hje-inv-modal-note");
    var sendBtn = $("#hje-inv-modal-send");

    title.textContent = "Solicitar producto nuevo";
    productLine.textContent = "Describe la pieza que quieres agregar al catalogo";
    note.value = "";
    note.placeholder = "Nombre, categoria, material, precio orientativo, fotos disponibles...";

    typeSelect.innerHTML = "";
    var opt = document.createElement("option");
    opt.value = "Producto nuevo";
    opt.textContent = "Producto nuevo";
    typeSelect.appendChild(opt);

    sendBtn.onclick = function () {
      var message =
        "Hola, quiero agregar un producto nuevo al catalogo:\n" +
        (note.value.trim() || "(sin detalles - completar por WhatsApp)");
      window.open(buildWhatsAppLink(message), "_blank", "noopener");
      closeModal();
    };

    backdrop.classList.add("hje-show");
  }

  function closeModal() {
    $("#hje-inv-modal-backdrop").classList.remove("hje-show");
    $("#hje-inv-modal-note").placeholder = "Detalles adicionales (opcional)";
  }

  function init() {
    initGate();
    $("#hje-inv-search").addEventListener("input", applyFilters);
    $("#hje-inv-filter-category").addEventListener("change", applyFilters);
    $("#hje-inv-filter-material").addEventListener("change", applyFilters);
    $("#hje-inv-new-product-btn").addEventListener("click", openNewProductModal);
    $("#hje-inv-modal-cancel").addEventListener("click", closeModal);
    $("#hje-inv-modal-backdrop").addEventListener("click", function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
