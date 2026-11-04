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
  var POLL_MS = 3000; // simulation / mock backend
  var POLL_MS_LIVE = 5000; // Meshy's docs: poll about every 5 s (each poll is one Meshy request)
  var GIVE_UP_MS = 8 * 60 * 1000;
  var MODEL_FETCH_MS = 90 * 1000; // whole model download through the backend relay
  var CODE_KEY = "hje-ai-code";

  var DOT_COLOR = { oro: "#d9a93b", plata: "#c9ccd1", "oro-rosa": "#d9967f" };
  var SAMPLE_LABEL = { oro: "oro", plata: "plata", "oro-rosa": "oro rosa" };

  // Hand-built, pet-themed example pieces (see models/samples). The camera is
  // framed per piece: the necklace tight on its pendant, the others whole.
  var PIECES = {
    anillo: { label: "anillo de huella", alt: "Anillo de huella de mascota", orbit: "20deg 70deg 90%", target: "auto auto auto" },
    collar: { label: "collar con dije de perro", alt: "Collar con dije de cara de perro", orbit: "0deg 82deg 28%", target: "0m -0.45m 0m" },
    pulsera: { label: "pulsera con dijes", alt: "Pulsera con dijes de hueso, huella y corazón", orbit: "10deg 78deg 100%", target: "auto auto auto" }
  };
  // Base colour of the "Metal" material per choice (standard PBR reflectance values).
  var METAL = {
    oro: [1.0, 0.766, 0.336],
    plata: [0.972, 0.96, 0.915],
    "oro-rosa": [0.957, 0.68, 0.6]
  };
  var MSG = {
    network: "No pudimos conectar con el diseñador. Revisa tu conexión e inténtalo de nuevo.",
    generic: "Algo falló al crear tu diseño. Inténtalo de nuevo en unos minutos.",
    timeout: "Tu diseño tardó más de lo esperado. Inténtalo de nuevo con otra foto.",
    rejected: "No pudimos usar esta imagen. Prueba con otra foto más clara de tu mascota, sin personas ni texto.",
    viewer: "No pudimos mostrar el modelo 3D. Inténtalo de nuevo.",
    paused: "El diseñador está en pausa por ahora. Vuelve a intentarlo más tarde.",
    needPhoto: "Primero sube una foto de tu mascota.",
    photoBusy: "Estamos preparando tu foto. Inténtalo de nuevo en un segundo.",
    needCode: "Escribe el código de demostración para continuar.",
    done: "¡Listo! Gira y haz zoom para verlo.",
    exampleNote: "Este es un ejemplo de muestra: no se generó con tu foto.",
    waitSim: "Puede tardar unos minutos. No cierres esta página.",
    // Meshy's own docs give 75 s to ~3.5 min as typical for this kind of task
    waitLive: "Suele tardar de 2 a 4 minutos: primero diseñamos tu joya y luego la modelamos en 3D. No cierres esta página."
  };

  function $(id) { return document.getElementById(id); }
  function el_q(selector) { return document.querySelector(selector); }

  var el = {
    form: $("hje-ai-form"),
    stage: $("hje-ai-stage"),
    pieces: $("hje-ai-pieces"),
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
    metals: $("hje-ai-metals"),
    modes: el_q(".hje-ai-modes"),
    jewelField: $("hje-ai-jewel-field"),
    jewel: $("hje-ai-jewel"),
    material: $("hje-ai-material"),
    dot: $("hje-ai-dot"),
    style: $("hje-ai-style"),
    codeField: $("hje-ai-code-field"),
    code: $("hje-ai-code"),
    go: $("hje-ai-go"),
    retry: $("hje-ai-retry"),
    example: $("hje-ai-example"),
    waitHint: $("hje-ai-wait-hint"),
    resultText: $("hje-ai-resulttext"),
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
    if (live) return "material"; // real generations always take the metal and the customer's own words
    var checked = el.form.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : "photo";
  }

  function currentPiece() {
    var checked = el.pieces && el.pieces.querySelector('input[name="piece"]:checked');
    return checked && PIECES[checked.value] ? checked.value : "anillo";
  }

  function currentMaterial() {
    return currentMode() === "material" ? el.material.value : "oro";
  }

  function sampleUrl(piece) {
    return sampleBase + "/" + (PIECES[piece] ? piece : "anillo") + ".glb";
  }

  // Recolour the model's "Metal" material (gold / silver / rose gold) without
  // reloading it. Gems and enamel keep their own materials.
  /* ----------------------------------------- metal switch for generated pieces -- */
  // A generated model has its colour baked into a texture, so unlike the hand-built pieces it
  // has no "Metal" material to recolour. Changing the metal means re-tinting that texture here
  // in the browser: read it back from the viewer, keep its light/dark pattern (engraving, enamel,
  // highlights) and swap the hue for the chosen metal. No server, no new generation, no credits.
  var RECOLOR_SIZE = 2048;
  var recolor = null; // { entries: [{ m, base, tinfo, origTex, lin, cache }], key }

  // 8-bit linear -> 8-bit sRGB (the viewer hands textures back linear, canvases are sRGB)
  var SRGB = (function () {
    var lut = new Uint8Array(256);
    for (var i = 0; i < 256; i++) {
      var q = i / 255;
      q = q <= 0.0031308 ? 12.92 * q : 1.055 * Math.pow(q, 1 / 2.4) - 0.055;
      lut[i] = Math.round(Math.max(0, Math.min(1, q)) * 255);
    }
    return lut;
  })();

  function resetRecolor() {
    recolor = null;
    show(el.metals, false);
    paintMetalChips("");
  }

  function paintMetalChips(key) {
    Array.prototype.forEach.call(el.metals.querySelectorAll(".hje-ai-metal"), function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-metal") === key ? "true" : "false");
    });
  }

  // The texture exactly as the model has it (upright, linear 8-bit RGBA).
  function readTexture(texture, size) {
    return texture.source.createThumbnail(size, size).then(function (url) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
          resolve(ctx.getImageData(0, 0, size, size));
        };
        img.onerror = function () { reject(new Error("texture read-back failed")); };
        img.src = url;
      });
    });
  }

  // Same pattern of light and dark, new hue: out = metal * (luminance / mean luminance) ^ 0.8.
  // Dark areas (black enamel, engraving) stay dark, highlights stay bright, the hue becomes the metal's.
  function tintedTexture(linear, metal) {
    var src = linear.data;
    var out = new ImageData(linear.width, linear.height);
    var dst = out.data;
    var sum = 0;
    var count = 0;
    var i;
    for (i = 0; i < src.length; i += 4) {
      if (src[i + 3] < 8) continue;
      sum += 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      count++;
    }
    var mean = Math.max(1, sum / Math.max(1, count));
    for (i = 0; i < src.length; i += 4) {
      dst[i + 3] = src[i + 3];
      var ratio = Math.pow((0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / mean, 0.8);
      for (var k = 0; k < 3; k++) {
        dst[i + k] = SRGB[Math.max(0, Math.min(255, Math.round(metal[k] * 255 * ratio)))];
      }
    }
    var tmp = document.createElement("canvas");
    tmp.width = linear.width;
    tmp.height = linear.height;
    tmp.getContext("2d").putImageData(out, 0, 0);
    var texture = el.viewer.createCanvasTexture();
    var canvas = texture.source.element;
    canvas.width = linear.width;
    canvas.height = linear.height;
    var ctx = canvas.getContext("2d");
    ctx.save();
    ctx.translate(0, linear.height); // canvas textures arrive upside down compared with glTF ones
    ctx.scale(1, -1);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    texture.source.update();
    return texture;
  }

  function prepareRecolor() {
    resetRecolor();
    var model = el.viewer.model;
    if (!model || !model.materials || !model.materials.length || typeof el.viewer.createCanvasTexture !== "function") return;
    var mine = {
      key: "",
      entries: model.materials.map(function (m) {
        var tinfo = m.pbrMetallicRoughness.baseColorTexture;
        return { m: m, base: m.pbrMetallicRoughness.baseColorFactor.slice(), tinfo: tinfo, origTex: tinfo ? tinfo.texture : null, lin: null, cache: {} };
      })
    };
    recolor = mine;
    Promise.all(mine.entries.filter(function (e) { return e.origTex; }).map(function (e) {
      return readTexture(e.origTex, RECOLOR_SIZE).then(function (data) { e.lin = data; });
    })).then(
      function () {
        if (recolor !== mine) return; // another design was loaded meanwhile
        show(el.metals, true);
      },
      function (err) {
        if (window.console && console.warn) console.warn("metal switch unavailable for this model", err && err.message);
        if (recolor === mine) resetRecolor();
      }
    );
  }

  function applyGeneratedMetal(key) {
    if (!recolor) return;
    var metal = METAL[key];
    try {
      recolor.entries.forEach(function (e) {
        var pbr = e.m.pbrMetallicRoughness;
        if (!metal) { // back to the colours Meshy made
          if (e.tinfo && e.origTex) e.tinfo.setTexture(e.origTex);
          pbr.setBaseColorFactor(e.base);
        } else if (e.lin) {
          if (!e.cache[key]) e.cache[key] = tintedTexture(e.lin, metal);
          e.tinfo.setTexture(e.cache[key]);
          pbr.setBaseColorFactor([1, 1, 1, e.base[3]]);
        } else {
          pbr.setBaseColorFactor([metal[0], metal[1], metal[2], e.base[3]]);
        }
      });
      recolor.key = key;
      paintMetalChips(key);
    } catch (err) {
      if (window.console && console.warn) console.warn("metal switch failed", err && err.message);
      resetRecolor();
    }
  }

  Array.prototype.forEach.call(el.metals.querySelectorAll(".hje-ai-metal"), function (btn) {
    btn.addEventListener("click", function () { applyGeneratedMetal(btn.getAttribute("data-metal") || ""); });
  });

  function applyMetal() {
    var model = el.viewer.model;
    if (!model || !model.materials) return;
    var c = METAL[currentMaterial()] || METAL.oro;
    model.materials.forEach(function (m) {
      if (m.name === "Metal") m.pbrMetallicRoughness.setBaseColorFactor([c[0], c[1], c[2], 1]);
    });
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
    },
    // Meshy's file host sends no CORS headers, so the browser may not read the model
    // from there. The backend downloads it and hands it over in pieces (a function
    // cannot answer with more than ~4.5 MB at once). Resolves to a Blob.
    model: function (jobId, code, onProgress) {
      var parts = [];
      var got = 0;
      var aborter = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () { if (aborter) aborter.abort(); }, MODEL_FETCH_MS);
      function next() {
        var headers = {};
        if (code) headers["x-demo-code"] = code;
        return fetch(apiBase + "/api/model?id=" + encodeURIComponent(jobId) + "&offset=" + got, {
          headers: headers,
          signal: aborter ? aborter.signal : undefined
        }).then(function (res) {
          if (!res.ok) throw new UserError(MSG.viewer, "model_http_" + res.status);
          var total = Number(res.headers.get("x-model-total")) || 0;
          if (!total) throw new UserError(MSG.viewer, "model_no_total");
          return res.arrayBuffer().then(function (buf) {
            if (!buf.byteLength) throw new UserError(MSG.viewer, "model_empty");
            parts.push(buf);
            got += buf.byteLength;
            if (onProgress) onProgress(Math.min(1, got / total));
            if (got < total) return next();
            return new Blob(parts, { type: "model/gltf-binary" });
          });
        });
      }
      return next().then(
        function (blob) { clearTimeout(timer); return blob; },
        function (err) { clearTimeout(timer); throw err; }
      );
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
      var id = "sim_" + Date.now() + "_" + (payload.material || "oro") + "_" + flag + "_" + (payload.piece || "anillo");
      return delay(600).then(function () { return { jobId: id }; });
    },
    poll: function (jobId) {
      var parts = jobId.split("_");
      var elapsed = Date.now() - Number(parts[1]);
      var flag = parts[3] || "0";
      var piece = parts[4] || "anillo";
      var progress = Math.max(0, Math.min(100, Math.round((elapsed / SIM_MS) * 100)));
      var state = elapsed < 1500 ? "queued" : "running";
      var job;
      if (flag === "s") job = { state: state, progress: Math.min(progress, 85) };
      else if (flag === "r" && progress >= 40) job = { state: "failed", progress: 40, error: { code: "content_rejected", message: MSG.rejected } };
      else if (flag === "f" && progress >= 60) job = { state: "failed", progress: 60, error: { code: "provider_error", message: MSG.generic } };
      else if (progress >= 100) job = { state: "succeeded", progress: 100, modelUrl: sampleUrl(piece) };
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

  var photoBusy = false; // the chosen file is still being shrunk: generating now would send the previous photo
  function handleFile(file) {
    if (!file) return;
    setFileError("");
    show(el.formError, false);
    leaveRecovery(); // a new photo means a new design, never the recovered one
    photoBusy = true;
    prepareImage(file).then(
      function (dataUri) {
        photoBusy = false;
        photo = { dataUri: dataUri };
        el.preview.src = dataUri;
        show(el.preview, true);
        show(el.dropEmpty, false);
        show(el.dropChange, true);
        el.drop.classList.add("has-photo");
      },
      function (err) {
        photoBusy = false;
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
  // Mode, learned from the backend's /api/health. `pending`: a backend is configured but
  // has not answered yet, so nothing is shown. `live`: it is the real Meshy generator.
  var live = false;
  // The finished model is held as a blob: URL (see transport.model); freed when no longer shown.
  var blobUrl = null;
  function revokeBlob() {
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ } blobUrl = null; }
  }
  // Recovery link: disenador-ia.html?job=<id> re-opens a design that was already paid for
  // (Meshy keeps results ~3 days) without a photo and without spending credits again.
  var resumeId = (function () {
    try {
      var id = new URLSearchParams(window.location.search).get("job") || "";
      return /^[A-Za-z0-9_-]{6,80}$/.test(id) && id.indexOf("ii_") !== 0 ? id : "";
    } catch (e) { return ""; }
  })();
  var IDLE_LABEL = "Crear mi diseño 3D";
  var RESUME_LABEL = "Recuperar mi diseño 3D";
  var resumeNote = $("hje-ai-resume-note");
  if (resumeId) {
    if (el.go) el.go.textContent = RESUME_LABEL;
    show(resumeNote, true);
  }
  // Back to a normal form: a new photo, "Crear otro diseño" or "Intentar de nuevo" all end recovery,
  // and the ?job= part leaves the address so a reload does not bring it back.
  function leaveRecovery() {
    var was = !!resumeId;
    resumeId = "";
    show(resumeNote, false);
    if (was && el.go && !el.go.disabled) el.go.textContent = IDLE_LABEL;
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.has("job")) {
        url.searchParams.delete("job");
        window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      }
    } catch (e) { /* ignore */ }
  }
  var pending = !!apiBase;

  function pollMs() {
    return live ? POLL_MS_LIVE : POLL_MS;
  }

  var RING_LEN = 2 * Math.PI * 52;
  el.ringFg.style.strokeDasharray = String(RING_LEN);

  function paintProgress() {
    var pct = Math.round(shown);
    el.ringFg.style.strokeDashoffset = String(RING_LEN * (1 - shown / 100));
    el.pct.textContent = pct + "%";
    var stage = pct < 15 ? 0 : pct < 70 ? 1 : 2;
    var labels = live
      ? ["Diseñando tu joya…", "Modelando la forma…", "Aplicando material y brillo…"]
      : ["En cola…", "Modelando la forma…", "Aplicando material y brillo…"];
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

  // The badge must never claim "generated with AI" while the hand-built example is on screen.
  var BADGE_LIVE = "Demostración · generado con IA";
  var BADGE_EXAMPLE = "Demostración · ejemplo de muestra";
  var badgeBase = "";
  function syncBadge() {
    if (!badgeBase) return;
    var text = live && state === "example" ? BADGE_EXAMPLE : badgeBase;
    if (el.badge.textContent !== text) el.badge.textContent = text;
  }

  function setState(next) {
    state = next;
    el.stage.setAttribute("data-state", next);
    show(el.working, next === "working" || next === "loading");
    show(el.failure, next === "failed");
    show(el.caption, next === "idle" && !live);
    show(el.resultbar, next === "done" || next === "example");
    el.resultText.textContent = next === "example" ? MSG.exampleNote : MSG.done;
    syncBadge();
    el.go.disabled = next === "working" || next === "loading";
    // the piece can only be changed while idle: it decides what the result will be
    Array.prototype.forEach.call(el.pieces.querySelectorAll("input"), function (input) {
      input.disabled = next !== "idle";
    });
    el.go.textContent = el.go.disabled
      ? (resumeId && next === "loading" ? "Recuperando tu diseño…" : "Creando tu diseño…")
      : (resumeId ? RESUME_LABEL : IDLE_LABEL);
    if (next === "loading") el.stageLabel.textContent = "Preparando la vista 3D…";
  }

  function showSample() {
    // With a real backend there is no fake example to show before a generation.
    if (pending || live) return;
    var piece = currentPiece();
    var url = sampleUrl(piece);
    if (el.viewer.getAttribute("src") !== url) {
      el.viewer.setAttribute("camera-target", PIECES[piece].target);
      el.viewer.setAttribute("camera-orbit", PIECES[piece].orbit);
      el.viewer.setAttribute("alt", PIECES[piece].alt + " en 3D (ejemplo)");
      el.viewer.setAttribute("src", url); // the "load" listener applies the metal
    } else {
      applyMetal();
    }
    el.caption.textContent = "Ejemplo: " + PIECES[piece].label + " en " + SAMPLE_LABEL[currentMaterial()];
  }

  function fail(message) {
    resetRecolor();
    stopTicker();
    clearTimeout(pollTimer);
    busy = false;
    el.failureMsg.textContent = message || MSG.generic;
    show(el.example, live); // live mode: offer a ready-made example so the meeting never stalls
    setState("failed");
    announce(message || MSG.generic);
  }

  // A model generated from a photo has no fixed shape to frame by hand: let the viewer fit it.
  function frameGenerated() {
    el.viewer.setAttribute("camera-target", "auto auto auto");
    el.viewer.setAttribute("camera-orbit", "20deg 75deg 105%");
    el.viewer.setAttribute("alt", "Tu joya generada por IA en 3D");
  }

  // Fallback after a failed generation: the hand-built example ring, clearly labelled.
  function showExample() {
    resetRecolor();
    var p = PIECES.anillo;
    el.viewer.setAttribute("camera-target", p.target);
    el.viewer.setAttribute("camera-orbit", p.orbit);
    el.viewer.setAttribute("alt", p.alt + " en 3D (ejemplo)");
    if (el.viewer.getAttribute("src") !== sampleUrl("anillo")) el.viewer.setAttribute("src", sampleUrl("anillo"));
    setState("example");
    announce(MSG.exampleNote);
  }

  // keepResume: a mistyped demo code must not lose the recovery link.
  function backToIdle(keepResume) {
    resetRecolor();
    revokeBlob();
    if (keepResume !== true) leaveRecovery();
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
    var currentId = jobId; // changes once when the redrawn picture is ready and the 3D model starts
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (Date.now() - startedAt > GIVE_UP_MS) {
          reject(new UserError(MSG.timeout, "timeout"));
          return;
        }
        transport.poll(currentId, code).then(
          function (job) {
            failures = 0;
            if (typeof job.progress === "number") target = Math.max(target, job.progress);
            if (job.nextJobId) currentId = job.nextJobId;
            if (job.state === "succeeded") { resolve({ job: job, jobId: currentId }); return; }
            if (job.state === "failed") {
              reject(new UserError((job.error && job.error.message) || MSG.generic, job.error && job.error.code));
              return;
            }
            pollTimer = setTimeout(tick, pollMs());
          },
          function (err) {
            failures += 1;
            if (failures >= 3 || !isTransient(err)) { reject(err); return; }
            pollTimer = setTimeout(tick, pollMs() * 2);
          }
        );
      })();
    });
  }

  // Puts a model on screen and settles into "done" (or fails) when the viewer reports back.
  function displayModel(url) {
    var settled = false;
    function done(ok) {
      if (settled) return;
      settled = true;
      el.viewer.removeEventListener("load", onLoad);
      el.viewer.removeEventListener("error", onError);
      clearTimeout(guard);
      busy = false;
      if (ok) {
        applyMetal();
        setState("done");
        if (live) prepareRecolor(); else resetRecolor();
        announce("Tu diseño 3D está listo.");
        el.again.focus({ preventScroll: true });
      } else {
        fail(MSG.viewer);
      }
    }
    function onLoad() { done(true); }
    function onError(event) {
      if (window.console && console.warn) console.warn("model-viewer could not show the model", event && event.detail);
      done(false);
    }
    var guard = setTimeout(function () { done(false); }, 30000);

    el.viewer.addEventListener("load", onLoad);
    el.viewer.addEventListener("error", onError);
    if (el.viewer.getAttribute("src") === url && el.viewer.loaded) {
      // Same model already on screen (the simulation reuses the sample), so the
      // viewer won't fire another "load" event: it is ready right now.
      done(true);
    } else {
      if (live) frameGenerated();
      el.viewer.setAttribute("src", url);
    }
  }

  function showResult(job, request) {
    stopTicker();
    shown = 100;
    paintProgress();
    setState("loading");

    if (live && transport.model && request) {
      // Real generations: bring the file through our own backend (see transport.model).
      el.stageLabel.textContent = "Descargando tu modelo…";
      transport.model(request.jobId, request.code, function (fraction) {
        el.stageLabel.textContent = "Descargando tu modelo… " + Math.round(fraction * 100) + "%";
      }).then(
        function (blob) {
          revokeBlob();
          blobUrl = URL.createObjectURL(blob);
          el.stageLabel.textContent = "Preparando la vista 3D…";
          displayModel(blobUrl);
        },
        function (err) {
          if (window.console && console.warn) console.warn("model relay failed, trying the direct link", err && err.code);
          displayModel(job.modelUrl); // last resort: works only if the file host allows our site
        }
      );
      return;
    }
    displayModel(job.modelUrl);
  }

  /* -------------------------------------------------------------- submit -- */

  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    show(el.formError, false);
    setFileError("");

    if (photoBusy) {
      el.formError.textContent = MSG.photoBusy;
      show(el.formError, true);
      return;
    }
    if (!photo && !resumeId) {
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

    var started;
    if (resumeId && !photo && !transport.simulated) {
      started = Promise.resolve({ jobId: resumeId }); // already generated and paid: just fetch it again
    } else {
      var withMaterial = currentMode() === "material";
      var payload = { image: photo.dataUri };
      if (withMaterial) {
        payload.material = el.material.value;
        if (el.style.value.trim()) payload.style = el.style.value.trim();
      }
      if (transport.simulated) payload.piece = currentPiece(); // the simulation picks one of the example pieces
      else if (live) payload.piece = el.jewel.value; // real generations: which jewelry to design from the photo
      started = transport.start(payload, code);
    }

    started.then(
      function (data) {
        if (code) store("set", code);
        target = Math.max(target, 3);
        return pollUntilDone(data.jobId, code).then(function (done) {
          showResult(done.job, { jobId: done.jobId, code: code });
        });
      }
    ).catch(function (err) {
      var message = err instanceof UserError ? err.message : MSG.generic;
      if (err && err.code === "unauthorized") {
        // Wrong demo code: go back to the form instead of showing a dead end.
        backToIdle(true);
        el.formError.textContent = message;
        show(el.formError, true);
        el.code.focus();
        return;
      }
      fail(message);
    });
  });

  el.retry.addEventListener("click", function () { backToIdle(false); });
  el.again.addEventListener("click", function () { backToIdle(false); });
  el.example.addEventListener("click", showExample);

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
  Array.prototype.forEach.call(el.pieces.querySelectorAll('input[name="piece"]'), function (radio) {
    radio.addEventListener("change", function () {
      if (state === "idle") showSample();
    });
  });
  el.viewer.addEventListener("load", applyMetal);

  /* ---------------------------------------------------------------- init -- */

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.viewer.removeAttribute("auto-rotate");
  }
  el.code.value = store("get");
  if (pending) {
    // Talking to a backend: don't download or show an example model until we know
    // whether it is the real generator (then there is nothing fake to show).
    el.stage.classList.add("is-pending");
    el.viewer.removeAttribute("src");
  }
  syncMaterial();
  syncMode();

  // Called once the backend has answered (or failed to): fixes the mode for the session.
  function settleMode(info) {
    pending = false;
    live = !!(info && info.provider === "meshy");
    el.stage.classList.remove("is-pending");
    el.stage.classList.toggle("is-live", live);
    if (live) {
      show(el.pieces, false); // the example pieces make no sense when the result IS the generated model
      show(el.caption, false);
      show(el.modes, false); // photo-only would just copy the animal: the jewelry type is always asked
      show(el.jewelField, true);
      syncMode();
      if (el.steps && el.steps.children[0]) el.steps.children[0].textContent = "Diseñando tu joya";
      el.waitHint.textContent = MSG.waitLive;
    } else {
      el.waitHint.textContent = MSG.waitSim;
      showSample();
    }
  }

  transport.health().then(
    function (info) {
      settleMode(info);
      if (live) {
        badgeBase = BADGE_LIVE;
      } else if (transport.simulated || (info && info.provider === "mock")) {
        badgeBase = transport.simulated
          ? "Demostración · vista previa simulada"
          : "Demostración · resultados de ejemplo";
      }
      if (badgeBase) {
        el.badge.textContent = badgeBase;
        show(el.badge, true);
      }
      show(el.codeField, !!(info && info.requiresCode));
      if (info && (info.enabled === false || info.ok === false)) {
        el.go.disabled = true;
        el.formError.textContent = MSG.paused;
        show(el.formError, true);
      }
    },
    function () { settleMode(null); /* backend unreachable: errors will show up when someone tries to generate */ }
  );
})();
