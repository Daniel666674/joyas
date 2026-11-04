/*
 * Admin panel, tab "Pedidos IA": quote requests that customers send from the AI jewelry designer.
 * Plain JavaScript, no build step. It talks to the designer's backend (apiBase from ai-designer-config.js),
 * which keeps the orders (3D file, photo, notes) in a PRIVATE store; the panel reads them with the admin
 * code (ADMIN_CODE in Vercel), which is asked here and kept only in sessionStorage for this browser tab.
 * Everything customers wrote is put on screen with textContent, never as HTML.
 */
(function () {
  "use strict";

  var cfg = window.HJE_AI_DESIGNER || {};
  var API = String(cfg.apiBase || "").replace(/\/+$/, "");
  var KEY = "hje-orders-code";
  var tab = document.querySelector('.hje-adm-tab[data-hje-tab="pedidos"]');
  var panel = document.getElementById("hje-adm-panel-pedidos");
  if (!tab || !panel) return;

  function $(id) { return document.getElementById(id); }
  var el = {
    gate: $("hje-ao-gate"), code: $("hje-ao-code"), enter: $("hje-ao-enter"), gateError: $("hje-ao-gate-error"),
    main: $("hje-ao-main"), filter: $("hje-ao-filter"), refresh: $("hje-ao-refresh"), lock: $("hje-ao-lock"),
    count: $("hje-ao-count"), error: $("hje-ao-error"), list: $("hje-ao-list"),
    viewer: $("hje-ao-viewer"), viewerTitle: $("hje-ao-viewer-title"), viewerStage: $("hje-ao-viewer-stage"), viewerClose: $("hje-ao-viewer-close")
  };

  var JEWEL = { collar: "Dije para collar", anillo: "Anillo", aretes: "Aretes", pulsera: "Pulsera con dije" };
  var METAL = { oro: "Oro", plata: "Plata", "oro-rosa": "Oro rosa" };
  var STATUS = { nuevo: "Nuevo", cotizado: "Cotizado", "en-produccion": "En producción", entregado: "Entregado", cancelado: "Cancelado" };

  var orders = [];
  var photoUrls = {}; // order id -> blob: URL of its photo (kept so it is only downloaded once)
  var viewerUrl = null;

  function store(op, value) {
    try {
      if (op === "get") return window.sessionStorage.getItem(KEY) || "";
      if (op === "set") window.sessionStorage.setItem(KEY, value);
      if (op === "clear") window.sessionStorage.removeItem(KEY);
    } catch (e) { /* storage blocked: the code is simply asked again */ }
    return "";
  }

  function show(node, visible) { node.hidden = !visible; }

  function h(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k === "className") node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  /* ------------------------------------------------------------------ api -- */

  function request(path, options) {
    var headers = { "x-admin-code": store("get") };
    if (options && options.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, {
      method: (options && options.method) || "GET",
      headers: headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) { return { res: res }; }, function () {
      throw new Error("No se pudo conectar con el servidor de pedidos. Revisa tu conexión.");
    });
  }

  function explain(res, data) {
    if (res.status === 401) return "Código incorrecto.";
    if (res.status === 503) return "Los pedidos todavía no están configurados en Vercel (falta ADMIN_CODE o el almacén Blob privado).";
    return (data && data.error && data.error.message) || "No pudimos completar la acción (" + res.status + ").";
  }

  function json(path, options) {
    return request(path, options).then(function (r) {
      return r.res.json().catch(function () { return null; }).then(function (data) {
        if (!r.res.ok) {
          var err = new Error(explain(r.res, data));
          err.status = r.res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // A stored file, downloaded in pieces (a function cannot answer with more than ~4.5 MB at once).
  function download(id, kind, type) {
    var parts = [];
    var got = 0;
    function next() {
      return request("/api/order-file?id=" + encodeURIComponent(id) + "&kind=" + kind + "&offset=" + got).then(function (r) {
        if (!r.res.ok) throw new Error("No se pudo descargar el archivo (" + r.res.status + ").");
        var total = Number(r.res.headers.get("x-model-total")) || 0;
        return r.res.arrayBuffer().then(function (buf) {
          if (!buf.byteLength || !total) throw new Error("El archivo llegó incompleto.");
          parts.push(buf);
          got += buf.byteLength;
          return got < total ? next() : new Blob(parts, { type: type });
        });
      });
    }
    return next();
  }

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* --------------------------------------------------------------- screens -- */

  function lock(message) {
    store("clear");
    orders = [];
    show(el.main, false);
    show(el.gate, true);
    el.gateError.textContent = message || "";
    show(el.gateError, !!message);
  }

  function setError(message) {
    el.error.textContent = message || "";
    show(el.error, !!message);
  }

  function load() {
    if (!store("get")) { lock(""); return Promise.resolve(); }
    setError("");
    return json("/api/orders").then(
      function (data) {
        orders = (data && data.orders) || [];
        show(el.gate, false);
        show(el.main, true);
        render();
      },
      function (err) {
        // wrong code or orders not set up: back to the gate with the reason; any other problem keeps the list
        if (err.status === 401 || err.status === 503) lock(err.message);
        else { show(el.gate, false); show(el.main, true); setError(err.message); }
      }
    );
  }

  function whatsappText(o) {
    var what = [JEWEL[o.piece] || "", METAL[o.material] || ""].filter(Boolean).join(" en ");
    return "Hola" + (o.name ? " " + o.name : "") + ", te escribimos de Habibi Eisaa por tu pedido " + o.id +
      (what ? " (" + what.toLowerCase() + ")" : "") + ". Ya vimos tu diseño. Es una pieza hecha a mano; te cotizamos: precio, tiempo de entrega y forma de pago.";
  }

  function copy(text, button) {
    function done() { var old = button.textContent; button.textContent = "¡Copiado!"; setTimeout(function () { button.textContent = old; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copia el texto:", text); });
    else window.prompt("Copia el texto:", text);
  }

  function busy(button, text, work) {
    var old = button.textContent;
    button.disabled = true;
    button.textContent = text;
    return work().then(
      function () { button.disabled = false; button.textContent = old; },
      function (err) { button.disabled = false; button.textContent = old; setError(err.message); }
    );
  }

  function openViewer(o) {
    el.viewerTitle.textContent = "Pedido " + o.id + " · " + [JEWEL[o.piece], METAL[o.material]].filter(Boolean).join(" · ");
    el.viewerStage.textContent = "Cargando el modelo 3D…";
    show(el.viewer, true);
    var closed = false;
    el.viewer.__token = {};
    var token = el.viewer.__token;
    if (!customElements.get("model-viewer") && !document.getElementById("hje-ao-mv")) {
      var s = document.createElement("script");
      s.id = "hje-ao-mv";
      s.type = "module";
      s.src = "/joyas/assets/vendor/model-viewer.min.js";
      document.head.appendChild(s);
    }
    download(o.id, "model", "model/gltf-binary").then(function (blob) {
      if (closed || el.viewer.__token !== token || el.viewer.hidden) return;
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      viewerUrl = URL.createObjectURL(blob);
      var mv = document.createElement("model-viewer");
      mv.setAttribute("src", viewerUrl);
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("auto-rotate", "");
      mv.setAttribute("environment-image", "/joyas/assets/studio-env.hdr");
      mv.setAttribute("exposure", "1.1");
      mv.setAttribute("shadow-intensity", "0");
      mv.setAttribute("alt", "Modelo 3D del pedido " + o.id);
      el.viewerStage.textContent = "";
      el.viewerStage.appendChild(mv);
    }, function (err) { el.viewerStage.textContent = err.message; });
    el.viewerClose.onclick = function () { closed = true; closeViewer(); };
  }

  function closeViewer() {
    show(el.viewer, false);
    el.viewer.__token = null;
    el.viewerStage.textContent = "";
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
  }

  function card(o) {
    var when = "";
    try { when = new Date(o.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { when = o.createdAt; }

    var select = h("select", { className: "hje-ao-status", "data-status": o.status, "aria-label": "Estado del pedido " + o.id });
    Object.keys(STATUS).forEach(function (k) {
      var opt = h("option", { value: k, text: STATUS[k] });
      if (k === o.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var wanted = select.value;
      select.disabled = true;
      json("/api/order-status", { method: "POST", body: { id: o.id, status: wanted } }).then(
        function (data) { o.status = data.order.status; o.updatedAt = data.order.updatedAt; select.setAttribute("data-status", o.status); select.disabled = false; render(); },
        function (err) { select.value = o.status; select.disabled = false; setError(err.message); }
      );
    });

    var photo = h("div", { className: "hje-ao-photo", text: o.files && o.files.photo ? "Cargando foto…" : "Sin foto" });
    if (o.files && o.files.photo) {
      var showPhoto = function (url) { photo.textContent = ""; photo.style.backgroundImage = 'url("' + url + '")'; };
      if (photoUrls[o.id]) showPhoto(photoUrls[o.id]);
      else download(o.id, "photo", o.files.photo.type || "image/jpeg").then(
        function (blob) { photoUrls[o.id] = URL.createObjectURL(blob); showPhoto(photoUrls[o.id]); },
        function () { photo.textContent = "No se pudo cargar la foto"; }
      );
    }

    var facts = h("div", { className: "hje-ao-facts" }, [
      h("strong", { text: [JEWEL[o.piece] || "Joya", METAL[o.material]].filter(Boolean).join(" · ") }),
      o.style ? h("p", { text: "Detalles: " + o.style }) : null,
      o.name ? h("p", { text: "Nombre: " + o.name }) : null,
      o.notes ? h("p", { text: "Notas: " + o.notes }) : null,
      h("p", { className: "hje-ao-date", text: "Archivo 3D: " + (Math.round((o.files.model.bytes / 1048576) * 10) / 10) + " MB" })
    ]);

    var view = h("button", { type: "button", className: "hje-adm-btn-primary", text: "Ver en 3D" });
    view.addEventListener("click", function () { openViewer(o); });
    var glb = h("button", { type: "button", className: "hje-adm-btn-outline", text: "Descargar 3D (.glb)" });
    glb.addEventListener("click", function () { busy(glb, "Descargando…", function () { return download(o.id, "model", "model/gltf-binary").then(function (b) { save(b, o.id + ".glb"); }); }); });
    var pic = o.files && o.files.photo ? h("button", { type: "button", className: "hje-adm-btn-outline", text: "Descargar foto" }) : null;
    if (pic) pic.addEventListener("click", function () { busy(pic, "Descargando…", function () { return download(o.id, "photo", o.files.photo.type).then(function (b) { save(b, o.id + (o.files.photo.type === "image/png" ? ".png" : ".jpg")); }); }); });
    var tpl = h("button", { type: "button", className: "hje-adm-btn-outline", text: "Copiar mensaje para WhatsApp" });
    tpl.addEventListener("click", function () { copy(whatsappText(o), tpl); });

    return h("article", { className: "hje-ao-card" }, [
      h("div", { className: "hje-ao-card-head" }, [
        h("div", {}, [h("span", { className: "hje-ao-id", text: o.id }), h("div", { className: "hje-ao-date", text: when })]),
        select
      ]),
      h("div", { className: "hje-ao-body" }, [photo, facts]),
      h("div", { className: "hje-ao-actions" }, [view, glb, pic, tpl])
    ]);
  }

  function render() {
    var wanted = el.filter.value;
    var shown = orders.filter(function (o) { return !wanted || o.status === wanted; });
    el.list.textContent = "";
    el.count.textContent = orders.length ? shown.length + " de " + orders.length + " pedidos" : "";
    if (!shown.length) {
      el.list.appendChild(h("div", { className: "hje-ao-empty", text: orders.length ? "No hay pedidos con ese estado." : "Todavía no hay pedidos. Aparecerán aquí cuando un cliente pida cotizar un diseño." }));
      return;
    }
    shown.forEach(function (o) { el.list.appendChild(card(o)); });
  }

  /* ---------------------------------------------------------------- wiring -- */

  el.enter.addEventListener("click", function () {
    var value = el.code.value.trim();
    if (!value) { el.gateError.textContent = "Escribe el código de pedidos."; show(el.gateError, true); return; }
    store("set", value);
    el.code.value = "";
    show(el.gateError, false);
    load();
  });
  el.code.addEventListener("keydown", function (e) { if (e.key === "Enter") el.enter.click(); });
  el.refresh.addEventListener("click", load);
  el.lock.addEventListener("click", function () { lock(""); });
  el.filter.addEventListener("change", render);
  el.viewer.addEventListener("click", function (e) { if (e.target === el.viewer) closeViewer(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el.viewer.hidden) closeViewer(); });
  tab.addEventListener("click", function () { if (store("get")) load(); });
})();
