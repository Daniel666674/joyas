/*
 * AI jewelry designer: page logic. Plain JavaScript (this site has no build
 * step). The page has no Next.js/React on it, so there is no hydration risk.
 *
 * Flow: pick a photo -> shrink it in the browser -> POST it to the backend ->
 * poll for progress -> show the finished model in <model-viewer>.
 * Backend address comes from ai-designer-config.js; when it is empty the page
 * runs a clearly-labelled simulation so it works with no server at all.
 */
(function () {
  "use strict";

  var cfg = window.HJE_AI_DESIGNER || {};
  var apiBase = String(cfg.apiBase || "").replace(/\/+$/, "");
  var sampleBase = String(cfg.sampleBase || "/joyas/models/samples").replace(/\/+$/, "");

  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  var MAX_SIDE = 1024; // photos are shrunk to this before upload (keeps requests small and cheap)
  var MIN_SIDE = 256;
  var POLL_MS = 3000;
  var GIVE_UP_MS = 8 * 60 * 1000;
  var CODE_KEY = "hje-ai-code";

  var DOT_COLOR = { oro: "#d9a93b", plata: "#c9ccd1", "oro-rosa": "#d9967f" };
  var SAMPLE_LABEL = { oro: "oro", plata: "plata", "oro-rosa": "oro rosa" };
  var MSG = {
    network: "No pudimos conectar con el diseñador. Revisa tu conexión e inténtalo de nuevo.",
    generic: "Algo falló al crear tu diseño. Inténtalo de nuevo en unos minutos.",
    timeout: "Tu diseño tardó más de lo esperado. Inténtalo de nuevo con otra foto.",
    rejected: "No pudimos usar esta imagen. Prueba con otra foto más clara de tu mascota, sin personas ni texto.",
    viewer: "No pudimos mostrar el modelo 3D. Inténtalo de nuevo.",
    paused: "El diseñador está en pausa por ahora. Vuelve a intentarlo más tarde.",
    needPhoto: "Primero sube una foto de tu mascota.",
    needCode: "Escribe el código de demostración para continuar."
  };

  function $(id) { return document.getElementById(id); }

  var el = {
    form: $("hje-ai-form"),
    stage: $("hje-ai-stage"),
    viewer: $("hje-ai-viewer"),
    badge: $("hje-ai-badge"),
    caption: $("hje-ai-caption"),
    resultbar: $("hje-ai-resultbar"),
    working: $("hje-ai-working"),
    failure: $("hje-ai-failure"),
    failureMsg: $("hje-ai-failure-msg"),
    ringFg: $("hje-ai-ring-fg"),
    pct: $("hje-ai-pct"),
    stageLabel: $("hje-ai-stage-label"),
    steps: $("hje-ai-steps"),
    drop: $("hje-ai-drop"),
    file: $("hje-ai-file"),
    preview: $("hje-ai-preview"),
    dropEmpty: $("hje-ai-drop-empty"),
    dropChange: $("hje-ai-drop-change"),
    fileError: $("hje-ai-file-error"),
    formError: $("hje-ai-form-error"),
    materialFields: $("hje-ai-material-fields"),
    material: $("hje-ai-material"),
    dot: $("hje-ai-dot"),
    style: $("hje-ai-style"),
    codeField: $("hje-ai-code-field"),
    code: $("hje-ai-code"),
    go: $("hje-ai-go"),
    retry: $("hje-ai-retry"),
    again: $("hje-ai-again"),
    live: $("hje-ai-live")
  };
  if (!el.form || !el.stage || !el.viewer) return;

  /* ------------------------------------------------------------ helpers -- */

  function UserError(message, code) {
    this.message = message;
    this.code = code || "error";
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function store(action, value) {
    try {
      if (action === "get") return window.sessionStorage.getItem(CODE_KEY) || "";
      window.sessionStorage.setItem(CODE_KEY, value);
    } catch (e) { /* storage can be blocked; the page works without it */ }
    return "";
  }

  function announce(text) {
    if (el.live) el.live.textContent = text;
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function currentMode() {
    var checked = el.form.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : "photo";
  }

  function sampleUrl(material) {
    return sampleBase + "/dije-huella-" + (material || "oro") + ".glb";
  }

  /* ---------------------------------------------------------- transports -- */

  // Real backend.
  function remoteRequest(method, path, body, code) {
    var headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (code) headers["x-demo-code"] = code;
    return fetch(apiBase + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(
      function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok) {
            var e = data && data.error;
            throw new UserError((e && e.message) || MSG.generic, (e && e.code) || "http_" + res.status);
          }
          return data;
        });
      },
      function () { throw new UserError(MSG.network, "network"); }
    );
  }

  var remote = {
    simulated: false,
    health: function () { return remoteRequest("GET", "/api/health"); },
    start: function (payload, code) { return remoteRequest("POST", "/api/generate", payload, code); },
    poll: function (jobId, code) {
      return remoteRequest("GET", "/api/status?id=" + encodeURIComponent(jobId), null, code);
    }
  };

  // Built-in simulation: no server, nothing leaves the browser.
  var SIM_MS = 9000;
  var simulation = {
    simulated: true,
    health: function () {
      return Promise.resolve({ ok: true, enabled: true, provider: "simulation", requiresCode: false });
    },
    start: function (payload) {
      var style = payload.style || "";
      var flag = /!rechazar/i.test(style) ? "r" : /!falla/i.test(style) ? "f" : /!lento/i.test(style) ? "s" : "0";
      var id = "sim_" + Date.now() + "_" + (payload.material || "oro") + "_" + flag;
      return delay(600).then(function () { return { jobId: id }; });
    },
    poll: function (jobId) {
      var parts = jobId.split("_");
      var elapsed = Date.now() - Number(parts[1]);
      var material = parts[2] || "oro";
      var flag = parts[3] || "0";
      var progress = Math.max(0, Math.min(100, Math.round((elapsed / SIM_MS) * 100)));
      var state = elapsed < 1500 ? "queued" : "running";
      var job;
      if (flag === "s") job = { state: state, progress: Math.min(progress, 85) };
      else if (flag === "r" && progress >= 40) job = { state: "failed", progress: 40, error: { code: "content_rejected", message: MSG.rejected } };
      else if (flag === "f" && progress >= 60) job = { state: "failed", progress: 60, error: { code: "provider_error", message: MSG.generic } };
      else if (progress >= 100) job = { state: "succeeded", progress: 100, modelUrl: sampleUrl(material) };
      else job = { state: state, progress: progress };
      return Promise.resolve(job);
    }
  };

  var transport = apiBase ? remote : simulation;

  /* ------------------------------------------------------ photo handling -- */

  var photo = null; // { dataUri }

  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
        return loadWithImageElement(file);
      });
    }
    return loadWithImageElement(file);
  }

  function loadWithImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return Promise.reject(new UserError("Usa una foto en formato JPG, PNG o WebP.", "type"));
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Promise.reject(new UserError("La foto pesa más de 5 MB. Elige una más liviana.", "size"));
    }
    return loadBitmap(file).then(
      function (bitmap) {
        var w = bitmap.width || bitmap.naturalWidth;
        var h = bitmap.height || bitmap.naturalHeight;
        if (Math.min(w, h) < MIN_SIDE) {
          throw new UserError("La foto es muy pequeña. Usa una de al menos 256 px por lado.", "small");
        }
        var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // PNGs with transparency would otherwise turn black as JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (bitmap.close) bitmap.close();
        return canvas.toDataURL("image/jpeg", 0.88);
      },
      function () { throw new UserError("No pudimos leer esa foto. Prueba con otra.", "decode"); }
    );
  }

  function setFileError(message) {
    el.fileError.textContent = message || "";
    show(el.fileError, !!message);
  }

  function handleFile(file) {
    if (!file) return;
    setFileError("");
    show(el.formError, false);
    prepareImage(file).then(
      function (dataUri) {
        photo = { dataUri: dataUri };
        el.preview.src = dataUri;
        show(el.preview, true);
        show(el.dropEmpty, false);
        show(el.dropChange, true);
        el.drop.classList.add("has-photo");
      },
      function (err) {
        photo = null;
        el.file.value = "";
        el.preview.removeAttribute("src");
        show(el.preview, false);
        show(el.dropEmpty, true);
        show(el.dropChange, false);
        el.drop.classList.remove("has-photo");
        setFileError(err instanceof UserError ? err.message : MSG.generic);
      }
    );
  }

  el.file.addEventListener("change", function () { handleFile(el.file.files && el.file.files[0]); });
  ["dragenter", "dragover"].forEach(function (name) {
    el.drop.addEventListener(name, function (e) { e.preventDefault(); el.drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (name) {
    el.drop.addEventListener(name, function (e) { e.preventDefault(); el.drop.classList.remove("is-over"); });
  });
  el.drop.addEventListener("drop", function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files[0]) handleFile(files[0]);
  });

  /* ------------------------------------------------------------ stage UI -- */

  var state = "idle";
  var shown = 0;
  var target = 0;
  var ticker = null;
  var pollTimer = null;
  var busy = false;

  var RING_LEN = 2 * Math.PI * 52;
  el.ringFg.style.strokeDasharray = String(RING_LEN);

  function paintProgress() {
    var pct = Math.round(shown);
    el.ringFg.style.strokeDashoffset = String(RING_LEN * (1 - shown / 100));
    el.pct.textContent = pct + "%";
    var stage = pct < 15 ? 0 : pct < 70 ? 1 : 2;
    var labels = ["En cola…", "Modelando la forma…", "Aplicando material y brillo…"];
    if (el.stageLabel.textContent !== labels[stage] && state === "working") el.stageLabel.textContent = labels[stage];
    var items = el.steps.children;
    for (var i = 0; i < items.length; i++) {
      items[i].className = i < stage ? "is-done" : i === stage ? "is-active" : "";
    }
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(function () {
      if (target > shown) shown = Math.min(target, shown + Math.max(0.35, (target - shown) * 0.12));
      paintProgress();
    }, 100);
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function setState(next) {
    state = next;
    el.stage.setAttribute("data-state", next);
    show(el.working, next === "working" || next === "loading");
    show(el.failure, next === "failed");
    show(el.caption, next === "idle");
    show(el.resultbar, next === "done");
    el.go.disabled = next === "working" || next === "loading";
    el.go.textContent = el.go.disabled ? "Creando tu diseño…" : "Crear mi diseño 3D";
    if (next === "loading") el.stageLabel.textContent = "Preparando la vista 3D…";
  }

  function showSample() {
    var material = currentMode() === "material" ? el.material.value : "oro";
    var url = sampleUrl(material);
    if (el.viewer.getAttribute("src") !== url) el.viewer.setAttribute("src", url);
    el.caption.textContent = "Ejemplo: dije de huella en " + SAMPLE_LABEL[material];
  }

  function fail(message) {
    stopTicker();
    clearTimeout(pollTimer);
    busy = false;
    el.failureMsg.textContent = message || MSG.generic;
    setState("failed");
    announce(message || MSG.generic);
  }

  function backToIdle() {
    stopTicker();
    clearTimeout(pollTimer);
    busy = false;
    shown = 0;
    target = 0;
    setState("idle");
    showSample();
  }

  function isTransient(err) {
    var code = err && err.code;
    return code === "network" || code === "busy" || code === "provider_error" || /^http_5/.test(String(code));
  }

  function pollUntilDone(jobId, code) {
    var startedAt = Date.now();
    var failures = 0;
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (Date.now() - startedAt > GIVE_UP_MS) {
          reject(new UserError(MSG.timeout, "timeout"));
          return;
        }
        transport.poll(jobId, code).then(
          function (job) {
            failures = 0;
            if (typeof job.progress === "number") target = Math.max(target, job.progress);
            if (job.state === "succeeded") { resolve(job); return; }
            if (job.state === "failed") {
              reject(new UserError((job.error && job.error.message) || MSG.generic, job.error && job.error.code));
              return;
            }
            pollTimer = setTimeout(tick, POLL_MS);
          },
          function (err) {
            failures += 1;
            if (failures >= 3 || !isTransient(err)) { reject(err); return; }
            pollTimer = setTimeout(tick, POLL_MS * 2);
          }
        );
      })();
    });
  }

  function showResult(job) {
    stopTicker();
    shown = 100;
    paintProgress();
    setState("loading");

    var settled = false;
    function done(ok) {
      if (settled) return;
      settled = true;
      el.viewer.removeEventListener("load", onLoad);
      el.viewer.removeEventListener("error", onError);
      clearTimeout(guard);
      busy = false;
      if (ok) {
        setState("done");
        announce("Tu diseño 3D está listo.");
        el.again.focus({ preventScroll: true });
      } else {
        fail(MSG.viewer);
      }
    }
    function onLoad() { done(true); }
    function onError() { done(false); }
    var guard = setTimeout(function () { done(false); }, 30000);

    el.viewer.addEventListener("load", onLoad);
    el.viewer.addEventListener("error", onError);
    if (el.viewer.getAttribute("src") === job.modelUrl && el.viewer.loaded) {
      // Same model already on screen (the simulation reuses the sample), so the
      // viewer won't fire another "load" event: it is ready right now.
      done(true);
    } else {
      el.viewer.setAttribute("src", job.modelUrl);
    }
  }

  /* -------------------------------------------------------------- submit -- */

  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    show(el.formError, false);
    setFileError("");

    if (!photo) {
      setFileError(MSG.needPhoto);
      el.file.focus();
      return;
    }
    var code = el.code.value.trim();
    if (!el.codeField.hidden && !code) {
      el.formError.textContent = MSG.needCode;
      show(el.formError, true);
      el.code.focus();
      return;
    }

    busy = true;
    shown = 0;
    target = 0;
    el.stageLabel.textContent = "Subiendo tu foto…";
    setState("working");
    paintProgress();
    startTicker();
    announce("Creando tu diseño. Puede tardar unos minutos.");
    if (window.matchMedia && window.matchMedia("(max-width: 959px)").matches) {
      el.stage.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    var withMaterial = currentMode() === "material";
    var payload = { image: photo.dataUri };
    if (withMaterial) {
      payload.material = el.material.value;
      if (el.style.value.trim()) payload.style = el.style.value.trim();
    }

    transport.start(payload, code).then(
      function (data) {
        if (code) store("set", code);
        target = Math.max(target, 3);
        return pollUntilDone(data.jobId, code);
      }
    ).then(showResult).catch(function (err) {
      var message = err instanceof UserError ? err.message : MSG.generic;
      if (err && err.code === "unauthorized") {
        // Wrong demo code: go back to the form instead of showing a dead end.
        backToIdle();
        el.formError.textContent = message;
        show(el.formError, true);
        el.code.focus();
        return;
      }
      fail(message);
    });
  });

  el.retry.addEventListener("click", backToIdle);
  el.again.addEventListener("click", backToIdle);

  /* ------------------------------------------------- mode / material UI -- */

  function syncMode() {
    var withMaterial = currentMode() === "material";
    show(el.materialFields, withMaterial);
    if (state === "idle") showSample();
  }

  function syncMaterial() {
    el.dot.style.background = DOT_COLOR[el.material.value] || DOT_COLOR.oro;
    if (state === "idle") showSample();
  }

  Array.prototype.forEach.call(el.form.querySelectorAll('input[name="mode"]'), function (radio) {
    radio.addEventListener("change", syncMode);
  });
  el.material.addEventListener("change", syncMaterial);

  /* ---------------------------------------------------------------- init -- */

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.viewer.removeAttribute("auto-rotate");
  }
  el.code.value = store("get");
  syncMaterial();
  syncMode();

  transport.health().then(
    function (info) {
      if (transport.simulated || (info && info.provider === "mock")) {
        el.badge.textContent = transport.simulated
          ? "Demostración · vista previa simulada"
          : "Demostración · resultados de ejemplo";
        show(el.badge, true);
      }
      show(el.codeField, !!(info && info.requiresCode));
      if (info && (info.enabled === false || info.ok === false)) {
        el.go.disabled = true;
        el.formError.textContent = MSG.paused;
        show(el.formError, true);
      }
    },
    function () { /* backend unreachable: errors will show up when someone tries to generate */ }
  );
})();
