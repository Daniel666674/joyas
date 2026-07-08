(function () {
  "use strict";

  // Homepage-only: turns the hero's big static photo into a rotating video
  // showcase. Same safety model as store.js/premium.js - additive only (the
  // existing <img> stays in the DOM untouched as the permanent poster/
  // fallback), nothing runs until well after window.load, and it degrades
  // silently to that static photo for reduced-motion, Data Saver, or any
  // playback failure.

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

  function init() {
    if (prefersReducedMotion() || isDataSaver()) return;
    var slot = findHeroSlot();
    if (!slot || slot.querySelector("video")) return;

    var style = document.createElement("style");
    style.textContent = [
      ".hje-hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity " + CROSSFADE_MS + "ms ease;pointer-events:none}",
      ".hje-hero-video.hje-showing{opacity:1}",
      ".hje-hero-vignette{position:absolute;inset:0;pointer-events:none;background:" +
        /* the source clips are downloaded Instagram reels with the app's own
           watermark (handle + camera icon) burned into the top-right corner;
           this patch sits on top of the general vignette to fade that
           specific corner into the surrounding dark edge rather than leaving
           it stark */
        "radial-gradient(38% 30% at 88% 22%, rgba(10,7,4,.85) 0%, rgba(10,7,4,.5) 55%, transparent 100%)," +
        "radial-gradient(120% 100% at 50% 40%, transparent 55%, rgba(10,7,4,.55) 100%)," +
        "linear-gradient(180deg, rgba(10,7,4,.16), transparent 22%, transparent 72%, rgba(10,7,4,.3))," +
        "linear-gradient(90deg, rgba(10,7,4,.22), transparent 18%, transparent 82%, rgba(10,7,4,.22))}"
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
        video
          .play()
          .then(function () {
            resolve(true);
          })
          .catch(function () {
            resolve(false);
          });
      });
    }

    function showNext() {
      if (failed) return;
      var nextIndex = (index + 1) % CLIPS.length;
      playSafely(back, CLIPS[nextIndex]).then(function (ok) {
        if (!ok) {
          failed = true;
          return;
        }
        back.classList.add("hje-showing");
        front.classList.remove("hje-showing");
        setTimeout(function () {
          front.pause();
        }, CROSSFADE_MS + 50);
        var tmp = front;
        front = back;
        back = tmp;
        index = nextIndex;
        timer = setTimeout(showNext, CLIP_SECONDS);
      });
    }

    playSafely(front, CLIPS[0]).then(function (ok) {
      if (!ok) {
        front.remove();
        back.remove();
        vignette.remove();
        return;
      }
      front.classList.add("hje-showing");
      timer = setTimeout(showNext, CLIP_SECONDS);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        front.pause();
        back.pause();
      } else if (!failed) {
        front.play().catch(function () {});
      }
    });
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
