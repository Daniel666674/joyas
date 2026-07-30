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

  var state = {
    products: [],
    editingSlug: null,
    dirty: {},
    deleted: {},
    selected: {}, // slug -> true, for bulk edit
    photos: [], // [{ isNew, main, thumb, width, height, previewUrl, path, mime } | { isNew:false, existingSrc, existingThumb, alt, width, height }]
    sizes: [], // [{ label, units }]
    colors: [], // [{ label, units }]
    pat: null,
    adminName: ""
  };

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
      var priceLabel = formatPrice(p.price) || "Consultar precio";
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
        "</div></div></div>"
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

  function renderStats() {
    var bar = $("#hje-adm-stats-bar");
    if (!bar) return;
    var all = displayProducts().filter(function (p) { return !state.deleted[p.slug]; });
    var counts = { Disponible: 0, "Bajo stock": 0, Agotado: 0 };
    all.forEach(function (p) { counts[stockStatus(p.units)]++; });
    bar.innerHTML =
      '<div class="hje-adm-stat"><div class="hje-adm-stat-value">' + all.length + '</div><div class="hje-adm-stat-label">Productos</div></div>' +
      '<div class="hje-adm-stat"><div class="hje-adm-stat-value">' + counts.Disponible + '</div><div class="hje-adm-stat-label">Disponibles</div></div>' +
      '<div class="hje-adm-stat hje-adm-stat-warn"><div class="hje-adm-stat-value">' + counts["Bajo stock"] + '</div><div class="hje-adm-stat-label">Bajo stock</div></div>' +
      '<div class="hje-adm-stat hje-adm-stat-off"><div class="hje-adm-stat-value">' + counts.Agotado + '</div><div class="hje-adm-stat-label">Agotados</div></div>';
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
    var total = dirtyCount + deletedCount;
    var status = $("#hje-adm-publish-status");
    var btn = $("#hje-adm-publish-btn");
    if (total === 0) {
      status.textContent = "Sin cambios pendientes.";
      btn.disabled = true;
    } else {
      status.textContent = total + " cambio(s) pendiente(s) de publicar.";
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
    logPublish("");
    renderTable();
  }

  // =========================================================================
  // Product-detail page generation
  // =========================================================================
  // Verbatim header/footer/floating-buttons captured from a real Next.js
  // product page (producto/anillo-liso-023.html). Must stay byte-identical
  // to the site's actual header/footer for nav-funnel.js and store.js's
  // selectors to keep working - see CLAUDE.md.

  var PAGE_HEADER =
    '<header class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"><div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"><div class="flex items-center gap-2"><button class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0 lg:hidden" aria-label="Abrir menu" type="button" aria-haspopup="dialog" aria-expanded="false" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-menu h-5 w-5"><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg></button><a class="font-serif text-2xl tracking-wide flex items-center gap-2" href="/joyas"><img src="/joyas/brand/logo-mark.png" alt="Habibi Eisaa" class="h-10 w-10 rounded-full object-cover"/>Habibi Eisaa</a></div><nav class="hidden items-center gap-6 text-sm font-medium lg:flex"><a class="text-muted-foreground transition hover:text-foreground" href="/joyas">Inicio</a><a class="text-muted-foreground transition hover:text-foreground" href="/joyas/shop">Tienda</a><a class="text-muted-foreground transition hover:text-foreground" href="/joyas/collections">Colecciones</a><a class="text-muted-foreground transition hover:text-foreground" href="/joyas/materials">Materiales</a><a class="text-muted-foreground transition hover:text-foreground" href="/joyas/about">Nosotros</a><a class="text-muted-foreground transition hover:text-foreground" href="/joyas/blog">Blog</a><a class="text-muted-foreground transition hover:text-foreground" href="/joyas/contact">Contacto</a></nav><div class="flex items-center gap-1"><button class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Buscar" type="button" aria-haspopup="dialog" aria-expanded="false" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search h-5 w-5"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg></button><button class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Favoritos"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-heart h-5 w-5"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg></button><button class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Carrito"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shopping-bag h-5 w-5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg></button></div></div></header>';

  var PAGE_FOOTER =
    '<footer class="border-t border-border bg-[#f8f3eb] pb-20 md:pb-0"><div class="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8"><div><a class="font-serif text-3xl flex items-center gap-2" href="/joyas"><img src="/joyas/brand/logo-mark.png" alt="Habibi Eisaa" class="h-10 w-10 rounded-full object-cover"/>Habibi Eisaa</a><p class="mt-3 text-sm leading-6 text-muted-foreground">Catalogo colombiano de joyeria para descubrir en Instagram y comprar con asesoria cercana por WhatsApp.</p><div class="mt-4 flex items-center gap-3 text-muted-foreground"><a class="hover:text-foreground" href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-instagram h-5 w-5"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line></svg></a><a class="hover:text-foreground" href="https://wa.me/573001234567" target="_blank" rel="noreferrer" aria-label="WhatsApp"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-5 w-5"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg></a><a class="hover:text-foreground" href="mailto:hola@joyas-colombia.com" aria-label="Email"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mail h-5 w-5"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg></a></div></div><div><p class="font-medium">Categorias</p><ul class="mt-3 space-y-2 text-sm text-muted-foreground"><li><a class="hover:text-foreground" href="/joyas/cadenas">Cadenas</a></li><li><a class="hover:text-foreground" href="/joyas/pulseras">Pulseras</a></li><li><a class="hover:text-foreground" href="/joyas/anillos">Anillos</a></li><li><a class="hover:text-foreground" href="/joyas/argollas">Argollas</a></li><li><a class="hover:text-foreground" href="/joyas/aretes">Aretes</a></li><li><a class="hover:text-foreground" href="/joyas/collares">Collares</a></li></ul></div><div><p class="font-medium">Materiales</p><ul class="mt-3 space-y-2 text-sm text-muted-foreground"><li><a class="hover:text-foreground" href="/joyas/oro-laminado">Oro Laminado</a></li><li><a class="hover:text-foreground" href="/joyas/oro-18k">Oro 18K</a></li><li><a class="hover:text-foreground" href="/joyas/oro-14k">Oro 14K</a></li><li><a class="hover:text-foreground" href="/joyas/oro-10k">Oro 10K</a></li><li><a class="hover:text-foreground" href="/joyas/plata-925">Plata 925</a></li><li><a class="hover:text-foreground" href="/joyas/oro-rosa">Oro Rosa</a></li></ul></div><div><p class="font-medium">Compra social</p><p class="mt-3 text-sm leading-6 text-muted-foreground">Guarda tus favoritas, pide disponibilidad y recibe recomendaciones antes de pagar.</p><a class="mt-4 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4" href="https://wa.me/573001234567">Hablar por WhatsApp</a></div></div></footer>';

  var PAGE_FLOATING =
    '<div class="fixed bottom-4 right-4 z-40 flex flex-col gap-2 md:bottom-6 md:right-6"><a href="tel:+573001234567" class="hidden h-11 w-11 items-center justify-center rounded-full bg-foreground text-background shadow-soft transition hover:scale-105 sm:flex" aria-label="Llamar"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-phone h-5 w-5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></a><a href="https://wa.me/573001234567" class="flex h-12 w-12 items-center justify-center rounded-full bg-[#1f8f54] text-white shadow-soft transition hover:scale-105" aria-label="Abrir WhatsApp"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-6 w-6"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg></a></div><div class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-background/95 text-xs font-medium shadow-soft backdrop-blur md:hidden"><a class="flex h-14 flex-col items-center justify-center gap-1" href="/joyas/shop"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shopping-bag h-4 w-4"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>Catalogo</a><a class="flex h-14 flex-col items-center justify-center gap-1" href="/joyas/shop?q="><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search h-4 w-4"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>Buscar</a><a href="https://wa.me/573001234567" class="flex h-14 flex-col items-center justify-center gap-1 bg-foreground text-background"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-4 w-4"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg>WhatsApp</a></div>';

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
      '<div class="flex items-center justify-between gap-3"><span class="text-sm font-semibold">' + esc(formatPrice(p.price) || "Consultar precio") + '</span><div class="flex items-center gap-1">' +
      '<a href="' + esc(p.instagramUrl || "https://www.instagram.com/") + '" target="_blank" rel="noreferrer" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Ver en Instagram"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-instagram h-4 w-4"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line></svg></a>' +
      '<a href="' + waHref("Hola, quiero consultar " + p.name) + '" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted h-10 w-10 px-0" aria-label="Consultar por WhatsApp"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-4 w-4"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg></a>' +
      "</div></div></div></article>"
    );
  }

  function categorySlug(category) {
    var map = { Cadenas: "cadenas", Pulseras: "pulseras", Anillos: "anillos", Argollas: "argollas", Aretes: "aretes", Collares: "collares", Dijes: "dijes" };
    return map[category] || slugify(category);
  }

  function generateProductPage(product, allProducts) {
    var related = allProducts
      .filter(function (p) { return p.category === product.category && p.slug !== product.slug; })
      .sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); })
      .slice(0, 4);

    var img = product.images[0];
    var canonical = "https://joyas-colombia.com/producto/" + product.slug;
    var offerAvailability = product.availability === "Disponible" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

    var jsonLdStore = '{"@context":"https://schema.org","@type":"JewelryStore","name":"Habibi Eisaa","url":"https://joyas-colombia.com","telephone":"+57 300 123 4567","email":"hola@joyas-colombia.com","address":{"@type":"PostalAddress","addressCountry":"CO"},"sameAs":["https://www.instagram.com/"]}';
    // guards against a product name/description that happens to contain
    // "</script" or an HTML comment marker from breaking out of the <script>
    // tag it's embedded in - low-probability since only the trusted admin
    // enters this data, but a one-line fix
    function safeJsonLd(text) {
      return text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
    }
    var offers = { "@type": "Offer", priceCurrency: product.currency || "COP", availability: offerAvailability, url: canonical };
    if (product.price > 0) offers.price = product.price;
    var jsonLdProduct = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", name: product.name, sku: product.sku,
      image: ["https://joyas-colombia.com/joyas" + img.src.replace(/^\/joyas/, "")],
      description: product.description,
      brand: { "@type": "Brand", name: "Habibi Eisaa" },
      material: product.material, category: product.category,
      offers: offers
    });
    var jsonLdBreadcrumb = JSON.stringify({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: product.category, item: "https://joyas-colombia.com/" + categorySlug(product.category) },
        { "@type": "ListItem", position: 2, name: product.name, item: canonical }
      ]
    });

    var pillHtml = ['category', 'material', 'availability'].map(function (key) {
      var val = key === "availability" ? product.availability : product[key];
      return '<span class="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">' + esc(val) + "</span>";
    }).join("");
    if (product.tag) pillHtml += '<span class="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-gold-700">' + esc(product.tag) + "</span>";
    if (product.promotion) pillHtml += '<span class="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Promocion</span>';

    // Independent size/color axes (not a combinatorial matrix - matches
    // the reference tool this was modeled on). Options at 0 stock render
    // disabled; picking one rewrites the WhatsApp link's href via the
    // inline script below - this page has zero hydration risk (see
    // CLAUDE.md), so a plain inline <script> is the simplest correct fix.
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

    var galleryMainId = "hje-gallery-main-img";
    var fitStyle = photoFitStyle(product);
    var thumbsHtml = product.images.map(function (im, i) {
      return '<button type="button" class="hje-gallery-thumb relative aspect-square overflow-hidden rounded border ' + (i === 0 ? "border-gold-700" : "border-border") + ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-full="' + esc(im.src) + '" data-alt="' + esc(im.alt) + '" aria-label="Ver imagen ' + esc(im.alt) + '"><img alt="" loading="lazy" decoding="async" data-nimg="fill" class="object-cover" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent' + fitStyle + '" src="' + esc(im.thumbnail) + '"/></button>';
    }).join("");
    var galleryScript = product.images.length > 1
      ? '<script>(function(){var thumbs=document.querySelectorAll(".hje-gallery-thumb");var main=document.getElementById("' + galleryMainId + '");thumbs.forEach(function(t){t.addEventListener("click",function(){main.setAttribute("src",t.getAttribute("data-full"));main.setAttribute("alt",t.getAttribute("data-alt"));thumbs.forEach(function(x){x.classList.remove("border-gold-700");x.classList.add("border-border");});t.classList.remove("border-border");t.classList.add("border-gold-700");});});})();</script>'
      : "";
    var waBaseText = "Hola, quiero consultar " + product.name + " SKU " + product.sku;

    var main =
      '<main><div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">' +
      '<script type="application/ld+json">' + safeJsonLd(jsonLdProduct) + "</script>" +
      '<script type="application/ld+json">' + safeJsonLd(jsonLdBreadcrumb) + "</script>" +
      '<nav aria-label="Breadcrumb" class="text-sm text-muted-foreground"><ol class="flex flex-wrap items-center gap-2">' +
      '<li><a class="hover:text-foreground" href="/joyas">Inicio</a></li>' +
      '<li class="flex items-center gap-2"><span aria-hidden="true">/</span><a class="hover:text-foreground" href="/joyas/' + categorySlug(product.category) + '">' + esc(product.category) + "</a></li>" +
      '<li class="flex items-center gap-2"><span aria-hidden="true">/</span><a class="hover:text-foreground" href="/joyas/producto/' + esc(product.slug) + '">' + esc(product.name) + "</a></li>" +
      "</ol></nav>" +
      '<section class="grid gap-10 py-8 lg:grid-cols-[1.05fr_0.95fr]">' +
      '<div class="grid gap-3"><div class="relative aspect-[4/5] overflow-hidden rounded-md bg-muted"><img id="' + galleryMainId + '" alt="' + esc(img.alt) + '" decoding="async" data-nimg="fill" class="object-cover" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent' + fitStyle + '" src="' + esc(img.src) + '"/></div>' +
      (product.images.length > 1 ? '<div class="grid grid-cols-5 gap-2">' + thumbsHtml + "</div>" : "") + "</div>" +
      "<div>" +
      '<div class="flex flex-wrap gap-2">' + pillHtml + "</div>" +
      '<h1 class="mt-5 font-serif text-5xl">' + esc(product.name) + "</h1>" +
      '<p class="mt-3 text-2xl font-semibold">' + esc(formatPrice(product.price) || "Consultar precio") + "</p>" +
      '<p class="mt-5 leading-7 text-muted-foreground">' + esc(product.description) + "</p>" +
      variantPickerHtml +
      '<div class="mt-8 grid gap-3 sm:grid-cols-2">' +
      '<a href="' + waHref(waBaseText) + '" data-base-text="' + esc(waBaseText) + '" class="hje-wa-consult inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-6"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle h-4 w-4"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg>Consultar por WhatsApp</a>' +
      '<a href="' + esc(product.instagramUrl) + '" target="_blank" rel="noreferrer" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-border bg-background hover:bg-muted h-12 px-6"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-instagram h-4 w-4"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line></svg>Ver en Instagram</a>' +
      "</div>" +
      '<div class="mt-8 grid gap-3 border-y border-border py-6 text-sm text-muted-foreground"><p class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-truck h-4 w-4 text-gold-700"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>Envios coordinados en Colombia segun disponibilidad.</p><p class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-check h-4 w-4 text-gold-700"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg>Revision, cuidado y recomendaciones antes de confirmar.</p></div>' +
      '<section class="mt-8"><h2 class="font-serif text-3xl">Especificaciones</h2><dl class="mt-4 grid gap-3 text-sm">' + specsHtml + "</dl></section>" +
      "</div></section>" +
      (relatedHtml
        ? '<section class="grid gap-4 py-10 md:grid-cols-3"><div class="rounded-md border border-border bg-card p-5"><h2 class="font-serif text-2xl">Asesoria personalizada</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Te acompanamos por WhatsApp para confirmar detalles antes de cerrar tu pedido.</p></div><div class="rounded-md border border-border bg-card p-5"><h2 class="font-serif text-2xl">Cambios y revision</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Te acompanamos por WhatsApp para confirmar detalles antes de cerrar tu pedido.</p></div><div class="rounded-md border border-border bg-card p-5"><h2 class="font-serif text-2xl">Compra social segura</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">Te acompanamos por WhatsApp para confirmar detalles antes de cerrar tu pedido.</p></div></section>' +
          '<section class="py-12"><div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div class="max-w-2xl"><h2 class="font-serif text-3xl text-foreground sm:text-4xl">Productos relacionados</h2></div></div><div class="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">' + relatedHtml + "</div></section>"
        : "") +
      '<section class="pb-16"><div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div class="max-w-2xl"><h2 class="font-serif text-3xl text-foreground sm:text-4xl">Vistos recientemente</h2></div></div><div class="text-sm text-muted-foreground"><a class="font-medium text-gold-700 underline-offset-4 hover:underline" href="/joyas/shop">Volver al catalogo</a> <!-- -->para seguir explorando piezas similares.</div></section>' +
      "</div></main>" + galleryScript + variantScript;

    var head =
      "<!doctype html><html lang=\"es-CO\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>" +
      '<link rel="stylesheet" href="/joyas/assets/fonts.css"/>' +
      '<link rel="icon" href="/joyas/brand/favicon-32.png" sizes="32x32"/><link rel="icon" href="/joyas/brand/favicon-16.png" sizes="16x16"/><link rel="apple-touch-icon" href="/joyas/brand/favicon-180.png"/>' +
      '<link rel="stylesheet" href="/joyas/_next/static/css/7c4fa424f19c27d5.css" data-precedence="next"/>' +
      '<link rel="stylesheet" href="/joyas/assets/premium.css"/>' +
      '<meta name="theme-color" content="#f8f3eb"/>' +
      "<title>" + esc(product.seo.title) + "</title>" +
      '<meta name="description" content="' + esc(product.seo.description) + '"/>' +
      '<link rel="canonical" href="' + canonical + '"/>' +
      '<meta property="og:title" content="' + esc(product.seo.title) + '"/><meta property="og:description" content="' + esc(product.seo.description) + '"/><meta property="og:url" content="' + canonical + '"/>' +
      '<meta property="og:image" content="https://joyas-colombia.com/joyas' + img.src.replace(/^\/joyas/, "") + '"/><meta property="og:image:width" content="' + img.width + '"/><meta property="og:image:height" content="' + img.height + '"/><meta property="og:image:alt" content="' + esc(img.alt) + '"/>' +
      '<meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="Habibi Eisaa"/><meta name="twitter:description" content="Catalogo de joyeria colombiana en oro laminado, plata 925, esmeraldas, diamantes y piezas listas para comprar por WhatsApp."/>' +
      '<meta name="twitter:image" content="https://joyas-colombia.com/joyas' + img.src.replace(/^\/joyas/, "") + '"/><meta name="twitter:image:width" content="' + img.width + '"/><meta name="twitter:image:height" content="' + img.height + '"/><meta name="twitter:image:alt" content="' + esc(img.alt) + '"/>' +
      "</head><body>" +
      '<script type="application/ld+json">' + jsonLdStore + "</script>" +
      PAGE_HEADER + main + PAGE_FOOTER + PAGE_FLOATING +
      '<script defer src="/joyas/assets/premium.js"></script>' +
      '<script defer src="/joyas/assets/nav-funnel.js"></script>' +
      '<script defer src="/joyas/assets/store.js"></script>' +
      "</body></html>";

    return head;
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
          return JSON.stringify(Object.keys(bySlug).map(function (k) { return bySlug[k]; }), null, 2);
        }, dirtyList.length + " producto(s) actualizados, " + deletedList.length + " eliminado(s)", 4);
      });
    }).then(function () {
      // 3) generate/regenerate product pages
      logPublish("Generando paginas de producto...");
      var allForRelated = displayProducts().filter(function (p) { return deletedList.indexOf(p.slug) === -1; });
      var pageWrites = dirtyList.map(function (p) {
        var html = generateProductPage(p, allForRelated);
        return ghGetFile("producto/" + p.slug + ".html").then(function (existing) {
          return ghPutText("producto/" + p.slug + ".html", html, existing ? existing.sha : null, "Pagina: " + p.name);
        });
      });
      return Promise.all(pageWrites);
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
      // 6) change log
      logPublish("Registrando cambios...");
      var summary = dirtyList.length + " producto(s) editados/agregados, " + deletedList.length + " eliminado(s)";
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

    $("#hje-adm-bulk-btn").addEventListener("click", openBulkEditForm);
    $("#hje-adm-bulk-cancel").addEventListener("click", closeBulkEditForm);
    $("#hje-adm-bulk-apply").addEventListener("click", applyBulkEdit);
    $("#hje-adm-bulk-backdrop").addEventListener("click", function (e) { if (e.target === this) closeBulkEditForm(); });

    $("#hje-adm-discard-btn").addEventListener("click", function () {
      if (Object.keys(state.dirty).length + Object.keys(state.deleted).length === 0) return;
      if (window.confirm("¿Descartar todos los cambios sin publicar?")) discardChanges();
    });

    $("#hje-adm-publish-btn").addEventListener("click", publish);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeForm();
        $("#hje-adm-confirm-backdrop").classList.remove("hje-show");
        closeBulkEditForm();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
