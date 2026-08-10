(function () {
  "use strict";

  // Homepage-only: turns the hero's big static photo into a rotating video
  // showcase. Same safety model as store.js/premium.js - additive only (the
  // existing <img> stays in the DOM untouched as the permanent poster/
  // fallback), nothing runs until well after window.load, and it degrades
  // silently to that static photo for reduced-motion, Data Saver, or any
  // playback failure.
  //
  // When window.HJE_HERO_SLIDES (from assets/js/hero-manifest.js) is set and
  // non-empty, slides from that manifest are shown instead of the hardcoded
  // CLIPS below. Each slide can have a photo, an optional video overlay,
  // plus zoom and 9-point position settings.

  if (!/\/(index\.html)?$/.test(window.location.pathname) && window.location.pathname !== "/joyas/" && window.location.pathname !== "/joyas") {
    return;
  }

  var CLIPS = [
    "/joyas/assets/video1_comprimido.mp4",
    "/joyas/assets/video2_comprimido.mp4",
    "/joyas/assets/video3_comprimido.mp4"
  ];
  var CLIP_SECONDS = 7000;
  var CROSSFADE_MS = 700;

  var POS_TO_OBJECT = {
    tl: "0% 0%", tc: "50% 0%", tr: "100% 0%",
    cl: "0% 50%", cc: "50% 50%", cr: "100% 50%",
    bl: "0% 100%", bc: "50% 100%", br: "100% 100%"
  };
  var POS_TO_ORIGIN = {
    tl: "top left", tc: "top center", tr: "top right",
    cl: "left center", cc: "center center", cr: "right center",
    bl: "bottom left", bc: "bottom center", br: "bottom right"
  };

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function isDataSaver() {
    var c = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
    return !!(c && (c.saveData || /^(slow-2g|2g)$/.test(c.effectiveType || "")));
  }

  function findHeroSlot() {
    // the big portrait photo tile in the hero collage - scoped to the hero
    // section specifically so this never matches a product card elsewhere
    var hero = document.querySelector("section.relative.overflow-hidden");
    if (!hero) return null;
    return hero.querySelector(".relative.aspect-\\[4\\/5\\].overflow-hidden.rounded-md.bg-muted.shadow-soft");
  }

  // =========================================================================
  // NEW: manifest-driven slide show (used when HJE_HERO_SLIDES is set)
  // =========================================================================

  function makeVideoEl(src, rotation) {
    var v = document.createElement("video");
    v.src = src;
    v.className = "hje-hero-video";
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.loop = true;
    v.disablePictureInPicture = true;
    if (rotation === 90 || rotation === 270) {
      v.style.transform = "rotate(" + rotation + "deg)";
      v.style.transformOrigin = "50% 50%";
    } else if (rotation === 180) {
      v.style.transform = "rotate(180deg)";
    }
    return v;
  }

  function initManifestSlides(slot, slides) {
    var style = document.createElement("style");
    style.textContent = [
      ".hje-hero-slide{position:absolute;inset:0;opacity:0;transition:opacity " + CROSSFADE_MS + "ms ease;pointer-events:none}",
      ".hje-hero-slide.hje-showing{opacity:1}",
      ".hje-hero-slide-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}",
      ".hje-hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}",
      ".hje-hero-vignette{position:absolute;inset:0;pointer-events:none;background:" +
        "radial-gradient(55% 45% at 100% 0%, rgba(10,7,4,.8) 0%, rgba(10,7,4,.42) 55%, transparent 100%)}"
    ].join("\n");
    document.head.appendChild(style);

    var slideEls = slides.map(function (slide) {
      var div = document.createElement("div");
      div.className = "hje-hero-slide";

      if (slide.photo) {
        var img = document.createElement("img");
        img.src = slide.photo;
        img.className = "hje-hero-slide-img";
        var pos = POS_TO_OBJECT[slide.position] || "50% 50%";
        img.style.objectPosition = pos;
        var zoom = Number(slide.zoom) || 1;
        if (zoom > 1) {
          img.style.transformOrigin = POS_TO_ORIGIN[slide.position] || "center center";
          img.style.transform = "scale(" + zoom + ")";
        }
        div.appendChild(img);
      }

      if (slide.video) {
        var vid = makeVideoEl(slide.video, slide.videoRotation || 0);
        div.appendChild(vid);
      }

      slot.appendChild(div);
      return { el: div, slide: slide };
    });

    var vignette = document.createElement("div");
    vignette.className = "hje-hero-vignette";
    slot.appendChild(vignette);

    var index = 0;
    var failed = false;
    var timer = null;

    function startVideo(slideEl) {
      var vid = slideEl.el.querySelector("video");
      if (vid) vid.play().catch(function () {});
    }

    function stopVideo(slideEl) {
      var vid = slideEl.el.querySelector("video");
      if (vid) vid.pause();
    }

    function showSlide(i) {
      slideEls[i].el.classList.add("hje-showing");
      startVideo(slideEls[i]);
    }

    function hideSlide(i) {
      slideEls[i].el.classList.remove("hje-showing");
      setTimeout(function () { stopVideo(slideEls[i]); }, CROSSFADE_MS + 50);
    }

    function advance() {
      if (failed || slideEls.length < 2) return;
      var next = (index + 1) % slideEls.length;
      showSlide(next);
      hideSlide(index);
      index = next;
      timer = setTimeout(advance, CLIP_SECONDS);
    }

    showSlide(0);
    if (slideEls.length > 1) {
      timer = setTimeout(advance, CLIP_SECONDS);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopVideo(slideEls[index]);
        clearTimeout(timer);
      } else if (!failed) {
        startVideo(slideEls[index]);
        if (slideEls.length > 1) timer = setTimeout(advance, CLIP_SECONDS);
      }
    });
  }

  // =========================================================================
  // ORIGINAL: video-only crossfade (used when HJE_HERO_SLIDES is empty/absent)
  // =========================================================================

  function initVideoClips(slot) {
    var style = document.createElement("style");
    style.textContent = [
      ".hje-hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity " + CROSSFADE_MS + "ms ease;pointer-events:none}",
      ".hje-hero-video.hje-showing{opacity:1}",
      ".hje-hero-vignette{position:absolute;inset:0;pointer-events:none;background:" +
        "radial-gradient(55% 45% at 100% 0%, rgba(10,7,4,.8) 0%, rgba(10,7,4,.42) 55%, transparent 100%)}"
    ].join("\n");
    document.head.appendChild(style);

    var vA = document.createElement("video");
    var vB = document.createElement("video");
    [vA, vB].forEach(function (v) {
      v.className = "hje-hero-video";
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.preload = "auto";
      v.disablePictureInPicture = true;
      slot.appendChild(v);
    });

    var vignette = document.createElement("div");
    vignette.className = "hje-hero-vignette";
    slot.appendChild(vignette);

    var index = 0;
    var front = vA;
    var back = vB;
    var timer = null;
    var failed = false;

    function playSafely(video, src) {
      return new Promise(function (resolve) {
        video.src = src;
        video.currentTime = 0;
        video.play().then(function () { resolve(true); }).catch(function () { resolve(false); });
      });
    }

    function showNext() {
      if (failed) return;
      var nextIndex = (index + 1) % CLIPS.length;
      playSafely(back, CLIPS[nextIndex]).then(function (ok) {
        if (!ok) { failed = true; return; }
        back.classList.add("hje-showing");
        front.classList.remove("hje-showing");
        setTimeout(function () { front.pause(); }, CROSSFADE_MS + 50);
        var tmp = front; front = back; back = tmp;
        index = nextIndex;
        timer = setTimeout(showNext, CLIP_SECONDS);
      });
    }

    playSafely(front, CLIPS[0]).then(function (ok) {
      if (!ok) { front.remove(); back.remove(); vignette.remove(); return; }
      front.classList.add("hje-showing");
      timer = setTimeout(showNext, CLIP_SECONDS);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { front.pause(); back.pause(); }
      else if (!failed) { front.play().catch(function () {}); }
    });
  }

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    if (prefersReducedMotion() || isDataSaver()) return;
    var slot = findHeroSlot();
    if (!slot) return;

    var slides = window.HJE_HERO_SLIDES;
    if (slides && Array.isArray(slides) && slides.length > 0) {
      if (!slot.querySelector(".hje-hero-slide")) {
        initManifestSlides(slot, slides);
      }
    } else {
      if (!slot.querySelector("video")) {
        initVideoClips(slot);
      }
    }
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
