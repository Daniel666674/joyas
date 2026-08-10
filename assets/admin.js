(function () {
  "use strict";

  // Internal admin panel: add/edit/delete products, publishing straight to
  // the GitHub repo via the Contents API (no server, no build step). This
  // page has no Next.js/React on it at all (see CLAUDE.md), so none of the
  // hydration caveats apply - it's free to build/rebuild its own DOM.
  //
  // Passcode gate here is the same casual-deterrent pattern as
  // inventario.js (own constant, independently rotatable) - the real
  // write credential is the GitHub PAT entered afterward, validated
  // against the API before being accepted.

  var GITHUB_OWNER = "Daniel666674";
  var GITHUB_REPO = "joyas";
  var GITHUB_API = "https://api.github.com";
  var GITHUB_BRANCH = "main";
  var WHATSAPP_NUMBER = "573001234567";
  var SUPPORT_WHATSAPP_NUMBER = "573136662777";
  var PASSCODE = "hjeadmin2026";
  var SESSION_PASSCODE_KEY = "hje_admin_unlocked";
  var SESSION_PAT_KEY = "hje_admin_pat";
  var SESSION_NAME_KEY = "hje_admin_name";
  var LOW_STOCK_THRESHOLD = 3;

  var CATEGORIES = ["Cadenas", "Pulseras", "Anillos", "Argollas", "Aretes", "Collares", "Dijes"];
  // Simplified 2026-07-30 from an 8-value list (Oro 14K/10K/Rosa,
  // Esmeraldas, Diamantes dropped) to match how the owner actually stocks
  // the store - 3 real material tiers. The 5 dropped material pages
  // (oro-14k.html etc.) still exist and still render fine for any legacy
  // product that used them, they're just no longer offered here for new
  // products/edits.
  var MATERIALS = ["Oro 18K", "Plata", "Oro Laminado"];
  var ANILLO_SIZE_PRESETS = ["5", "6", "7", "8", "9", "10", "11", "12"];
  // Only these two materials track a live price-per-gram - gold/silver
  // spot value moves daily and is worth centralizing. Oro Laminado's value
  // is mostly base metal + labor, not gold content, so it keeps a plain
  // manually-typed price like before this feature existed.
  var MATERIAL_PRICE_KEYS = ["Oro 18K", "Plata"];

  var state = {
    products: [],
    editingSlug: null,
    dirty: {},
    deleted: {},
    selected: {}, // slug -> true, for bulk edit
    photos: [], // [{ isNew, main, thumb, width, height, previewUrl, path, mime } | { isNew:false, existingSrc, existingThumb, alt, width, height }]
    sizes: [], // [{ label, units }]
    colors: [], // [{ label, units }]
    sales: [], // pending sale records staged for the next publish()
    salesListCache: [], // last-loaded merged sales list (published + pending), for the detail modal to look up by index
    materialPrices: {}, // { "Oro 18K": pricePerGram, "Plata": pricePerGram } - loaded from assets/material-prices.json
    // Homepage Manager state (loaded from assets/js/hero-manifest.js + site-text.js)
    heroSlides: [],           // [{ photo, video, videoRotation, zoom, position }]
    sectionVideos: {},        // { cadenas: { video, rotation }, ... }
    siteText: {},             // { heroHeadline, heroSubheadline, heroCta, sec_* }
    heroPendingPhotos: {},    // index -> File (not yet uploaded)
    heroPendingVideos: {},    // index -> File (not yet uploaded)
    sectionVideoPending: {},  // sectionKey -> File (not yet uploaded)
    inicioLoaded: false,
    pat: null,
    adminName: ""
  };
  var pendingSaleSlug = null;

  // units === 0 -> Agotado, else Bajo stock below the threshold, else
  // Disponible. This 3-tier badge is admin-side only, for quick restock
  // triage - the storefront still only ever reads the plain Disponible/
  // Agotado `availability` field, unchanged everywhere else on the site.
  function stockStatus(units) {
    var n = Number(units) || 0;
    if (n === 0) return "Agotado";
    if (n <= LOW_STOCK_THRESHOLD) return "Bajo stock";
    return "Disponible";
  }

  function formatPrice(price) {
    var n = Number(price) || 0;
    if (n <= 0) return null;
    return "$" + Math.round(n).toLocaleString("es-CO");
  }

  // Weight-based live price for Oro 18K/Plata (see MATERIAL_PRICE_KEYS) -
  // falls back to the product's own stored `price` whenever weight isn't
  // set or the material doesn't track a per-gram price (Oro Laminado, or
  // if assets/material-prices.json failed to load). This same formula is
  // duplicated in category-render.js, homepage-featured-refresh.js, and
  // generateProductPage()'s inline script - keep all four in sync.
  function computeDisplayPrice(p, materialPrices) {
    var perGram = materialPrices && materialPrices[p.material];
    var weight = Number(p.weight) || 0;
    if (weight > 0 && perGram) return Math.round(weight * perGram);
    return p.price;
  }

  // Every class used here (border-border, bg-white/90, text-gold-700,
  // bg-primary, text-primary-foreground, flex/flex-col/gap-2) is reused
  // verbatim from markup already shipped elsewhere on the site (the
  // existing "Destacado" badge and the WhatsApp/Instagram buttons) -
  // this is a static Next.js export, so any *new* Tailwind class name
  // would have no CSS behind it (nothing left to generate it at build
  // time). See CLAUDE.md.
  function badgeStackHtml(p) {
    var badges = "";
    if (p.featured) badges += '<span class="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium bg-white/90 text-gold-700">Destacado</span>';
    if (p.tag) badges += '<span class="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium bg-white/90 text-gold-700">' + esc(p.tag) + "</span>";
    if (p.promotion) badges += '<span class="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Promocion</span>';
    return badges ? '<div class="absolute left-3 top-3 flex flex-col gap-2">' + badges + "</div>" : "";
  }

  function photoFitStyle(p) {
    return p.photoFit === "contain" ? ";object-fit:contain" : "";
  }

  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }
  function $all(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // =========================================================================
  // GATE: passcode -> GitHub PAT
  // =========================================================================

  function initGates() {
    var passForm = $("#hje-adm-passcode-form");
    var passInput = $("#hje-adm-passcode");
    var passError = $("#hje-adm-passcode-error");

    passForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (passInput.value === PASSCODE) {
        sessionStorage.setItem(SESSION_PASSCODE_KEY, "1");
        showPatGate();
      } else {
        passError.classList.add("hje-show");
        passInput.value = "";
        passInput.focus();
      }
    });

    var patForm = $("#hje-adm-pat-form");
    var patInput = $("#hje-adm-pat");
    var nameInput = $("#hje-adm-name");
    var patError = $("#hje-adm-pat-error");
    var patSubmit = $("#hje-adm-pat-submit");

    patForm.addEventListener("submit", function (e) {
      e.preventDefault();
      patError.classList.remove("hje-show");
      patSubmit.disabled = true;
      patSubmit.textContent = "Conectando...";
      var pat = patInput.value.trim();
      validatePat(pat)
        .then(function () {
          state.pat = pat;
          state.adminName = nameInput.value.trim();
          sessionStorage.setItem(SESSION_PAT_KEY, pat);
          sessionStorage.setItem(SESSION_NAME_KEY, state.adminName);
          unlockMain();
        })
        .catch(function (err) {
          patError.textContent = err.message || "No se pudo validar el token.";
          patError.classList.add("hje-show");
        })
        .finally(function () {
          patSubmit.disabled = false;
          patSubmit.textContent = "Conectar";
        });
    });

    $("#hje-adm-logout").addEventListener("click", function () {
      sessionStorage.removeItem(SESSION_PASSCODE_KEY);
      sessionStorage.removeItem(SESSION_PAT_KEY);
      sessionStorage.removeItem(SESSION_NAME_KEY);
      window.location.reload();
    });

    // resume an existing session
    if (sessionStorage.getItem(SESSION_PASSCODE_KEY) === "1") {
      var storedPat = sessionStorage.getItem(SESSION_PAT_KEY);
      if (storedPat) {
        state.pat = storedPat;
        state.adminName = sessionStorage.getItem(SESSION_NAME_KEY) || "";
        validatePat(storedPat)
          .then(unlockMain)
          .catch(function () {
            sessionStorage.removeItem(SESSION_PAT_KEY);
            showPatGate();
          });
      } else {
        showPatGate();
      }
    }
  }

  function showPatGate() {
    $("#hje-adm-gate-passcode").style.display = "none";
    $("#hje-adm-gate-pat").style.display = "flex";
  }

  function validatePat(pat) {
    if (!pat) return Promise.reject(new Error("Ingresa un token."));
    return fetch(GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO, {
      headers: {
        Authorization: "Bearer " + pat,
        Accept: "application/vnd.github+json"
      }
    }).then(function (r) {
      if (r.status === 401) throw new Error("Token invalido o expirado.");
      if (r.status === 404) throw new Error("El token no tiene acceso a este repositorio.");
      if (!r.ok) throw new Error("No se pudo validar el token (HTTP " + r.status + ").");
      return r.json();
    }).then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) {
        throw new Error("Este token no tiene permiso de escritura en el repositorio.");
      }
      return repo;
    });
  }

  function unlockMain() {
    $("#hje-adm-gate-passcode").style.display = "none";
    $("#hje-adm-gate-pat").style.display = "none";
    $("#hje-adm-main").classList.add("hje-show");
    $("#hje-adm-logout").classList.add("hje-show");
    loadProducts();
    loadMaterialPrices();
  }

  // =========================================================================
  // GitHub Contents API helpers
  // =========================================================================

  function ghHeaders() {
    return {
      Authorization: "Bearer " + state.pat,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  function b64EncodeUnicode(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64DecodeUnicode(b64) {
    var binary = atob(b64.replace(/\n/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result;
        resolve(result.substring(result.indexOf(",") + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function ghGetFile(path) {
    return fetch(
      GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path + "?ref=" + GITHUB_BRANCH,
      { headers: ghHeaders() }
    ).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Error leyendo " + path + " (HTTP " + r.status + ")");
      return r.json();
    });
  }

  function ghPutText(path, text, sha, message) {
    var body = {
      message: "[admin] " + message,
      content: b64EncodeUnicode(text),
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    return fetch(GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path, {
      method: "PUT",
      headers: ghHeaders(),
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (j) {
          var err = new Error((j && j.message) || "Error al guardar " + path);
          err.status = r.status;
          throw err;
        });
      }
      return r.json();
    });
  }

  function ghPutBlob(path, blob, sha, message) {
    return blobToBase64(blob).then(function (b64) {
      var body = { message: "[admin] " + message, content: b64, branch: GITHUB_BRANCH };
      if (sha) body.sha = sha;
      return fetch(GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path, {
        method: "PUT",
        headers: ghHeaders(),
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            throw new Error((j && j.message) || "Error al subir " + path);
          });
        }
        return r.json();
      });
    });
  }

  function ghDeleteFile(path, sha, message) {
    return fetch(GITHUB_API + "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path, {
      method: "DELETE",
      headers: ghHeaders(),
      body: JSON.stringify({ message: "[admin] " + message, sha: sha, branch: GITHUB_BRANCH })
    }).then(function (r) {
      if (!r.ok && r.status !== 404) {
        return r.json().then(function (j) {
          throw new Error((j && j.message) || "Error al eliminar " + path);
        });
      }
    });
  }

  // =========================================================================
  // Product data loading / display
  // =========================================================================

  function loadProducts() {
    fetch("/joyas/assets/products.json?v=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (products) {
        state.products = products;
        populateFormSelects();
        populateFilterSelects();
        renderTable();
      });
  }

  // =========================================================================
  // Material prices (Oro 18K / Plata, per gram) - a small standalone
  // settings file, published independently of the main product publish
  // flow so a daily gold-price update is a single fast action.
  // =========================================================================

  function loadMaterialPrices() {
    fetch("/joyas/assets/material-prices.json?v=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.materialPrices = data || {};
        $("#hje-adm-price-oro18k").value = state.materialPrices["Oro 18K"] || 0;
        $("#hje-adm-price-plata").value = state.materialPrices["Plata"] || 0;
        var meta = $("#hje-adm-prices-meta");
        meta.textContent = state.materialPrices.updatedAt
          ? "Ultima actualizacion: " + new Date(state.materialPrices.updatedAt).toLocaleString("es-CO")
          : "Todavia no se ha actualizado manualmente.";
        renderTable();
      })
      .catch(function () {
        $("#hje-adm-prices-status").textContent = "No se pudieron cargar los precios de metales.";
        $("#hje-adm-prices-status").classList.add("hje-adm-log-error");
      });
  }

  function saveMaterialPrices() {
    if (!state.pat) return;
    var btn = $("#hje-adm-prices-save");
    var status = $("#hje-adm-prices-status");
    status.classList.remove("hje-adm-log-error");
    btn.disabled = true;
    status.textContent = "Guardando...";

    var oro18k = Math.max(0, parseInt($("#hje-adm-price-oro18k").value, 10) || 0);
    var plata = Math.max(0, parseInt($("#hje-adm-price-plata").value, 10) || 0);
    var updatedAt = new Date().toISOString();

    putWithRetry("assets/material-prices.json", function () {
      return JSON.stringify({ "Oro 18K": oro18k, "Plata": plata, updatedAt: updatedAt }, null, 2);
    }, "Precios de metales actualizados", 4).then(function () {
      state.materialPrices = { "Oro 18K": oro18k, "Plata": plata, updatedAt: updatedAt };
      status.textContent = "Precios guardados correctamente.";
      $("#hje-adm-prices-meta").textContent = "Ultima actualizacion: " + new Date(updatedAt).toLocaleString("es-CO");
      renderTable();
    }).catch(function (err) {
      status.textContent = "Error al guardar: " + err.message;
      status.classList.add("hje-adm-log-error");
    }).finally(function () {
      btn.disabled = false;
    });
  }

  function displayProducts() {
    // merges base products with this session's dirty/deleted overlay, for display only
    var bySlug = {};
    state.products.forEach(function (p) { bySlug[p.slug] = p; });
    Object.keys(state.dirty).forEach(function (slug) { bySlug[slug] = state.dirty[slug]; });
    var list = Object.keys(bySlug).map(function (slug) { return bySlug[slug]; });
    return list;
  }

  function populateFormSelects() {
    var catSel = $("#hje-adm-f-category");
    var matSel = $("#hje-adm-f-material");
    catSel.innerHTML = CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
    matSel.innerHTML = MATERIALS.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + "</option>"; }).join("");

    var bulkCatSel = $("#hje-adm-bulk-category");
    var bulkMatSel = $("#hje-adm-bulk-material");
    CATEGORIES.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      bulkCatSel.appendChild(opt);
    });
    MATERIALS.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      bulkMatSel.appendChild(opt);
    });
  }

  function populateFilterSelects() {
    var catSel = $("#hje-adm-filter-category");
    var matSel = $("#hje-adm-filter-material");
    CATEGORIES.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      catSel.appendChild(opt);
    });
    MATERIALS.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      matSel.appendChild(opt);
    });
  }

  function applyFilters() {
    var q = $("#hje-adm-search").value.trim().toLowerCase();
    var category = $("#hje-adm-filter-category").value;
    var material = $("#hje-adm-filter-material").value;
    var status = $("#hje-adm-filter-status").value;

    return displayProducts().filter(function (p) {
      if (state.deleted[p.slug]) return true; // keep visible, struck through
      if (category && p.category !== category) return false;
      if (material && p.material !== material) return false;
      if (status && stockStatus(p.units) !== status) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && p.sku.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function statusBadgeClass(status) {
    if (status === "Disponible") return "hje-adm-badge-ok";
    if (status === "Bajo stock") return "hje-adm-badge-warn";
    return "hje-adm-badge-off";
  }

  function renderTable() {
    var list = $("#hje-adm-card-list");
    var rows = applyFilters();
    $("#hje-adm-count").textContent = rows.length + " de " + displayProducts().length + " productos";
    renderStats();

    list.innerHTML = rows.map(function (p) {
      var isDeleted = !!state.deleted[p.slug];
      var isDirty = !!state.dirty[p.slug] && !isDeleted;
      var isSelected = !!state.selected[p.slug];
      var img = p.images && p.images[0] ? p.images[0].thumbnail || p.images[0].src : "";
      var status = stockStatus(p.units);
      var priceLabel = formatPrice(computeDisplayPrice(p, state.materialPrices)) || "Consultar precio";
      var cardClass = "hje-adm-card" +
        (isDeleted ? " hje-adm-card-deleted" : "") +
        (isDirty ? " hje-adm-card-dirty" : "");

      var pills = "";
      if (p.featured) pills += '<span class="hje-adm-card-pill">Destacado</span>';
      if (p.tag) pills += '<span class="hje-adm-card-pill">' + esc(p.tag) + "</span>";
      if (p.promotion) pills += '<span class="hje-adm-card-pill hje-adm-card-pill-promo">Promocion</span>';

      return (
        '<div class="' + cardClass + '" data-hje-slug="' + esc(p.slug) + '">' +
        '<div class="hje-adm-card-media">' +
        '<img class="hje-adm-card-photo" src="' + esc(img) + '" alt="" loading="lazy"/>' +
        (isDeleted ? "" : '<label class="hje-adm-card-select"><input type="checkbox" class="hje-adm-card-check" data-hje-slug="' + esc(p.slug) + '"' + (isSelected ? " checked" : "") + '/></label>') +
        (pills ? '<div class="hje-adm-card-badges">' + pills + "</div>" : "") +
        '<span class="hje-adm-badge hje-adm-card-status ' + statusBadgeClass(status) + '">' + esc(status) + "</span>" +
        "</div>" +
        '<div class="hje-adm-card-body">' +
        '<div class="hje-adm-card-title-row"><span class="hje-adm-card-name">' + esc(p.name) + '</span><span class="hje-adm-card-price">' + esc(priceLabel) + "</span></div>" +
        '<div class="hje-adm-card-meta">' + esc(p.sku) + " · " + esc(p.category) + " · " + esc(p.material) + "</div>" +
        '<div class="hje-adm-card-stats"><span>Unidades: <strong>' + (Number(p.units) || 0) + '</strong></span><span>Costo: <strong>' + esc(formatPrice(p.costoInterno) || "-") + "</strong></span></div>" +
        '<div class="hje-adm-card-actions">' +
        (isDeleted
          ? '<button type="button" class="hje-adm-card-btn hje-adm-undo-btn" data-hje-slug="' + esc(p.slug) + '">Deshacer</button>'
          : '<button type="button" class="hje-adm-card-btn hje-adm-edit-btn" data-hje-slug="' + esc(p.slug) + '">Editar</button>' +
            '<button type="button" class="hje-adm-card-btn hje-adm-card-btn-danger hje-adm-delete-btn" data-hje-slug="' + esc(p.slug) + '">Eliminar</button>') +
        "</div>" +
        (isDeleted || (Number(p.units) || 0) <= 0 ? "" : '<button type="button" class="hje-adm-card-btn hje-adm-card-btn-sale hje-adm-sale-btn" data-hje-slug="' + esc(p.slug) + '">Registrar venta</button>') +
        "</div></div>"
      );
    }).join("");

    $all(".hje-adm-edit-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () { openEditForm(btn.getAttribute("data-hje-slug")); });
    });
    $all(".hje-adm-delete-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () { openDeleteConfirm(btn.getAttribute("data-hje-slug")); });
    });
    $all(".hje-adm-undo-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        delete state.deleted[btn.getAttribute("data-hje-slug")];
        renderTable();
        updatePublishBar();
      });
    });
    $all(".hje-adm-sale-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () { openSaleForm(btn.getAttribute("data-hje-slug")); });
    });
    $all(".hje-adm-card-check", list).forEach(function (box) {
      box.addEventListener("change", function () {
        var slug = box.getAttribute("data-hje-slug");
        if (box.checked) state.selected[slug] = true;
        else delete state.selected[slug];
        updateSelectionBar();
      });
    });

    updatePublishBar();
    updateSelectionBar();
  }

  function moneyOrZero(n) {
    return "$" + Math.round(Math.max(0, n) || 0).toLocaleString("es-CO");
  }

  function renderStats() {
    var bar = $("#hje-adm-stats-bar");
    if (!bar) return;
    var all = displayProducts().filter(function (p) { return !state.deleted[p.slug]; });
    var counts = { Disponible: 0, "Bajo stock": 0, Agotado: 0 };
    var costValue = 0, retailValue = 0;
    all.forEach(function (p) {
      counts[stockStatus(p.units)]++;
      var units = Number(p.units) || 0;
      costValue += (Number(p.costoInterno) || 0) * units;
      retailValue += (Number(computeDisplayPrice(p, state.materialPrices)) || 0) * units;
    });
    bar.innerHTML =
      '<div class="hje-adm-stat"><div class="hje-adm-stat-value">' + all.length + '</div><div class="hje-adm-stat-label">Productos</div></div>' +
      '<div class="hje-adm-stat" data-hje-filter-status="Disponible" title="Filtrar por Disponible"><div class="hje-adm-stat-value">' + counts.Disponible + '</div><div class="hje-adm-stat-label">Disponibles</div></div>' +
      '<div class="hje-adm-stat hje-adm-stat-warn" data-hje-filter-status="Bajo stock" title="Filtrar por Bajo stock"><div class="hje-adm-stat-value">' + counts["Bajo stock"] + '</div><div class="hje-adm-stat-label">Bajo stock</div></div>' +
      '<div class="hje-adm-stat hje-adm-stat-off" data-hje-filter-status="Agotado" title="Filtrar por Agotado"><div class="hje-adm-stat-value">' + counts.Agotado + '</div><div class="hje-adm-stat-label">Agotados</div></div>' +
      '<div class="hje-adm-stat hje-adm-stat-gold hje-adm-stat-money"><div class="hje-adm-stat-value">' + moneyOrZero(retailValue) + '</div><div class="hje-adm-stat-label">Valor inventario (venta)</div></div>' +
      '<div class="hje-adm-stat hje-adm-stat-money"><div class="hje-adm-stat-value">' + moneyOrZero(costValue) + '</div><div class="hje-adm-stat-label">Valor inventario (costo)</div></div>';
    $all("[data-hje-filter-status]", bar).forEach(function (tile) {
      tile.style.cursor = "pointer";
      tile.addEventListener("click", function () {
        var status = tile.getAttribute("data-hje-filter-status");
        var sel = $("#hje-adm-filter-status");
        sel.value = sel.value === status ? "" : status;
        renderTable();
      });
    });
  }

  function updateSelectionBar() {
    var count = Object.keys(state.selected).length;
    var bulkBtn = $("#hje-adm-bulk-btn");
    var indicator = $("#hje-adm-selection-count");
    bulkBtn.disabled = count === 0;
    indicator.textContent = count > 0 ? count + " seleccionado(s)" : "";
  }

  function updatePublishBar() {
    var dirtyCount = Object.keys(state.dirty).length;
    var deletedCount = Object.keys(state.deleted).length;
    var salesCount = state.sales.length;
    var total = dirtyCount + deletedCount + salesCount;
    var status = $("#hje-adm-publish-status");
    var btn = $("#hje-adm-publish-btn");
    if (total === 0) {
      status.textContent = "Sin cambios pendientes.";
      btn.disabled = true;
    } else {
      status.textContent = total + " cambio(s) pendiente(s) de publicar." + (salesCount ? " (" + salesCount + " venta(s))" : "");
      btn.disabled = false;
    }
  }

  // =========================================================================
  // Add/Edit form
  // =========================================================================

  function slugify(name) {
    return name
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function nextId() {
    var max = 0;
    displayProducts().forEach(function (p) {
      var n = parseInt(p.id, 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return String(max + 1).padStart(3, "0");
  }

  function openNewForm() {
    state.editingSlug = null;
    $("#hje-adm-modal-title").textContent = "Nuevo producto";
    var form = $("#hje-adm-product-form");
    form.reset();
    var id = nextId();
    $("#hje-adm-f-sku").value = "JOY-" + id;
    $("#hje-adm-f-availability").value = "Disponible";
    $("#hje-adm-f-popularity").value = "50";
    $("#hje-adm-f-weight").value = "0";
    $("#hje-adm-f-price").value = "0";
    $("#hje-adm-f-units").value = "5";
    $("#hje-adm-f-costo").value = "0";
    $("#hje-adm-f-tag").value = "";
    $("#hje-adm-f-promotion").checked = false;
    $("#hje-adm-f-photofit").value = "cover";
    $("#hje-adm-f-instagram").value = "https://www.instagram.com/";
    $("#hje-adm-f-spec-acabado").value = "Pulido brillante";
    $("#hje-adm-f-spec-cuidado").value = "Evitar perfumes, piscinas y humedad prolongada";
    $("#hje-adm-f-spec-origen").value = "Catalogo curado en Colombia";
    $("#hje-adm-f-spec-garantia").value = "Asesoria y revision por WhatsApp";
    state.photos = [];
    renderPhotoGrid();
    state.sizes = [];
    state.colors = [];
    renderVariantRows("sizes");
    renderVariantRows("colors");
    updateVariantTotals();
    renderSizePresets();
    $("#hje-adm-photo-error").classList.remove("hje-show");
    $("#hje-adm-guardrails").classList.remove("hje-show");
    form.dataset.hjeId = id;

    var nameInput = $("#hje-adm-f-name");
    var slugInput = $("#hje-adm-f-slug");
    nameInput.oninput = function () {
      if (!slugInput.dataset.hjeTouched) {
        slugInput.value = slugify(nameInput.value) + (nameInput.value ? "-" + id : "");
      }
    };
    slugInput.oninput = function () { slugInput.dataset.hjeTouched = "1"; };
    delete slugInput.dataset.hjeTouched;
    wireUnitsAvailabilitySuggestion();
    renderWeightPricing();

    $("#hje-adm-modal-backdrop").classList.add("hje-show");
  }

  // Auto-suggests Disponible/Agotado from the units field whenever it
  // changes, but the dropdown stays a normal, independently-editable
  // select - the admin can override the suggestion immediately after,
  // e.g. to hide an in-stock item temporarily without zeroing its count.
  function wireUnitsAvailabilitySuggestion() {
    var unitsInput = $("#hje-adm-f-units");
    var availSelect = $("#hje-adm-f-availability");
    unitsInput.oninput = function () {
      var n = parseInt(unitsInput.value, 10);
      availSelect.value = n === 0 ? "Agotado" : "Disponible";
    };
  }

  function openEditForm(slug) {
    var product = displayProducts().find(function (p) { return p.slug === slug; });
    if (!product) return;
    state.editingSlug = slug;
    $("#hje-adm-modal-title").textContent = "Editar producto";
    var form = $("#hje-adm-product-form");
    form.reset();
    form.dataset.hjeId = product.id;

    $("#hje-adm-f-name").value = product.name;
    $("#hje-adm-f-slug").value = product.slug;
    $("#hje-adm-f-slug").dataset.hjeTouched = "1";
    $("#hje-adm-f-sku").value = product.sku;
    $("#hje-adm-f-category").value = product.category;
    $("#hje-adm-f-material").value = product.material;
    $("#hje-adm-f-availability").value = product.availability;
    $("#hje-adm-f-popularity").value = product.popularity || 50;
    $("#hje-adm-f-weight").value = Number(product.weight) || 0;
    $("#hje-adm-f-price").value = product.price || 0;
    $("#hje-adm-f-units").value = Number(product.units) || 0;
    $("#hje-adm-f-costo").value = product.costoInterno || 0;
    $("#hje-adm-f-tag").value = product.tag || "";
    $("#hje-adm-f-promotion").checked = !!product.promotion;
    $("#hje-adm-f-photofit").value = product.photoFit || "cover";
    $("#hje-adm-f-featured").checked = !!product.featured;
    $("#hje-adm-f-description").value = product.description || "";
    $("#hje-adm-f-spec-acabado").value = (product.specifications || {}).acabado || "";
    $("#hje-adm-f-spec-cuidado").value = (product.specifications || {}).cuidado || "";
    $("#hje-adm-f-spec-origen").value = (product.specifications || {}).origen || "";
    $("#hje-adm-f-spec-garantia").value = (product.specifications || {}).garantia || "";
    $("#hje-adm-f-instagram").value = product.instagramUrl || "https://www.instagram.com/";
    wireUnitsAvailabilitySuggestion();

    state.photos = (product.images || []).map(function (img) {
      return { isNew: false, existingSrc: img.src, existingThumb: img.thumbnail, alt: img.alt, width: img.width, height: img.height };
    });
    renderPhotoGrid();
    state.sizes = ((product.variants || {}).sizes || []).map(function (r) { return { label: r.label, units: Number(r.units) || 0 }; });
    state.colors = ((product.variants || {}).colors || []).map(function (r) { return { label: r.label, units: Number(r.units) || 0 }; });
    renderVariantRows("sizes");
    renderVariantRows("colors");
    updateVariantTotals();
    renderSizePresets();
    renderWeightPricing();
    $("#hje-adm-photo-error").classList.remove("hje-show");
    $("#hje-adm-guardrails").classList.remove("hje-show");

    $("#hje-adm-modal-backdrop").classList.add("hje-show");
  }

  function closeForm() {
    $("#hje-adm-modal-backdrop").classList.remove("hje-show");
  }

  // ---------- photo pipeline: canvas downscale + blank-canvas guard ----------

  function downscaleSource(source, srcW, srcH, maxDim) {
    var scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    var w = Math.max(1, Math.round(srcW * scale));
    var h = Math.max(1, Math.round(srcH * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, w, h);
    return canvas;
  }

  function downscale(img, maxDim) {
    return downscaleSource(img, img.naturalWidth, img.naturalHeight, maxDim);
  }

  function isCanvasBlank(canvas) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var points = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [Math.floor(w / 2), Math.floor(h / 2)]
    ];
    for (var i = 0; i < points.length; i++) {
      var data = ctx.getImageData(points[i][0], points[i][1], 1, 1).data;
      if (data[3] !== 0) return false;
    }
    return true;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, mime, quality);
    });
  }

  function mimeForPath(path) {
    return /\.webp(\?|$)/i.test(path || "") ? "image/webp" : "image/jpeg";
  }

  function extForMime(mime) {
    return mime === "image/webp" ? "webp" : "jpg";
  }

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("No se pudo cargar la imagen.")); };
      img.src = url;
    });
  }

  function loadImageFromUrl(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("No se pudo cargar la foto existente.")); };
      img.src = src + (src.indexOf("?") === -1 ? "?v=" : "&v=") + Date.now();
    });
  }

  function rotateCanvas90(source, srcW, srcH) {
    var canvas = document.createElement("canvas");
    canvas.width = srcH;
    canvas.height = srcW;
    var ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, -srcW / 2, -srcH / 2);
    return canvas;
  }

  function processPhotoFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var mainCanvas = downscale(img, 1200);
          var thumbCanvas = downscale(img, 400);
          if (isCanvasBlank(mainCanvas) || isCanvasBlank(thumbCanvas)) {
            reject(new Error("No se pudo procesar la imagen (parece en blanco). Intenta de nuevo."));
            return;
          }
          Promise.all([canvasToBlob(mainCanvas, "image/jpeg", 0.82), canvasToBlob(thumbCanvas, "image/jpeg", 0.8)]).then(function (blobs) {
            resolve({
              main: blobs[0],
              thumb: blobs[1],
              width: mainCanvas.width,
              height: mainCanvas.height,
              previewUrl: URL.createObjectURL(blobs[0])
            });
          });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo cargar la imagen."));
      };
      img.src = url;
    });
  }

  // ---------- multi-photo gallery: state.photos + reorder/rotate/remove ----------

  function newPhotoPath() {
    var id = $("#hje-adm-product-form").dataset.hjeId;
    var slug = $("#hje-adm-f-slug").value || slugify($("#hje-adm-f-name").value) + "-" + id;
    return "products/producto-" + id + "-" + slug + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function renderPhotoGrid() {
    var grid = $("#hje-adm-photo-grid");
    var tiles = state.photos.map(function (photo, i) {
      var src = photo.previewUrl || photo.existingThumb || photo.existingSrc;
      return (
        '<div class="hje-adm-photo-tile" data-index="' + i + '">' +
        (i === 0 ? '<span class="hje-adm-photo-cover-label">Portada</span>' : "") +
        '<img src="' + esc(src) + '" alt=""/>' +
        '<button type="button" class="hje-adm-photo-remove" data-index="' + i + '" aria-label="Eliminar foto">&times;</button>' +
        '<div class="hje-adm-photo-controls">' +
        '<button type="button" class="hje-adm-photo-prev" data-index="' + i + '"' + (i === 0 ? " disabled" : "") + ">&lsaquo;</button>" +
        '<button type="button" class="hje-adm-photo-rotate" data-index="' + i + '">&#8635;</button>' +
        '<button type="button" class="hje-adm-photo-next" data-index="' + i + '"' + (i === state.photos.length - 1 ? " disabled" : "") + ">&rsaquo;</button>" +
        "</div></div>"
      );
    }).join("");
    grid.innerHTML = tiles + '<div class="hje-adm-photo-add" id="hje-adm-photo-add-tile">+</div>';

    $("#hje-adm-photo-add-tile").addEventListener("click", function () { $("#hje-adm-f-photo").click(); });
    $all(".hje-adm-photo-remove", grid).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.photos.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
        renderPhotoGrid();
      });
    });
    $all(".hje-adm-photo-prev", grid).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(btn.getAttribute("data-index"), 10);
        if (i <= 0) return;
        var tmp = state.photos[i - 1];
        state.photos[i - 1] = state.photos[i];
        state.photos[i] = tmp;
        renderPhotoGrid();
      });
    });
    $all(".hje-adm-photo-next", grid).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(btn.getAttribute("data-index"), 10);
        if (i >= state.photos.length - 1) return;
        var tmp = state.photos[i + 1];
        state.photos[i + 1] = state.photos[i];
        state.photos[i] = tmp;
        renderPhotoGrid();
      });
    });
    $all(".hje-adm-photo-rotate", grid).forEach(function (btn) {
      btn.addEventListener("click", function () {
        rotatePhotoAt(parseInt(btn.getAttribute("data-index"), 10));
      });
    });
  }

  function rotatePhotoAt(i) {
    var photo = state.photos[i];
    var errorEl = $("#hje-adm-photo-error");
    errorEl.classList.remove("hje-show");

    var mime = photo.isNew ? (photo.mime || "image/jpeg") : mimeForPath(photo.existingSrc);
    var sourcePromise = photo.main ? loadImageFromBlob(photo.main) : loadImageFromUrl(photo.existingSrc);

    sourcePromise.then(function (img) {
      var srcW = img.naturalWidth || img.width;
      var srcH = img.naturalHeight || img.height;
      var rotated = rotateCanvas90(img, srcW, srcH);
      var mainCanvas = downscaleSource(rotated, rotated.width, rotated.height, 1200);
      var thumbCanvas = downscaleSource(rotated, rotated.width, rotated.height, 400);
      if (isCanvasBlank(mainCanvas) || isCanvasBlank(thumbCanvas)) {
        throw new Error("No se pudo rotar la imagen (parece en blanco). Intenta de nuevo.");
      }
      var quality = mime === "image/webp" ? 0.85 : 0.82;
      var thumbQuality = mime === "image/webp" ? 0.82 : 0.8;
      return Promise.all([canvasToBlob(mainCanvas, mime, quality), canvasToBlob(thumbCanvas, mime, thumbQuality)]).then(function (blobs) {
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
        state.photos[i] = {
          isNew: true,
          main: blobs[0],
          thumb: blobs[1],
          width: mainCanvas.width,
          height: mainCanvas.height,
          previewUrl: URL.createObjectURL(blobs[0]),
          path: photo.isNew ? photo.path : photo.existingSrc.replace(/^\/joyas\//, "").replace(/\.[a-z0-9]+$/i, ""),
          mime: mime,
          alt: photo.alt
        };
        renderPhotoGrid();
      });
    }).catch(function (err) {
      errorEl.textContent = err.message || "No se pudo rotar la imagen.";
      errorEl.classList.add("hje-show");
    });
  }

  function initPhotoInput() {
    $("#hje-adm-f-photo").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files);
      if (!files.length) return;
      var errorEl = $("#hje-adm-photo-error");
      errorEl.classList.remove("hje-show");
      Promise.all(files.map(function (file) {
        return processPhotoFile(file).then(function (result) {
          state.photos.push({
            isNew: true,
            main: result.main,
            thumb: result.thumb,
            width: result.width,
            height: result.height,
            previewUrl: result.previewUrl,
            path: newPhotoPath(),
            mime: "image/jpeg"
          });
        });
      })).then(function () {
        renderPhotoGrid();
        e.target.value = "";
      }).catch(function (err) {
        errorEl.textContent = err.message;
        errorEl.classList.add("hje-show");
        e.target.value = "";
      });
    });
  }

  // ---------- size/color variants: repeatable rows + computed total ----------

  function renderVariantRows(kind) {
    var container = $("#hje-adm-" + kind + "-rows");
    var list = state[kind];
    container.innerHTML = list.map(function (row, i) {
      return (
        '<div class="hje-adm-variant-row">' +
        '<input type="text" class="hje-adm-variant-label" data-kind="' + kind + '" data-index="' + i + '" placeholder="' + (kind === "sizes" ? "Ej: 7" : "Ej: Oro rosa") + '" value="' + esc(row.label) + '"/>' +
        '<input type="number" class="hje-adm-variant-units" data-kind="' + kind + '" data-index="' + i + '" min="0" value="' + (Number(row.units) || 0) + '"/>' +
        '<button type="button" class="hje-adm-variant-remove" data-kind="' + kind + '" data-index="' + i + '" aria-label="Eliminar">&times;</button>' +
        "</div>"
      );
    }).join("");

    $all(".hje-adm-variant-label", container).forEach(function (input) {
      input.addEventListener("input", function () {
        state[kind][parseInt(input.getAttribute("data-index"), 10)].label = input.value;
        if (kind === "sizes") renderSizePresets();
      });
    });
    $all(".hje-adm-variant-units", container).forEach(function (input) {
      input.addEventListener("input", function () {
        state[kind][parseInt(input.getAttribute("data-index"), 10)].units = parseInt(input.value, 10) || 0;
        updateVariantTotals();
      });
    });
    $all(".hje-adm-variant-remove", container).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state[kind].splice(parseInt(btn.getAttribute("data-index"), 10), 1);
        renderVariantRows(kind);
        updateVariantTotals();
        if (kind === "sizes") renderSizePresets();
      });
    });
  }

  function addVariantRow(kind) {
    state[kind].push({ label: "", units: 0 });
    renderVariantRows(kind);
    updateVariantTotals();
  }

  // Live weight x price-per-gram computation for Oro 18K/Plata (see
  // MATERIAL_PRICE_KEYS). Mirrors the units-from-variants auto-compute
  // pattern: Precio becomes disabled/computed when applicable, and reverts
  // to a normal manually-editable field otherwise (weight = 0, material is
  // Oro Laminado, or no per-gram price configured yet).
  function renderWeightPricing() {
    var material = $("#hje-adm-f-material").value;
    var weight = parseFloat($("#hje-adm-f-weight").value) || 0;
    var priceInput = $("#hje-adm-f-price");
    var priceHint = $("#hje-adm-price-computed-hint");
    var weightHint = $("#hje-adm-weight-hint");
    var perGram = state.materialPrices[material];

    if (MATERIAL_PRICE_KEYS.indexOf(material) !== -1 && weight > 0 && perGram) {
      var computed = Math.round(weight * perGram);
      priceInput.value = computed;
      priceInput.disabled = true;
      priceHint.textContent = "Calculado: " + weight + "g x " + (formatPrice(perGram) || "$0") + "/g = " + (formatPrice(computed) || "$0");
      weightHint.textContent = "";
    } else {
      priceInput.disabled = false;
      priceHint.textContent = "";
      weightHint.textContent = (MATERIAL_PRICE_KEYS.indexOf(material) !== -1 && weight > 0 && !perGram)
        ? "Configura el precio de " + material + " por gramo en la pestaña \"Precios de metales\"."
        : "";
    }
  }

  // Quick-add chips for standard ring sizes - only relevant for rings
  // (Anillos/Argollas), so hidden for every other category. Clicking a
  // size already present is a no-op rather than a duplicate row.
  var RING_CATEGORIES = ["Anillos", "Argollas"];

  function renderSizePresets() {
    var box = $("#hje-adm-size-presets");
    var category = $("#hje-adm-f-category").value;
    if (RING_CATEGORIES.indexOf(category) === -1) {
      box.classList.remove("hje-show");
      box.innerHTML = "";
      return;
    }
    var existingLabels = state.sizes.map(function (r) { return r.label.trim(); });
    box.innerHTML = '<span class="hje-adm-preset-label">Tallas comunes de anillo</span>' +
      ANILLO_SIZE_PRESETS.map(function (size) {
        var already = existingLabels.indexOf(size) !== -1;
        return '<button type="button" class="hje-adm-preset-chip" data-size="' + esc(size) + '"' + (already ? " disabled" : "") + ">" + esc(size) + "</button>";
      }).join("");
    box.classList.add("hje-show");
    $all(".hje-adm-preset-chip", box).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var size = btn.getAttribute("data-size");
        if (state.sizes.some(function (r) { return r.label.trim() === size; })) return;
        state.sizes.push({ label: size, units: 0 });
        renderVariantRows("sizes");
        renderSizePresets();
        updateVariantTotals();
      });
    });
  }

  function sumUnits(list) {
    return list.reduce(function (s, r) { return s + (Number(r.units) || 0); }, 0);
  }

  function computedUnitsTotal() {
    if (state.sizes.length) return sumUnits(state.sizes);
    if (state.colors.length) return sumUnits(state.colors);
    return null;
  }

  function updateVariantTotals() {
    $("#hje-adm-sizes-total").textContent = state.sizes.length
      ? "Total: " + sumUnits(state.sizes) + " unidad(es) en " + state.sizes.length + " talla(s)."
      : "";

    var unitsInput = $("#hje-adm-f-units");
    var hint = $("#hje-adm-units-computed-hint");
    var computed = computedUnitsTotal();
    if (computed !== null) {
      unitsInput.value = computed;
      unitsInput.disabled = true;
      hint.textContent = "Calculado automaticamente desde tallas/colores.";
      $("#hje-adm-f-availability").value = computed === 0 ? "Agotado" : "Disponible";
    } else {
      unitsInput.disabled = false;
      hint.textContent = "";
    }
  }

  // ---------- guardrails + save ----------

  function validateForm(product, isNew) {
    var errors = [];
    if (!product.name) errors.push("El nombre es obligatorio.");
    if (!CATEGORIES.indexOf(product.category) >= 0 === false) errors.push("Selecciona una categoria valida.");
    if (CATEGORIES.indexOf(product.category) === -1) errors.push("Selecciona una categoria valida.");
    if (MATERIALS.indexOf(product.material) === -1) errors.push("Selecciona un material valido.");
    if (!product.description) errors.push("La descripcion es obligatoria.");
    var specs = product.specifications || {};
    ["acabado", "cuidado", "origen", "garantia"].forEach(function (k) {
      if (!specs[k]) errors.push("La especificacion '" + k + "' es obligatoria.");
    });
    if (!state.photos.length) errors.push("Se requiere al menos una foto.");

    var allProducts = displayProducts();
    var slugCollision = allProducts.some(function (p) { return p.slug === product.slug && p.slug !== state.editingSlug; });
    if (slugCollision) errors.push("Ya existe un producto con ese slug.");
    var skuCollision = allProducts.some(function (p) { return p.sku === product.sku && p.slug !== state.editingSlug; });
    if (skuCollision) errors.push("Ya existe un producto con ese SKU.");

    return errors;
  }

  function showGuardrails(errors) {
    var box = $("#hje-adm-guardrails");
    var list = $("#hje-adm-guardrail-items");
    list.innerHTML = errors.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("");
    box.classList.add("hje-show");
  }

  function saveForm(e) {
    e.preventDefault();
    var id = $("#hje-adm-product-form").dataset.hjeId;
    var slug = $("#hje-adm-f-slug").value.trim();
    var existing = state.editingSlug
      ? displayProducts().find(function (p) { return p.slug === state.editingSlug; })
      : null;

    var name = $("#hje-adm-f-name").value.trim();
    var material = $("#hje-adm-f-material").value;
    var defaultAlt = name + " en " + material + " - joyeria colombiana";

    var product = {
      id: (existing && existing.id) || id,
      slug: slug,
      sku: $("#hje-adm-f-sku").value.trim(),
      name: name,
      category: $("#hje-adm-f-category").value,
      material: material,
      weight: Math.max(0, parseFloat($("#hje-adm-f-weight").value) || 0),
      price: parseInt($("#hje-adm-f-price").value, 10) || 0,
      currency: (existing && existing.currency) || "COP",
      availability: $("#hje-adm-f-availability").value,
      units: Math.max(0, parseInt($("#hje-adm-f-units").value, 10) || 0),
      costoInterno: Math.max(0, parseInt($("#hje-adm-f-costo").value, 10) || 0),
      tag: $("#hje-adm-f-tag").value.trim(),
      promotion: $("#hje-adm-f-promotion").checked,
      photoFit: $("#hje-adm-f-photofit").value === "contain" ? "contain" : "cover",
      featured: $("#hje-adm-f-featured").checked,
      popularity: parseInt($("#hje-adm-f-popularity").value, 10) || 0,
      images: state.photos.map(function (photo) {
        if (photo.isNew) {
          var ext = extForMime(photo.mime);
          var entry = {
            src: "/joyas/" + photo.path + "." + ext,
            thumbnail: "/joyas/" + photo.path + "-thumb." + ext,
            alt: photo.alt || defaultAlt,
            width: photo.width,
            height: photo.height
          };
          entry._pendingPhoto = { main: photo.main, thumb: photo.thumb };
          entry._pendingPhotoPath = photo.path + "." + ext;
          entry._pendingPhotoThumbPath = photo.path + "-thumb." + ext;
          return entry;
        }
        return { src: photo.existingSrc, thumbnail: photo.existingThumb, alt: photo.alt || defaultAlt, width: photo.width, height: photo.height };
      }),
      variants: {
        sizes: state.sizes.filter(function (r) { return r.label.trim(); }).map(function (r) { return { label: r.label.trim(), units: Math.max(0, Number(r.units) || 0) }; }),
        colors: state.colors.filter(function (r) { return r.label.trim(); }).map(function (r) { return { label: r.label.trim(), units: Math.max(0, Number(r.units) || 0) }; })
      },
      description: $("#hje-adm-f-description").value.trim(),
      specifications: {
        acabado: $("#hje-adm-f-spec-acabado").value.trim(),
        cuidado: $("#hje-adm-f-spec-cuidado").value.trim(),
        origen: $("#hje-adm-f-spec-origen").value.trim(),
        garantia: $("#hje-adm-f-spec-garantia").value.trim()
      },
      seo: {
        title: name + " | Joyeria Colombiana",
        description: "Compra " + name.toLowerCase() + " en " + material.toLowerCase() + " con asesoria personalizada por WhatsApp e Instagram."
      },
      instagramUrl: $("#hje-adm-f-instagram").value.trim() || "https://www.instagram.com/"
    };

    var errors = validateForm(product, !state.editingSlug);
    if (errors.length) {
      showGuardrails(errors);
      return;
    }

    // if slug changed on an edit, treat as delete-old + create-new (the URL itself changes)
    if (state.editingSlug && state.editingSlug !== product.slug) {
      state.deleted[state.editingSlug] = true;
      delete state.dirty[state.editingSlug];
    }

    state.dirty[product.slug] = product;
    delete state.deleted[product.slug];
    closeForm();
    renderTable();
  }

  // =========================================================================
  // Delete flow
  // =========================================================================

  var pendingDeleteSlug = null;

  function openDeleteConfirm(slug) {
    var product = displayProducts().find(function (p) { return p.slug === slug; });
    if (!product) return;
    pendingDeleteSlug = slug;
    $("#hje-adm-confirm-text").textContent =
      'Esto eliminara "' + product.name + '": su pagina de producto, su entrada en el sitemap, y su presencia en las paginas de categoria/material. No se puede deshacer despues de publicar.';
    $("#hje-adm-confirm-backdrop").classList.add("hje-show");
  }

  function confirmDelete() {
    if (pendingDeleteSlug) {
      state.deleted[pendingDeleteSlug] = true;
      delete state.dirty[pendingDeleteSlug];
    }
    pendingDeleteSlug = null;
    $("#hje-adm-confirm-backdrop").classList.remove("hje-show");
    renderTable();
  }

  // =========================================================================
  // Register a sale: real stock decrement + sales-log entry (staged via
  // state.dirty/state.sales exactly like any other edit, only becomes
  // permanent on the next Publish). The Wompi/Siigo steps shown in between
  // are a pure client-side simulation - see runSaleSimulation() - since
  // neither integration exists yet; nothing here calls a real API or needs
  // any credential beyond the admin's own existing GitHub token.
  // =========================================================================

  function openSaleForm(slug) {
    var product = displayProducts().find(function (p) { return p.slug === slug; });
    if (!product || state.deleted[slug]) return;
    pendingSaleSlug = slug;
    $("#hje-adm-sale-form").style.display = "";
    $("#hje-adm-sale-sim").classList.remove("hje-show");
    $("#hje-adm-sale-error").classList.remove("hje-show");
    $("#hje-adm-sale-result").classList.remove("hje-show");
    $("#hje-adm-sale-done-actions").style.display = "none";
    $all(".hje-adm-sale-step").forEach(function (el) { el.classList.remove("hje-adm-sale-step-done"); el.style.display = ""; });
    $("#hje-adm-sale-product-name").textContent = product.name + " - disponibles: " + (Number(product.units) || 0);
    $("#hje-adm-sale-qty").value = "1";
    $("#hje-adm-sale-qty").max = String(Number(product.units) || 0);
    $("#hje-adm-sale-price").value = computeDisplayPrice(product, state.materialPrices) || 0;
    $("#hje-adm-sale-buyer").value = "";
    $("#hje-adm-sale-phone").value = "";
    $("#hje-adm-sale-backdrop").classList.add("hje-show");
  }

  function closeSaleForm() {
    pendingSaleSlug = null;
    $("#hje-adm-sale-backdrop").classList.remove("hje-show");
    renderTable();
  }

  function submitSaleForm(e) {
    e.preventDefault();
    var product = displayProducts().find(function (p) { return p.slug === pendingSaleSlug; });
    var errorEl = $("#hje-adm-sale-error");
    errorEl.classList.remove("hje-show");
    if (!product) return;

    var qty = parseInt($("#hje-adm-sale-qty").value, 10) || 0;
    var unitPrice = parseInt($("#hje-adm-sale-price").value, 10) || 0;
    var available = Number(product.units) || 0;
    if (qty < 1) { errorEl.textContent = "La cantidad debe ser al menos 1."; errorEl.classList.add("hje-show"); return; }
    if (qty > available) { errorEl.textContent = "Solo hay " + available + " unidad(es) disponibles."; errorEl.classList.add("hje-show"); return; }

    $("#hje-adm-sale-form").style.display = "none";
    $("#hje-adm-sale-sim").classList.add("hje-show");
    runSaleSimulation(product, qty, unitPrice, $("#hje-adm-sale-buyer").value.trim(), $("#hje-adm-sale-phone").value.trim());
  }

  function fakeRef(prefix) {
    return prefix + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function markStepDone(id) {
    var el = $(id);
    el.classList.add("hje-adm-sale-step-done");
  }

  function runSaleSimulation(product, qty, unitPrice, buyer, phone) {
    var wompiRef = fakeRef("WOMPI");
    var siigoInvoice = fakeRef("SIIGO-FE");
    setTimeout(function () {
      markStepDone("#hje-adm-sim-wompi");
      setTimeout(function () {
        markStepDone("#hje-adm-sim-siigo");
        stageSale(product, qty, unitPrice, buyer, phone, wompiRef, siigoInvoice);
        var total = qty * unitPrice;
        var result = $("#hje-adm-sale-result");
        result.innerHTML =
          "<strong>Venta registrada.</strong><br/>" +
          "Total: " + moneyOrZero(total) + "<br/>" +
          "Referencia Wompi (simulada): " + esc(wompiRef) + "<br/>" +
          "Factura Siigo (simulada): " + esc(siigoInvoice) + "<br/>" +
          "Stock actualizado: queda pendiente de publicar.";
        result.classList.add("hje-show");
        $("#hje-adm-sale-done-actions").style.display = "flex";
      }, 1100);
    }, 1100);
  }

  function stageSale(product, qty, unitPrice, buyer, phone, wompiRef, siigoInvoice) {
    var updated = JSON.parse(JSON.stringify(product));
    updated.units = Math.max(0, (Number(updated.units) || 0) - qty);
    if (updated.units === 0) updated.availability = "Agotado";
    state.dirty[updated.slug] = updated;

    state.sales.push({
      timestamp: new Date().toISOString(),
      slug: product.slug,
      name: product.name,
      qty: qty,
      unitPrice: unitPrice,
      total: qty * unitPrice,
      buyerName: buyer || null,
      buyerPhone: phone || null,
      wompiRef: wompiRef,
      siigoInvoice: siigoInvoice,
      adminName: state.adminName || null
    });

    updatePublishBar();
  }

  // =========================================================================
  // Bulk edit: applies only the fields the admin actually touched (left at
  // "Sin cambio" otherwise) to every currently-selected product, merged
  // onto each product's own current data - same dirty-tracking mechanism
  // as a single edit, just looped over the selection.
  // =========================================================================

  function openBulkEditForm() {
    var count = Object.keys(state.selected).length;
    if (count === 0) return;
    $("#hje-adm-bulk-count").textContent = count + " producto(s) seleccionados";
    $("#hje-adm-bulk-category").value = "";
    $("#hje-adm-bulk-material").value = "";
    $("#hje-adm-bulk-availability").value = "";
    $("#hje-adm-bulk-featured").value = "";
    $("#hje-adm-bulk-backdrop").classList.add("hje-show");
  }

  function closeBulkEditForm() {
    $("#hje-adm-bulk-backdrop").classList.remove("hje-show");
  }

  function applyBulkEdit() {
    var category = $("#hje-adm-bulk-category").value;
    var material = $("#hje-adm-bulk-material").value;
    var availability = $("#hje-adm-bulk-availability").value;
    var featured = $("#hje-adm-bulk-featured").value;

    var all = displayProducts();
    Object.keys(state.selected).forEach(function (slug) {
      var product = all.find(function (p) { return p.slug === slug; });
      if (!product || state.deleted[slug]) return;
      var updated = JSON.parse(JSON.stringify(product));
      if (category) updated.category = category;
      if (material) updated.material = material;
      if (availability) {
        updated.availability = availability;
        if (availability === "Agotado") updated.units = 0;
        else if (Number(updated.units) === 0) updated.units = LOW_STOCK_THRESHOLD + 1;
      }
      if (featured) updated.featured = featured === "si";
      state.dirty[slug] = updated;
    });

    state.selected = {};
    closeBulkEditForm();
    renderTable();
  }

  function discardChanges() {
    state.dirty = {};
    state.deleted = {};
    state.selected = {};
    state.sales = [];
    logPublish("");
    renderTable();
  }

  // =========================================================================
  // Product-detail page generation
  // =========================================================================
  // generateProductPage() fills {{TOKEN}} placeholders in
  // producto/_template.html (fetched once per publish in step 3 of publish()).
  // Header/footer/floating markup now lives in the template — update it there
  // rather than here.

  function waHref(text) {
    return "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text);
  }

  // Same article.group markup as assets/category-render.js's
  // renderProductCard - keep the two in sync.
  function renderCard(p) {
    var img = p.images && p.images[0] ? p.images[0] : { src: "", alt: p.name };
    var badge = badgeStackHtml(p);
    var href = "/joyas/producto/" + p.slug;
    return (
      '<article class="group"><a class="block overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="' + href + '">' +
      '<div class="relative aspect-[4/5]"><img alt="' + esc(img.alt) + '" loading="lazy" decoding="async" data-nimg="fill" class="object-cover transition-transform duration-500 group-hover:scale-105" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent' + photoFitStyle(p) + '" src="' + esc(img.src) + '"/>' +
      badge +
      '<button class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-foreground shadow-soft transition hover:bg-white" aria-label="Guardar ' + esc(p.name) + ' en favoritos"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-heart h-4 w-4"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg></button></div></a>' +
      '<div class="mt-4 space-y-3"><div><a class="font-medium hover:text-gold-700" href="' + href + '">' + esc(p.name) + '</a><p class="mt-1 text-sm text-muted-foreground">' + esc(p.category) + '<!-- --> · <!-- -->' + esc(p.material) + '</p></div>' +
      '<div class="flex items-center justify-between gap-3"><span class="text-sm font-semibold hje-price-recompute" data-material="' + esc(p.material) + '" data-weight="' + (Number(p.weight) || 0) + '">' + esc(formatPrice(p.price) || "Consultar precio") + '</span><div class="flex items-center gap-1">' +
      '<a href="' + esc(p.instagramUrl || "https://www.instagram.com/") + '" target="_blank" rel="noreferrer" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Ver en Instagram"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-instagram h-4 w-4"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line></svg></a>' +
      '<a href="' + waHref("Hola, quiero consultar " + p.name) + '" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Consultar por WhatsApp"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-4 w-4"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg></a>' +
      "</div></div></div></article>"
    );
  }

  function categorySlug(category) {
    var map = { Cadenas: "cadenas", Pulseras: "pulseras", Anillos: "anillos", Argollas: "argollas", Aretes: "aretes", Collares: "collares", Dijes: "dijes" };
    return map[category] || slugify(category);
  }

  function generateProductPage(product, allProducts, tmpl) {
    var related = allProducts
      .filter(function (p) { return p.category === product.category && p.slug !== product.slug; })
      .sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); })
      .slice(0, 4);

    var img = product.images[0];
    var canonical = "https://joyas-colombia.com/producto/" + product.slug;
    var ogImageUrl = "https://joyas-colombia.com/joyas" + img.src.replace(/^\/joyas/, "");
    var offerAvailability = product.availability === "Disponible" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

    function safeJsonLd(text) {
      return text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
    }
    var offers = { "@type": "Offer", priceCurrency: product.currency || "COP", availability: offerAvailability, url: canonical };
    if (product.price > 0) offers.price = product.price;
    var jsonLdProduct = safeJsonLd(JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", name: product.name, sku: product.sku,
      image: [ogImageUrl], description: product.description,
      brand: { "@type": "Brand", name: "Habibi Eisaa" },
      material: product.material, category: product.category, offers: offers
    }));
    var jsonLdBreadcrumb = safeJsonLd(JSON.stringify({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: product.category, item: "https://joyas-colombia.com/" + categorySlug(product.category) },
        { "@type": "ListItem", position: 2, name: product.name, item: canonical }
      ]
    }));

    var pillHtml = ['category', 'material', 'availability'].map(function (key) {
      var val = key === "availability" ? product.availability : product[key];
      return '<span class="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">' + esc(val) + "</span>";
    }).join("");
    if (product.tag) pillHtml += '<span class="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-gold-700">' + esc(product.tag) + "</span>";
    if (product.promotion) pillHtml += '<span class="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Promocion</span>';

    function variantOptionsHtml(list, kind) {
      return list.map(function (opt) {
        var disabled = Number(opt.units) === 0;
        return '<button type="button" class="hje-variant-opt inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:pointer-events-none" data-kind="' + esc(kind) + '" data-label="' + esc(opt.label) + '"' + (disabled ? " disabled" : "") + ">" + esc(opt.label) + (disabled ? " (agotado)" : "") + "</button>";
      }).join("");
    }
    var sizes = (product.variants && product.variants.sizes) || [];
    var colors = (product.variants && product.variants.colors) || [];
    var variantPickerHtml =
      (sizes.length ? '<div class="mt-5"><p class="text-sm font-medium">Talla</p><div class="mt-2 flex flex-wrap gap-2">' + variantOptionsHtml(sizes, "Talla") + "</div></div>" : "") +
      (colors.length ? '<div class="mt-5"><p class="text-sm font-medium">Color</p><div class="mt-2 flex flex-wrap gap-2">' + variantOptionsHtml(colors, "Color") + "</div></div>" : "");
    var variantScript = (sizes.length || colors.length)
      ? '<script>(function(){var opts=document.querySelectorAll(".hje-variant-opt:not(:disabled)");var waLink=document.querySelector(".hje-wa-consult");var selected={};opts.forEach(function(o){o.addEventListener("click",function(){var kind=o.getAttribute("data-kind");selected[kind]=o.getAttribute("data-label");document.querySelectorAll(".hje-variant-opt[data-kind=\'"+kind+"\']").forEach(function(x){x.classList.remove("border-border","bg-background","hover:bg-muted");x.classList.remove("bg-primary","text-primary-foreground");x.classList.add("border-border","bg-background","hover:bg-muted");});o.classList.remove("border-border","bg-background","hover:bg-muted");o.classList.add("bg-primary","text-primary-foreground");if(waLink){var base=waLink.getAttribute("data-base-text")||"";var extra=Object.keys(selected).map(function(k){return " - "+k+": "+selected[k];}).join("");waLink.setAttribute("href","https://wa.me/' + WHATSAPP_NUMBER + '?text="+encodeURIComponent(base+extra));}});});})();</script>'
      : "";

    var specsHtml = ["acabado", "cuidado", "origen", "garantia"].map(function (key) {
      return '<div class="grid grid-cols-[140px_1fr] gap-4 border-b border-border pb-3"><dt class="capitalize text-muted-foreground">' + key + "</dt><dd>" + esc(product.specifications[key]) + "</dd></div>";
    }).join("");

    var relatedHtml = related.map(renderCard).join("");
    var relatedSectionHtml = relatedHtml
      ? '<section class="grid gap-4 py-10 md:grid-cols-3"><div class="rounded-md border border-border bg-card p-5"><h2 class="font-serif text-2xl">Asesoria personalizada</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Te acompanamos por WhatsApp para confirmar detalles antes de cerrar tu pedido.</p></div><div class="rounded-md border border-border bg-card p-5"><h2 class="font-serif text-2xl">Cambios y revision</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Te acompanamos por WhatsApp para confirmar detalles antes de cerrar tu pedido.</p></div><div class="rounded-md border border-border bg-card p-5"><h2 class="font-serif text-2xl">Compra social segura</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Te acompanamos por WhatsApp para confirmar detalles antes de cerrar tu pedido.</p></div></section>' +
        '<section class="py-12"><div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div class="max-w-2xl"><h2 class="font-serif text-3xl text-foreground sm:text-4xl">Productos relacionados</h2></div></div><div class="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">' + relatedHtml + "</div></section>"
      : "";

    var priceScript =
      '<script>(function(){var els=document.querySelectorAll(".hje-price-recompute");if(!els.length)return;fetch("/joyas/assets/material-prices.json?v="+Date.now()).then(function(r){return r.json();}).then(function(mp){els.forEach(function(el){var material=el.getAttribute("data-material");var weight=parseFloat(el.getAttribute("data-weight"))||0;var perGram=mp[material];if(weight>0&&perGram){var n=Math.round(weight*perGram);el.textContent=n>0?"$"+n.toLocaleString("es-CO"):"Consultar precio";}});}).catch(function(){});})();</script>';

    var fitStyle = photoFitStyle(product);
    var thumbsHtml = product.images.map(function (im, i) {
      return '<button type="button" class="hje-gallery-thumb relative aspect-square overflow-hidden rounded border ' + (i === 0 ? "border-gold-700" : "border-border") + ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-full="' + esc(im.src) + '" data-alt="' + esc(im.alt) + '" aria-label="Ver imagen ' + esc(im.alt) + '"><img alt="" loading="lazy" decoding="async" data-nimg="fill" class="object-cover" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent' + fitStyle + '" src="' + esc(im.thumbnail) + '"/></button>';
    }).join("");
    var thumbsSection = product.images.length > 1 ? '<div class="grid grid-cols-5 gap-2">' + thumbsHtml + "</div>" : "";
    var galleryScript = product.images.length > 1
      ? '<script>(function(){var thumbs=document.querySelectorAll(".hje-gallery-thumb");var main=document.getElementById("hje-gallery-main-img");thumbs.forEach(function(t){t.addEventListener("click",function(){main.setAttribute("src",t.getAttribute("data-full"));main.setAttribute("alt",t.getAttribute("data-alt"));thumbs.forEach(function(x){x.classList.remove("border-gold-700");x.classList.add("border-border");});t.classList.remove("border-border");t.classList.add("border-gold-700");});});})();</script>'
      : "";
    var waBaseText = "Hola, quiero consultar " + product.name + " SKU " + product.sku;

    var tokens = {
      SEO_TITLE: esc(product.seo.title),
      META_DESCRIPTION: esc(product.seo.description),
      CANONICAL_URL: canonical,
      OG_TITLE: esc(product.seo.title),
      OG_DESCRIPTION: esc(product.seo.description),
      OG_IMAGE_URL: ogImageUrl,
      OG_IMAGE_WIDTH: String(img.width),
      OG_IMAGE_HEIGHT: String(img.height),
      OG_IMAGE_ALT: esc(img.alt),
      JSON_LD_PRODUCT: jsonLdProduct,
      JSON_LD_BREADCRUMB: jsonLdBreadcrumb,
      CAT_HREF: "/joyas/" + categorySlug(product.category),
      CAT_NAME: esc(product.category),
      PRODUCT_SLUG: esc(product.slug),
      PRODUCT_NAME: esc(product.name),
      GALLERY_MAIN_SRC: esc(img.src),
      GALLERY_MAIN_ALT: esc(img.alt),
      GALLERY_FIT_STYLE: fitStyle,
      THUMBS_SECTION: thumbsSection,
      PILLS_HTML: pillHtml,
      DATA_MATERIAL: esc(product.material),
      DATA_WEIGHT: String(Number(product.weight) || 0),
      PRICE_TEXT: esc(formatPrice(product.price) || "Consultar precio"),
      DESCRIPTION: esc(product.description),
      VARIANT_PICKER_HTML: variantPickerHtml,
      WA_HREF: waHref(waBaseText),
      WA_BASE_TEXT_ESC: esc(waBaseText),
      INSTAGRAM_URL: esc(product.instagramUrl),
      SPECS_HTML: specsHtml,
      RELATED_SECTION_HTML: relatedSectionHtml,
      GALLERY_SCRIPT: galleryScript,
      VARIANT_SCRIPT: variantScript,
      PRICE_SCRIPT: priceScript
    };

    return tmpl.replace(/\{\{([A-Z_]+)\}\}/g, function (_, key) {
      return key in tokens ? tokens[key] : "";
    });
  }

  // =========================================================================
  // sitemap.xml handling
  // =========================================================================

  function updateSitemap(xmlText, dirtyProducts, deletedSlugs) {
    var doc = new DOMParser().parseFromString(xmlText, "application/xml");
    var urlset = doc.documentElement;
    var now = new Date().toISOString();

    function findUrlNode(loc) {
      var urls = doc.getElementsByTagName("url");
      for (var i = 0; i < urls.length; i++) {
        var locEl = urls[i].getElementsByTagName("loc")[0];
        if (locEl && locEl.textContent === loc) return urls[i];
      }
      return null;
    }

    deletedSlugs.forEach(function (slug) {
      var loc = "https://joyas-colombia.com/producto/" + slug;
      var node = findUrlNode(loc);
      if (node) urlset.removeChild(node);
    });

    dirtyProducts.forEach(function (product) {
      var loc = "https://joyas-colombia.com/producto/" + product.slug;
      var node = findUrlNode(loc);
      if (node) {
        var lastmod = node.getElementsByTagName("lastmod")[0];
        if (lastmod) lastmod.textContent = now;
      } else {
        var urlEl = doc.createElement("url");
        var locEl = doc.createElement("loc");
        locEl.textContent = loc;
        var lastmodEl = doc.createElement("lastmod");
        lastmodEl.textContent = now;
        var changefreqEl = doc.createElement("changefreq");
        changefreqEl.textContent = "weekly";
        var priorityEl = doc.createElement("priority");
        priorityEl.textContent = "0.6";
        urlEl.appendChild(locEl);
        urlEl.appendChild(lastmodEl);
        urlEl.appendChild(changefreqEl);
        urlEl.appendChild(priorityEl);
        urlset.appendChild(urlEl);
      }
    });

    var serialized = new XMLSerializer().serializeToString(doc);
    // XMLSerializer re-emits the source document's own <?xml ...?> prolog
    // when one was present (confirmed empirically - it does NOT strip it,
    // despite that being the commonly assumed behavior), so strip whatever
    // it produced and prepend a single canonical one to guarantee exactly
    // one prolog regardless of what the fetched sitemap.xml looked like.
    serialized = serialized.replace(/^<\?xml[^>]*\?>\s*/, "");
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + serialized;
  }

  // =========================================================================
  // Publish flow (multi-device-safe: fresh-fetch, merge, PUT, retry on 409)
  // =========================================================================

  function logPublish(msg, isError) {
    var el = $("#hje-adm-publish-log");
    el.textContent = msg;
    el.classList.toggle("hje-adm-log-error", !!isError);
  }

  function fetchFreshJson(path) {
    return ghGetFile(path).then(function (file) {
      if (!file) return { data: null, sha: null };
      return { data: JSON.parse(b64DecodeUnicode(file.content)), sha: file.sha };
    });
  }

  function putWithRetry(path, buildText, message, maxRetries) {
    var attempt = 0;
    function tryOnce() {
      attempt++;
      return ghGetFile(path).then(function (file) {
        var sha = file ? file.sha : null;
        var baseData = file ? (path.endsWith(".json") ? JSON.parse(b64DecodeUnicode(file.content)) : b64DecodeUnicode(file.content)) : (path.endsWith(".json") ? [] : "");
        var text = buildText(baseData);
        return ghPutText(path, text, sha, message);
      }).catch(function (err) {
        if (err.status === 409 && attempt < maxRetries) {
          return new Promise(function (resolve) { setTimeout(resolve, Math.pow(2, attempt) * 250); }).then(tryOnce);
        }
        throw err;
      });
    }
    return tryOnce();
  }

  function publish() {
    var btn = $("#hje-adm-publish-btn");
    btn.disabled = true;
    var dirtyList = Object.keys(state.dirty).map(function (slug) { return state.dirty[slug]; });
    var deletedList = Object.keys(state.deleted);

    // publish-time guardrail re-check against a freshly fetched catalog
    logPublish("Verificando cambios...");
    fetchFreshJson("assets/products.json").then(function (freshCatalog) {
      var fresh = freshCatalog.data || [];
      var freshBySlug = {};
      fresh.forEach(function (p) { freshBySlug[p.slug] = p; });

      var dupErrors = [];
      dirtyList.forEach(function (p) {
        fresh.forEach(function (existing) {
          if (existing.slug !== p.slug && deletedList.indexOf(existing.slug) === -1) {
            if (existing.sku === p.sku) dupErrors.push('SKU duplicado: "' + p.sku + '" (' + p.name + ")");
          }
        });
      });
      if (dupErrors.length) {
        logPublish("No se pudo publicar:\n" + dupErrors.join("\n"), true);
        btn.disabled = false;
        return Promise.reject(new Error("guardrail"));
      }

      // 1) upload pending photos first. Most are brand-new unique paths (no
      // conflict to worry about), but a rotated *existing* photo re-uploads
      // to its same path in place - so fetch each path's current sha first
      // (null for a path that doesn't exist yet) rather than assuming null.
      logPublish("Subiendo fotos...");
      var photoUploads = [];
      dirtyList.forEach(function (p) {
        (p.images || []).forEach(function (img) {
          if (!img._pendingPhoto) return;
          photoUploads.push(
            ghGetFile(img._pendingPhotoPath).then(function (existing) {
              return ghPutBlob(img._pendingPhotoPath, img._pendingPhoto.main, existing ? existing.sha : null, "Foto: " + p.name);
            }).then(function () {
              return ghGetFile(img._pendingPhotoThumbPath).then(function (existingThumb) {
                return ghPutBlob(img._pendingPhotoThumbPath, img._pendingPhoto.thumb, existingThumb ? existingThumb.sha : null, "Foto (thumb): " + p.name);
              });
            })
          );
        });
      });

      var finalMergedCatalog = null;
      return Promise.all(photoUploads).then(function () {
        // 2) merge products.json fresh-fetch/merge/PUT with 409 retry
        logPublish("Guardando catalogo...");
        return putWithRetry("assets/products.json", function (baseCatalog) {
          var bySlug = {};
          (baseCatalog || []).forEach(function (p) { bySlug[p.slug] = p; });
          dirtyList.forEach(function (p) {
            var clean = JSON.parse(JSON.stringify(p));
            (clean.images || []).forEach(function (img) {
              delete img._pendingPhoto;
              delete img._pendingPhotoPath;
              delete img._pendingPhotoThumbPath;
            });
            bySlug[p.slug] = clean;
          });
          deletedList.forEach(function (slug) { delete bySlug[slug]; });
          finalMergedCatalog = Object.keys(bySlug).map(function (k) { return bySlug[k]; });
          return JSON.stringify(finalMergedCatalog, null, 2);
        }, dirtyList.length + " producto(s) actualizados, " + deletedList.length + " eliminado(s)", 4);
      }).then(function () {
        // 2b) write JS manifest (window.APP_PRODUCTS) for storefront fast-path
        if (!finalMergedCatalog) return;
        logPublish("Actualizando manifiesto JS...");
        var ts = new Date().toISOString();
        var jsManifest = "/* AUTO-GENERATED — do not edit by hand.\n   Managed by admin.html via the GitHub Contents API.\n   Published: " + ts + " */\nwindow.APP_PRODUCTS = " + JSON.stringify(finalMergedCatalog) + ";";
        return ghGetFile("assets/js/products-data.js").then(function (existing) {
          return ghPutText("assets/js/products-data.js", jsManifest, existing ? existing.sha : null, "Manifiesto JS actualizado");
        });
      });
    }).then(function () {
      // 3) generate/regenerate product pages (fetch template once per publish)
      logPublish("Generando paginas de producto...");
      var allForRelated = displayProducts().filter(function (p) { return deletedList.indexOf(p.slug) === -1; });
      return fetch("/joyas/producto/_template.html?v=" + Date.now()).then(function (r) { return r.text(); }).then(function (tmpl) {
        var pageWrites = dirtyList.map(function (p) {
          var html = generateProductPage(p, allForRelated, tmpl);
          return ghGetFile("producto/" + p.slug + ".html").then(function (existing) {
            return ghPutText("producto/" + p.slug + ".html", html, existing ? existing.sha : null, "Pagina: " + p.name);
          });
        });
        return Promise.all(pageWrites);
      });
    }).then(function () {
      // 4) delete removed product pages
      logPublish("Eliminando productos removidos...");
      var deletions = deletedList.map(function (slug) {
        return ghGetFile("producto/" + slug + ".html").then(function (existing) {
          if (!existing) return;
          return ghDeleteFile("producto/" + slug + ".html", existing.sha, "Eliminado: " + slug);
        });
      });
      return Promise.all(deletions);
    }).then(function () {
      // 5) sitemap.xml
      logPublish("Actualizando sitemap...");
      return putWithRetry("sitemap.xml", function (baseXml) {
        return updateSitemap(baseXml || "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></urlset>", dirtyList, deletedList);
      }, "Sitemap actualizado", 4);
    }).then(function () {
      // 6) sales log (if any sales were registered this session)
      if (!state.sales.length) return;
      logPublish("Registrando ventas...");
      var salesToWrite = state.sales;
      return putWithRetry("assets/sales-log.json", function (baseLog) {
        var list = baseLog || [];
        return JSON.stringify(list.concat(salesToWrite), null, 2);
      }, salesToWrite.length + " venta(s) registradas", 4);
    }).then(function () {
      // 7) change log
      logPublish("Registrando cambios...");
      var summary = dirtyList.length + " producto(s) editados/agregados, " + deletedList.length + " eliminado(s)" + (state.sales.length ? ", " + state.sales.length + " venta(s)" : "");
      var entry = { timestamp: new Date().toISOString(), name: state.adminName || null, summary: summary };
      return putWithRetry("assets/admin-changelog.json", function (baseLog) {
        var list = baseLog || [];
        list.push(entry);
        return JSON.stringify(list, null, 2);
      }, "Registro: " + summary, 4);
    }).then(function () {
      logPublish("Publicado correctamente.");
      state.dirty = {};
      state.deleted = {};
      state.sales = [];
      loadProducts();
      loadChangelog();
    }).catch(function (err) {
      if (err && err.message !== "guardrail") {
        logPublish("Error al publicar: " + err.message + "\nTus cambios locales no se perdieron - puedes intentar publicar de nuevo.", true);
      }
      btn.disabled = false;
    });
  }

  // =========================================================================
  // Change log tab
  // =========================================================================

  function loadChangelog() {
    if (!state.pat) return;
    ghGetFile("assets/admin-changelog.json").then(function (file) {
      var list = file ? JSON.parse(b64DecodeUnicode(file.content)) : [];
      list.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
      var container = $("#hje-adm-changelog-list");
      if (!list.length) {
        container.innerHTML = '<p style="color:#8a7a5f;font-size:0.85rem">Sin cambios registrados todavia.</p>';
        return;
      }
      container.innerHTML = list.map(function (entry) {
        var date = new Date(entry.timestamp).toLocaleString("es-CO");
        return (
          '<div class="hje-adm-changelog-item"><div class="hje-adm-cl-meta">' +
          esc(date) + (entry.name ? " · " + esc(entry.name) : "") +
          '</div><div class="hje-adm-cl-summary">' + esc(entry.summary) + "</div></div>"
        );
      }).join("");
    }).catch(function () {
      $("#hje-adm-changelog-list").innerHTML = '<p style="color:#8a7a5f;font-size:0.85rem">No se pudo cargar el registro.</p>';
    });
  }

  // =========================================================================
  // Sales log tab (real sales, staged via state.sales same as any other
  // pending change - published to assets/sales-log.json alongside the rest
  // of publish()'s steps)
  // =========================================================================

  function renderSalesChart(list) {
    var chartEl = $("#hje-adm-sales-chart");
    if (!chartEl) return;
    var now = new Date();
    var days = [];
    var byDay = {};
    for (var d = 29; d >= 0; d--) {
      var dt = new Date(now);
      dt.setDate(dt.getDate() - d);
      var key = dt.toISOString().slice(0, 10);
      days.push(key);
      byDay[key] = 0;
    }
    list.forEach(function (e) {
      var key = (e.timestamp || "").slice(0, 10);
      if (key in byDay) byDay[key] += Number(e.total) || 0;
    });
    var maxVal = Math.max(1, Math.max.apply(null, days.map(function (k) { return byDay[k]; })));
    var W = 300, H = 80, barW = 8, gap = 2, padTop = 4, axisH = 8;
    var usableH = H - padTop - axisH;
    var bars = days.map(function (key, i) {
      var val = byDay[key];
      var bh = Math.round((val / maxVal) * usableH);
      var x = i * (barW + gap);
      var y = padTop + (usableH - bh);
      var dateLabel = key.slice(5); // MM-DD
      var fill = val > 0 ? "#a8782a" : "#e8ddc8";
      return '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + bh + '" fill="' + fill + '" rx="1"><title>' + dateLabel + ': ' + moneyOrZero(val) + '</title></rect>';
    }).join("");
    var todayLabel = days[days.length - 1].slice(5);
    var oldLabel = days[0].slice(5);
    chartEl.innerHTML =
      '<p style="font-size:0.72rem;color:#8a7a5f;margin-bottom:4px">Ingresos ultimos 30 dias</p>' +
      '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" aria-label="Ingresos 30 dias" style="display:block">' +
      bars +
      '<line x1="0" y1="' + (H - axisH) + '" x2="' + W + '" y2="' + (H - axisH) + '" stroke="#e8ddc8" stroke-width="1"/>' +
      '<text x="0" y="' + H + '" font-size="6" fill="#8a7a5f">' + oldLabel + '</text>' +
      '<text x="' + W + '" y="' + H + '" font-size="6" fill="#8a7a5f" text-anchor="end">' + todayLabel + '</text>' +
      '</svg>';
  }

  function loadSalesLog() {
    if (!state.pat) return;
    ghGetFile("assets/sales-log.json").then(function (file) {
      var list = file ? JSON.parse(b64DecodeUnicode(file.content)) : [];
      list = list.concat(state.sales);
      list.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
      var summary = $("#hje-adm-sales-summary");
      var totalRevenue = list.reduce(function (s, e) { return s + (Number(e.total) || 0); }, 0);
      var cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
      var revenue30 = list.filter(function (e) { return new Date(e.timestamp) >= cutoff30; })
        .reduce(function (s, e) { return s + (Number(e.total) || 0); }, 0);
      summary.innerHTML =
        '<div class="hje-adm-stat"><div class="hje-adm-stat-value">' + list.length + '</div><div class="hje-adm-stat-label">Ventas registradas</div></div>' +
        '<div class="hje-adm-stat hje-adm-stat-gold"><div class="hje-adm-stat-value">' + moneyOrZero(totalRevenue) + '</div><div class="hje-adm-stat-label">Total vendido</div></div>' +
        '<div class="hje-adm-stat hje-adm-stat-gold"><div class="hje-adm-stat-value">' + moneyOrZero(revenue30) + '</div><div class="hje-adm-stat-label">Ultimos 30 dias</div></div>';
      renderSalesChart(list);

      state.salesListCache = list;
      var container = $("#hje-adm-sales-list");
      if (!list.length) {
        container.innerHTML = '<p style="color:#8a7a5f;font-size:0.85rem">Sin ventas registradas todavia.</p>';
        return;
      }
      container.innerHTML = list.map(function (entry, i) {
        var date = new Date(entry.timestamp).toLocaleString("es-CO");
        var pending = state.sales.indexOf(entry) !== -1;
        return (
          '<div class="hje-adm-changelog-item hje-adm-sale-item" data-hje-sale-index="' + i + '"><div class="hje-adm-cl-meta">' +
          esc(date) + " · " + esc(entry.qty) + " x " + esc(entry.name) +
          (pending ? ' <span class="hje-adm-badge hje-adm-badge-warn">Pendiente de publicar</span>' : "") +
          '</div><div class="hje-adm-cl-summary">' +
          moneyOrZero(entry.total) + (entry.buyerName ? " · " + esc(entry.buyerName) : "") +
          " · Wompi: " + esc(entry.wompiRef) + " · Siigo: " + esc(entry.siigoInvoice) +
          "</div></div>"
        );
      }).join("");
      $all(".hje-adm-sale-item", container).forEach(function (row) {
        row.addEventListener("click", function () {
          openSaleDetail(state.salesListCache[parseInt(row.getAttribute("data-hje-sale-index"), 10)]);
        });
      });
    }).catch(function () {
      $("#hje-adm-sales-list").innerHTML = '<p style="color:#8a7a5f;font-size:0.85rem">No se pudo cargar el registro de ventas.</p>';
    });
  }

  // ---------- sale detail modal ----------

  function openSaleDetail(sale) {
    if (!sale) return;
    var product = displayProducts().find(function (p) { return p.slug === sale.slug; });
    var img = product && product.images && product.images[0] ? (product.images[0].thumbnail || product.images[0].src) : "";

    $("#hje-adm-sv-photo").src = img;
    $("#hje-adm-sv-name").textContent = sale.name;
    $("#hje-adm-sv-meta").textContent = product ? (product.category + " · " + product.material) : "Producto no encontrado en el catalogo actual";
    $("#hje-adm-sv-date").textContent = new Date(sale.timestamp).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" });
    $("#hje-adm-sv-qty").textContent = sale.qty;
    $("#hje-adm-sv-unitprice").textContent = moneyOrZero(sale.unitPrice);
    $("#hje-adm-sv-total").textContent = moneyOrZero(sale.total);
    $("#hje-adm-sv-buyer").textContent = sale.buyerName || "No registrado";
    $("#hje-adm-sv-phone").textContent = sale.buyerPhone || "No registrado";
    $("#hje-adm-sv-wompi").textContent = sale.wompiRef;
    $("#hje-adm-sv-siigo").textContent = sale.siigoInvoice;
    $("#hje-adm-sv-admin").textContent = sale.adminName || "No registrado";
    $("#hje-adm-sv-sku").textContent = (product && product.sku) || sale.slug;

    var waLink = $("#hje-adm-sv-wa-link");
    var digits = (sale.buyerPhone || "").replace(/\D/g, "");
    if (digits) {
      var withCountry = digits.length === 10 ? "57" + digits : digits;
      waLink.href = "https://wa.me/" + withCountry + "?text=" + encodeURIComponent("Hola " + (sale.buyerName || "") + ", te escribo por tu compra de " + sale.name);
      waLink.style.display = "inline-flex";
    } else {
      waLink.style.display = "none";
    }

    $("#hje-adm-sv-goto-product").style.display = product ? "" : "none";
    $("#hje-adm-sv-goto-product").dataset.hjeSlug = sale.slug;

    $all(".hje-adm-sv-copy").forEach(function (btn) { btn.classList.remove("hje-adm-sv-copied"); btn.textContent = "Copiar"; });
    $("#hje-adm-sale-view-backdrop").classList.add("hje-show");
  }

  function closeSaleDetail() {
    $("#hje-adm-sale-view-backdrop").classList.remove("hje-show");
  }

  // =========================================================================
  // CSV export / import
  // =========================================================================

  var CSV_FIELDS = ["slug","name","sku","category","material","price","weight","availability","units","featured","popularity","tag","promotion","costoInterno","photoFit","description","instagramUrl"];

  function csvRow(values) {
    return values.map(function (v) {
      var s = String(v == null ? "" : v);
      if (s.indexOf(";") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(";");
  }

  function exportCSV() {
    var products = displayProducts().filter(function (p) { return !state.deleted[p.slug]; });
    var header = csvRow(CSV_FIELDS);
    var rows = products.map(function (p) {
      return csvRow(CSV_FIELDS.map(function (f) { return p[f]; }));
    });
    var csv = "﻿" + [header].concat(rows).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "habibi-eisaa-catalogo-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCSV(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = e.target.result.replace(/^﻿/, "");
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length < 2) { alert("El archivo CSV esta vacio o no tiene datos."); return; }
      var headers = lines[0].split(";").map(function (h) { return h.trim().replace(/^"|"$/g, ""); });
      var imported = 0, skipped = 0;
      for (var i = 1; i < lines.length; i++) {
        var cols = [];
        var cur = "";
        var inQ = false;
        for (var c = 0; c < lines[i].length; c++) {
          var ch = lines[i][c];
          if (ch === '"') {
            if (inQ && lines[i][c+1] === '"') { cur += '"'; c++; }
            else inQ = !inQ;
          } else if (ch === ";" && !inQ) {
            cols.push(cur); cur = "";
          } else {
            cur += ch;
          }
        }
        cols.push(cur);
        var row = {};
        headers.forEach(function (h, j) { row[h] = (cols[j] || "").trim(); });
        if (!row.slug && !row.name) { skipped++; continue; }
        var existing = displayProducts().find(function (p) { return p.slug === row.slug; });
        var base = existing ? JSON.parse(JSON.stringify(existing)) : { id: nextId(), slug: row.slug || slugify(row.name), images: [], specifications: { acabado: "", cuidado: "", origen: "", garantia: "" }, seo: { title: row.name || "", description: "" }, currency: "COP", variants: { sizes: [], colors: [] } };
        CSV_FIELDS.forEach(function (f) {
          if (!(f in row)) return;
          var v = row[f];
          if (f === "price" || f === "weight" || f === "costoInterno" || f === "popularity") base[f] = Number(v) || 0;
          else if (f === "units") base[f] = Number(v) || 0;
          else if (f === "featured" || f === "promotion") base[f] = v === "true" || v === "1";
          else base[f] = v;
        });
        state.dirty[base.slug] = base;
        imported++;
      }
      updatePublishBar();
      renderTable();
      alert("Importacion completada: " + imported + " producto(s) aplicados, " + skipped + " omitidos.\nRevisa y publica los cambios cuando estes listo.");
    };
    reader.readAsText(file, "utf-8");
  }

  // =========================================================================
  // Homepage Manager — hero slides, section videos, site text
  // =========================================================================

  var SECTION_VIDEO_KEYS = ["cadenas", "pulseras", "anillos", "argollas", "aretes", "collares", "dijes"];
  var POSITION_GRID = ["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"];

  function loadHomepageManager() {
    if (state.inicioLoaded) return;
    var heroStatus = $("#hje-adm-inicio-status");
    heroStatus.textContent = "Cargando...";
    heroStatus.style.color = "#8a7a5f";

    Promise.all([
      ghGetFile("assets/js/hero-manifest.js"),
      ghGetFile("assets/js/site-text.js")
    ]).then(function (results) {
      var heroFile = results[0];
      var textFile = results[1];

      // Parse hero-manifest.js — extract JSON from window.HJE_HERO_SLIDES = [...];
      if (heroFile) {
        try {
          var heroText = b64DecodeUnicode(heroFile.content);
          var slidesMatch = heroText.match(/window\.HJE_HERO_SLIDES\s*=\s*(\[[\s\S]*?\]);/);
          var secMatch = heroText.match(/window\.HJE_SECTION_VIDEOS\s*=\s*(\{[\s\S]*?\});/);
          if (slidesMatch) state.heroSlides = JSON.parse(slidesMatch[1]);
          if (secMatch) state.sectionVideos = JSON.parse(secMatch[1]);
        } catch (_) {}
      }

      // Parse site-text.js — extract JSON from window.HJE_SITE_TEXT = {...};
      if (textFile) {
        try {
          var textContent = b64DecodeUnicode(textFile.content);
          var stMatch = textContent.match(/window\.HJE_SITE_TEXT\s*=\s*(\{[\s\S]*?\});/);
          if (stMatch) state.siteText = JSON.parse(stMatch[1]);
        } catch (_) {}
      }

      state.inicioLoaded = true;
      heroStatus.textContent = "";
      renderHeroSlides();
      renderSectionVideos();
      populateSiteTextFields();
    }).catch(function () {
      heroStatus.textContent = "No se pudo cargar la configuracion del inicio.";
      heroStatus.style.color = "#c0392b";
    });
  }

  function renderHeroSlides() {
    var container = $("#hje-adm-hero-slides-container");
    if (!container) return;

    if (state.heroSlides.length === 0) {
      container.innerHTML = '<p style="font-size:0.83rem;color:#a09070;margin:0.5rem 0">Ninguna diapositiva todavia. Agrega una para reemplazar los videos por defecto del hero.</p>';
      $("#hje-adm-hero-add-slide").disabled = false;
      return;
    }

    container.innerHTML = state.heroSlides.map(function (slide, i) {
      var thumbSrc = slide.photo || "";
      var hasVideo = !!slide.video;
      var zoom = Number(slide.zoom) || 1;
      var pos = slide.position || "cc";

      var thumbHtml = thumbSrc
        ? '<img src="' + esc(thumbSrc) + '" alt="Diapositiva ' + (i + 1) + '" />'
        : '<span>Sin foto</span>';

      var posBtns = POSITION_GRID.map(function (p) {
        return '<button type="button" class="hje-adm-pos-btn' + (pos === p ? " hje-active" : "") +
          '" data-hje-slide="' + i + '" data-hje-pos="' + p + '" title="' + p + '"></button>';
      }).join("");

      return (
        '<div class="hje-adm-hero-slide-card" data-hje-slide-card="' + i + '">' +
        '<div class="hje-adm-hero-slide-thumb">' +
        thumbHtml +
        (hasVideo ? '<span class="hje-adm-video-badge">&#9654; video</span>' : "") +
        '</div>' +
        '<div class="hje-adm-hero-slide-controls">' +
        '<div class="hje-adm-hero-slide-header">' +
        '<span class="hje-adm-slide-index">' + (i + 1) + '</span>' +
        '<div class="hje-adm-hero-slide-buttons">' +
        '<button type="button" class="hje-adm-slide-btn hje-adm-slide-up" data-hje-slide="' + i + '"' + (i === 0 ? " disabled" : "") + '>&#8593;</button>' +
        '<button type="button" class="hje-adm-slide-btn hje-adm-slide-down" data-hje-slide="' + i + '"' + (i === state.heroSlides.length - 1 ? " disabled" : "") + '>&#8595;</button>' +
        '<label class="hje-adm-slide-file-label" title="Subir o reemplazar foto">&#8635; Foto<input type="file" accept="image/*" class="hje-adm-hero-photo-input" data-hje-slide="' + i + '" style="display:none"/></label>' +
        (thumbSrc ? '<button type="button" class="hje-adm-slide-btn hje-adm-slide-rotate-photo" data-hje-slide="' + i + '">&#8635; Rotar</button>' : "") +
        '<label class="hje-adm-slide-file-label" title="Subir o reemplazar video">&#9654; Video<input type="file" accept="video/*" class="hje-adm-hero-video-input" data-hje-slide="' + i + '" style="display:none"/></label>' +
        (hasVideo ? '<button type="button" class="hje-adm-slide-btn hje-adm-slide-remove-video" data-hje-slide="' + i + '">&#10005; Video</button>' : "") +
        '<button type="button" class="hje-adm-slide-btn hje-adm-slide-btn-danger hje-adm-slide-remove" data-hje-slide="' + i + '">Quitar</button>' +
        '</div></div>' +
        '<div class="hje-adm-slide-zoom-row">' +
        '<span>Zoom</span>' +
        '<input type="range" min="1" max="2" step="0.05" value="' + zoom.toFixed(2) + '" class="hje-adm-slide-zoom" data-hje-slide="' + i + '" />' +
        '<span class="hje-adm-slide-zoom-val">' + zoom.toFixed(1) + 'x</span>' +
        '</div>' +
        '<div class="hje-adm-position-grid-wrap">' +
        '<span>Punto focal</span>' +
        '<div class="hje-adm-position-grid">' + posBtns + '</div>' +
        '</div>' +
        '</div></div>'
      );
    }).join("");

    $("#hje-adm-hero-add-slide").disabled = state.heroSlides.length >= 5;

    // Bind events on the newly rendered cards
    $all(".hje-adm-slide-up").forEach(function (btn) {
      btn.addEventListener("click", function () { moveHeroSlide(parseInt(btn.getAttribute("data-hje-slide"), 10), -1); });
    });
    $all(".hje-adm-slide-down").forEach(function (btn) {
      btn.addEventListener("click", function () { moveHeroSlide(parseInt(btn.getAttribute("data-hje-slide"), 10), 1); });
    });
    $all(".hje-adm-slide-remove").forEach(function (btn) {
      btn.addEventListener("click", function () { removeHeroSlide(parseInt(btn.getAttribute("data-hje-slide"), 10)); });
    });
    $all(".hje-adm-slide-rotate-photo").forEach(function (btn) {
      btn.addEventListener("click", function () { rotateHeroPhoto(parseInt(btn.getAttribute("data-hje-slide"), 10)); });
    });
    $all(".hje-adm-slide-remove-video").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(btn.getAttribute("data-hje-slide"), 10);
        state.heroSlides[i].video = null;
        state.heroSlides[i].videoRotation = 0;
        delete state.heroPendingVideos[i];
        renderHeroSlides();
      });
    });
    $all(".hje-adm-hero-photo-input").forEach(function (input) {
      input.addEventListener("change", function () {
        var i = parseInt(input.getAttribute("data-hje-slide"), 10);
        if (input.files[0]) {
          state.heroPendingPhotos[i] = input.files[0];
          var url = URL.createObjectURL(input.files[0]);
          var thumb = input.closest(".hje-adm-hero-slide-card").querySelector(".hje-adm-hero-slide-thumb");
          thumb.innerHTML = '<img src="' + esc(url) + '" alt="" />';
        }
        input.value = "";
      });
    });
    $all(".hje-adm-hero-video-input").forEach(function (input) {
      input.addEventListener("change", function () {
        var i = parseInt(input.getAttribute("data-hje-slide"), 10);
        if (input.files[0]) {
          if (input.files[0].size > 60 * 1024 * 1024) {
            alert("El video no puede superar los 60 MB.");
            input.value = "";
            return;
          }
          state.heroPendingVideos[i] = input.files[0];
          var thumb = input.closest(".hje-adm-hero-slide-card").querySelector(".hje-adm-hero-slide-thumb");
          var badge = thumb.querySelector(".hje-adm-video-badge");
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "hje-adm-video-badge";
            thumb.appendChild(badge);
          }
          badge.textContent = "► video";
        }
        input.value = "";
      });
    });
    $all(".hje-adm-slide-zoom").forEach(function (range) {
      range.addEventListener("input", function () {
        var i = parseInt(range.getAttribute("data-hje-slide"), 10);
        var val = parseFloat(range.value);
        state.heroSlides[i].zoom = val;
        var valEl = range.nextElementSibling;
        if (valEl) valEl.textContent = val.toFixed(1) + "x";
      });
    });
    $all(".hje-adm-pos-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(btn.getAttribute("data-hje-slide"), 10);
        var pos = btn.getAttribute("data-hje-pos");
        state.heroSlides[i].position = pos;
        var card = $('[data-hje-slide-card="' + i + '"]');
        if (card) {
          $all(".hje-adm-pos-btn", card).forEach(function (b) { b.classList.remove("hje-active"); });
        }
        btn.classList.add("hje-active");
      });
    });
  }

  function addHeroSlide() {
    if (state.heroSlides.length >= 5) return;
    state.heroSlides.push({ photo: null, video: null, videoRotation: 0, zoom: 1.0, position: "cc" });
    renderHeroSlides();
  }

  function removeHeroSlide(i) {
    state.heroSlides.splice(i, 1);
    // Re-index pending uploads
    var newPhotos = {};
    var newVideos = {};
    Object.keys(state.heroPendingPhotos).forEach(function (k) {
      var idx = parseInt(k, 10);
      if (idx < i) newPhotos[idx] = state.heroPendingPhotos[k];
      else if (idx > i) newPhotos[idx - 1] = state.heroPendingPhotos[k];
    });
    Object.keys(state.heroPendingVideos).forEach(function (k) {
      var idx = parseInt(k, 10);
      if (idx < i) newVideos[idx] = state.heroPendingVideos[k];
      else if (idx > i) newVideos[idx - 1] = state.heroPendingVideos[k];
    });
    state.heroPendingPhotos = newPhotos;
    state.heroPendingVideos = newVideos;
    renderHeroSlides();
  }

  function moveHeroSlide(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= state.heroSlides.length) return;
    var tmp = state.heroSlides[i];
    state.heroSlides[i] = state.heroSlides[j];
    state.heroSlides[j] = tmp;
    // swap pending uploads too
    var tmpP = state.heroPendingPhotos[i];
    state.heroPendingPhotos[i] = state.heroPendingPhotos[j];
    if (state.heroPendingPhotos[i] === undefined) delete state.heroPendingPhotos[i];
    state.heroPendingVideos[j] = tmpP;
    if (state.heroPendingVideos[j] === undefined) delete state.heroPendingVideos[j];
    renderHeroSlides();
  }

  function rotateHeroPhoto(i) {
    var slide = state.heroSlides[i];
    if (!slide || !slide.photo) return;
    var btn = $('[data-hje-slide-card="' + i + '"] .hje-adm-slide-rotate-photo');
    if (btn) { btn.disabled = true; btn.textContent = "Rotando..."; }

    // Fetch the photo, rotate via canvas, mark as pending for upload
    fetch(slide.photo + "?v=" + Date.now())
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(blob);
          var img = new Image();
          img.onload = function () {
            URL.revokeObjectURL(url);
            try {
              var rotated = rotateCanvas90(img, img.naturalWidth, img.naturalHeight);
              rotated.toBlob(function (rotBlob) {
                resolve(rotBlob);
              }, "image/jpeg", 0.88);
            } catch (e) { reject(e); }
          };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("No se pudo cargar")); };
          img.src = url;
        });
      })
      .then(function (rotBlob) {
        // Store as a pending photo File (using same path)
        var file = new File([rotBlob], "rotated.jpg", { type: "image/jpeg" });
        state.heroPendingPhotos[i] = file;
        // Update thumbnail preview
        var previewUrl = URL.createObjectURL(rotBlob);
        var thumb = $('[data-hje-slide-card="' + i + '"] .hje-adm-hero-slide-thumb');
        if (thumb) thumb.innerHTML = '<img src="' + esc(previewUrl) + '" alt="" />';
        if (btn) { btn.disabled = false; btn.textContent = "↻ Rotar"; }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = "↻ Rotar"; }
        alert("No se pudo rotar la foto. Asegurate de que este publicada en el repositorio.");
      });
  }

  function renderSectionVideos() {
    var container = $("#hje-adm-section-videos-container");
    if (!container) return;
    container.innerHTML = SECTION_VIDEO_KEYS.map(function (cat) {
      var sv = state.sectionVideos[cat];
      var hasVideo = sv && sv.video;
      return (
        '<div class="hje-adm-sv-row-item" data-hje-sv-cat="' + cat + '">' +
        '<span class="hje-adm-sv-row-label">' + cat.charAt(0).toUpperCase() + cat.slice(1) + '</span>' +
        '<span class="hje-adm-sv-indicator' + (hasVideo ? "" : " hje-adm-sv-none") + '">' +
        (hasVideo ? "&#9654; Video activo" : "Sin video") + '</span>' +
        '<label class="hje-adm-slide-file-label">Subir video<input type="file" accept="video/*" class="hje-adm-sv-input" data-hje-sv-cat="' + cat + '" style="display:none"/></label>' +
        (hasVideo ? '<button type="button" class="hje-adm-slide-btn hje-adm-slide-btn-danger hje-adm-sv-remove" data-hje-sv-cat="' + cat + '">Quitar</button>' : "") +
        '</div>'
      );
    }).join("");

    $all(".hje-adm-sv-input").forEach(function (input) {
      input.addEventListener("change", function () {
        var cat = input.getAttribute("data-hje-sv-cat");
        if (input.files[0]) {
          if (input.files[0].size > 60 * 1024 * 1024) {
            alert("El video no puede superar los 60 MB.");
            input.value = "";
            return;
          }
          state.sectionVideoPending[cat] = input.files[0];
          var row = $('[data-hje-sv-cat="' + cat + '"]');
          if (row) {
            var ind = row.querySelector(".hje-adm-sv-indicator");
            if (ind) { ind.className = "hje-adm-sv-indicator"; ind.textContent = "► Pendiente de guardar"; }
          }
        }
        input.value = "";
      });
    });
    $all(".hje-adm-sv-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cat = btn.getAttribute("data-hje-sv-cat");
        if (state.sectionVideos[cat]) {
          state.sectionVideos[cat] = null;
          delete state.sectionVideoPending[cat];
        }
        renderSectionVideos();
      });
    });
  }

  function populateSiteTextFields() {
    var t = state.siteText || {};
    var fields = {
      "hje-adm-st-headline": t.heroHeadline || "",
      "hje-adm-st-subheadline": t.heroSubheadline || "",
      "hje-adm-st-cta": t.heroCta || "",
      "hje-adm-st-sec-categories": t.sec_categories || "",
      "hje-adm-st-sec-featured": t.sec_featured || "",
      "hje-adm-st-sec-why": t.sec_why || "",
      "hje-adm-st-sec-testimonials": t.sec_testimonials || "",
      "hje-adm-st-sec-faq": t.sec_faq || ""
    };
    Object.keys(fields).forEach(function (id) {
      var el = $("#" + id);
      if (el) el.value = fields[id];
    });
  }

  function collectSiteTextFields() {
    return {
      heroHeadline: ($("#hje-adm-st-headline").value || "").trim(),
      heroSubheadline: ($("#hje-adm-st-subheadline").value || "").trim(),
      heroCta: ($("#hje-adm-st-cta").value || "").trim(),
      sec_categories: ($("#hje-adm-st-sec-categories").value || "").trim(),
      sec_featured: ($("#hje-adm-st-sec-featured").value || "").trim(),
      sec_why: ($("#hje-adm-st-sec-why").value || "").trim(),
      sec_testimonials: ($("#hje-adm-st-sec-testimonials").value || "").trim(),
      sec_faq: ($("#hje-adm-st-sec-faq").value || "").trim()
    };
  }

  function saveHomepageManifests() {
    var btn = $("#hje-adm-inicio-save");
    var status = $("#hje-adm-inicio-status");
    btn.disabled = true;
    status.style.color = "#8a7a5f";
    status.textContent = "Subiendo archivos...";

    var ts = new Date().toISOString();

    // Collect all pending photo/video uploads as promises
    var photoUploads = Object.keys(state.heroPendingPhotos).map(function (k) {
      var i = parseInt(k, 10);
      var file = state.heroPendingPhotos[i];
      return processPhotoFile(file).then(function (result) {
        var ext = "jpg";
        var path = "assets/hero/hero-photo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + "." + ext;
        // Check if existing slide already has a photo (to overwrite, keeping URL stable)
        var existingPath = state.heroSlides[i] && state.heroSlides[i].photo;
        var uploadPath = existingPath && existingPath.replace(/^\/joyas\//, "") || path;
        return ghGetFile(uploadPath).then(function (existing) {
          return ghPutBlob(uploadPath, result.main, existing ? existing.sha : null,
            "Hero foto diapositiva " + (i + 1));
        }).then(function () {
          state.heroSlides[i] = state.heroSlides[i] || {};
          state.heroSlides[i].photo = "/joyas/" + uploadPath;
          state.heroSlides[i].zoom = state.heroSlides[i].zoom || 1;
          state.heroSlides[i].position = state.heroSlides[i].position || "cc";
          delete state.heroPendingPhotos[i];
        });
      });
    });

    var videoUploads = Object.keys(state.heroPendingVideos).map(function (k) {
      var i = parseInt(k, 10);
      var file = state.heroPendingVideos[i];
      var existingPath = state.heroSlides[i] && state.heroSlides[i].video;
      var uploadPath = existingPath && existingPath.replace(/^\/joyas\//, "") ||
        "assets/hero/hero-video-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + ".mp4";
      return ghGetFile(uploadPath).then(function (existing) {
        return ghPutBlob(uploadPath, file, existing ? existing.sha : null,
          "Hero video diapositiva " + (i + 1));
      }).then(function () {
        state.heroSlides[i] = state.heroSlides[i] || {};
        state.heroSlides[i].video = "/joyas/" + uploadPath;
        delete state.heroPendingVideos[i];
      });
    });

    var sectionVideoUploads = Object.keys(state.sectionVideoPending).map(function (cat) {
      var file = state.sectionVideoPending[cat];
      var existingPath = state.sectionVideos[cat] && state.sectionVideos[cat].video;
      var uploadPath = existingPath && existingPath.replace(/^\/joyas\//, "") ||
        "assets/hero/section-" + cat + ".mp4";
      return ghGetFile(uploadPath).then(function (existing) {
        return ghPutBlob(uploadPath, file, existing ? existing.sha : null,
          "Video seccion " + cat);
      }).then(function () {
        state.sectionVideos[cat] = state.sectionVideos[cat] || {};
        state.sectionVideos[cat].video = "/joyas/" + uploadPath;
        delete state.sectionVideoPending[cat];
      });
    });

    Promise.all(photoUploads.concat(videoUploads).concat(sectionVideoUploads))
      .then(function () {
        status.textContent = "Guardando manifiestos...";
        state.siteText = collectSiteTextFields();

        // Filter out null section videos
        var cleanSectionVideos = {};
        Object.keys(state.sectionVideos).forEach(function (k) {
          if (state.sectionVideos[k] && state.sectionVideos[k].video) {
            cleanSectionVideos[k] = state.sectionVideos[k];
          }
        });

        var heroJs = "/* AUTO-GENERATED — do not edit by hand.\n" +
          "   Managed by admin.html via the GitHub Contents API.\n" +
          "   Published: " + ts + " */\n" +
          "window.HJE_HERO_SLIDES = " + JSON.stringify(state.heroSlides, null, 2) + ";\n" +
          "window.HJE_SECTION_VIDEOS = " + JSON.stringify(cleanSectionVideos, null, 2) + ";\n";

        var siteTextJs = "/* AUTO-GENERATED — do not edit by hand.\n" +
          "   Managed by admin.html via the GitHub Contents API.\n" +
          "   Published: " + ts + " */\n" +
          "window.HJE_SITE_TEXT = " + JSON.stringify(state.siteText, null, 2) + ";\n";

        return Promise.all([
          ghGetFile("assets/js/hero-manifest.js").then(function (f) {
            return ghPutText("assets/js/hero-manifest.js", heroJs, f ? f.sha : null, "Hero manifest actualizado");
          }),
          ghGetFile("assets/js/site-text.js").then(function (f) {
            return ghPutText("assets/js/site-text.js", siteTextJs, f ? f.sha : null, "Texto del sitio actualizado");
          })
        ]);
      })
      .then(function () {
        // Append to changelog
        var entry = {
          timestamp: ts,
          adminName: state.adminName || "Admin",
          action: "edit",
          message: "Inicio actualizado: " + state.heroSlides.length + " diapositivas, texto del sitio guardado"
        };
        return ghGetFile("assets/admin-changelog.json").then(function (f) {
          var list = [];
          if (f) { try { list = JSON.parse(b64DecodeUnicode(f.content)); } catch (_) {} }
          list.unshift(entry);
          return ghPutText("assets/admin-changelog.json", JSON.stringify(list, null, 2), f ? f.sha : null, "Changelog: inicio actualizado");
        });
      })
      .then(function () {
        status.style.color = "#3d6b32";
        status.textContent = "Guardado correctamente. Los cambios se reflejan en el inicio en unos segundos.";
        btn.disabled = false;
        renderHeroSlides();
        renderSectionVideos();
      })
      .catch(function (err) {
        status.style.color = "#c0392b";
        status.textContent = "Error al guardar: " + (err.message || "Intenta de nuevo.");
        btn.disabled = false;
      });
  }

  // =========================================================================
  // Init
  // =========================================================================

  function initTabs() {
    $all(".hje-adm-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $all(".hje-adm-tab").forEach(function (t) { t.classList.remove("hje-active"); });
        $all(".hje-adm-panel").forEach(function (p) { p.classList.remove("hje-show"); });
        tab.classList.add("hje-active");
        $("#hje-adm-panel-" + tab.getAttribute("data-hje-tab")).classList.add("hje-show");
        if (tab.getAttribute("data-hje-tab") === "cambios") loadChangelog();
        if (tab.getAttribute("data-hje-tab") === "ventas") loadSalesLog();
        if (tab.getAttribute("data-hje-tab") === "precios") loadMaterialPrices();
        if (tab.getAttribute("data-hje-tab") === "inicio") loadHomepageManager();
      });
    });
  }

  function init() {
    initGates();
    initTabs();
    initPhotoInput();

    $("#hje-adm-search").addEventListener("input", renderTable);
    $("#hje-adm-filter-category").addEventListener("change", renderTable);
    $("#hje-adm-filter-material").addEventListener("change", renderTable);
    $("#hje-adm-filter-status").addEventListener("change", renderTable);
    $("#hje-adm-new-product-btn").addEventListener("click", openNewForm);
    $("#hje-adm-modal-cancel").addEventListener("click", closeForm);
    $("#hje-adm-product-form").addEventListener("submit", saveForm);
    $("#hje-adm-modal-backdrop").addEventListener("click", function (e) { if (e.target === this) closeForm(); });

    $("#hje-adm-confirm-cancel").addEventListener("click", function () {
      pendingDeleteSlug = null;
      $("#hje-adm-confirm-backdrop").classList.remove("hje-show");
    });
    $("#hje-adm-confirm-delete").addEventListener("click", confirmDelete);
    $("#hje-adm-confirm-backdrop").addEventListener("click", function (e) {
      if (e.target === this) { pendingDeleteSlug = null; this.classList.remove("hje-show"); }
    });

    $("#hje-adm-sizes-add").addEventListener("click", function () { addVariantRow("sizes"); });
    $("#hje-adm-colors-add").addEventListener("click", function () { addVariantRow("colors"); });
    $("#hje-adm-f-category").addEventListener("change", renderSizePresets);
    $("#hje-adm-f-material").addEventListener("change", renderWeightPricing);
    $("#hje-adm-f-weight").addEventListener("input", renderWeightPricing);

    $("#hje-adm-bulk-btn").addEventListener("click", openBulkEditForm);
    $("#hje-adm-bulk-cancel").addEventListener("click", closeBulkEditForm);
    $("#hje-adm-bulk-apply").addEventListener("click", applyBulkEdit);
    $("#hje-adm-bulk-backdrop").addEventListener("click", function (e) { if (e.target === this) closeBulkEditForm(); });

    $("#hje-adm-sale-cancel").addEventListener("click", closeSaleForm);
    $("#hje-adm-sale-form").addEventListener("submit", submitSaleForm);
    $("#hje-adm-sale-done").addEventListener("click", closeSaleForm);
    $("#hje-adm-sale-backdrop").addEventListener("click", function (e) { if (e.target === this) closeSaleForm(); });

    $("#hje-adm-sv-close").addEventListener("click", closeSaleDetail);
    $("#hje-adm-sale-view-backdrop").addEventListener("click", function (e) { if (e.target === this) closeSaleDetail(); });
    $all(".hje-adm-sv-copy").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = $("#" + btn.getAttribute("data-hje-copy-target")).textContent;
        var done = function () {
          btn.textContent = "Copiado";
          btn.classList.add("hje-adm-sv-copied");
          setTimeout(function () { btn.textContent = "Copiar"; btn.classList.remove("hje-adm-sv-copied"); }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          done();
        }
      });
    });
    $("#hje-adm-sv-goto-product").addEventListener("click", function () {
      var slug = this.dataset.hjeSlug;
      closeSaleDetail();
      $all(".hje-adm-tab").forEach(function (t) { t.classList.remove("hje-active"); });
      $all(".hje-adm-panel").forEach(function (p) { p.classList.remove("hje-show"); });
      $(".hje-adm-tab[data-hje-tab='productos']").classList.add("hje-active");
      $("#hje-adm-panel-productos").classList.add("hje-show");
      var product = displayProducts().find(function (p) { return p.slug === slug; });
      if (product) {
        $("#hje-adm-search").value = product.sku;
        renderTable();
      }
    });

    $("#hje-adm-discard-btn").addEventListener("click", function () {
      if (Object.keys(state.dirty).length + Object.keys(state.deleted).length + state.sales.length === 0) return;
      if (window.confirm("¿Descartar todos los cambios sin publicar?")) discardChanges();
    });

    $("#hje-adm-prices-save").addEventListener("click", saveMaterialPrices);

    $("#hje-adm-hero-add-slide").addEventListener("click", addHeroSlide);
    $("#hje-adm-inicio-save").addEventListener("click", saveHomepageManifests);

    $("#hje-adm-csv-export-btn").addEventListener("click", exportCSV);
    $("#hje-adm-csv-import-input").addEventListener("change", function () {
      var file = this.files[0];
      if (file) { importCSV(file); this.value = ""; }
    });

    $("#hje-adm-publish-btn").addEventListener("click", publish);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeForm();
        $("#hje-adm-confirm-backdrop").classList.remove("hje-show");
        closeBulkEditForm();
        $("#hje-adm-sale-backdrop").classList.remove("hje-show");
        closeSaleDetail();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
