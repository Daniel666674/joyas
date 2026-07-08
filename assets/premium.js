(function () {
  "use strict";

  // Same rationale as assets/store.js: Next.js hydrates via async chunks with
  // no fixed timing relative to this deferred script, so nothing here touches
  // the DOM until well after `load`. Everything below is purely additive
  // (adds classes / listeners) and never removes or reorders nodes, so even
  // if it ran mid-hydration it would be far lower risk than store.js's DOM
  // insertions — but we keep the same safe timing for consistency.

  function initHeaderElevation() {
    var header = document.querySelector("header.sticky");
    if (!header) return;
    function onScroll() {
      if (window.scrollY > 8) {
        header.classList.add("hje-scrolled");
      } else {
        header.classList.remove("hje-scrolled");
      }
    }
    onScroll();
    var ticking = false;
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          requestAnimationFrame(function () {
            onScroll();
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  function initImageFadeIn() {
    var images = document.querySelectorAll("main img, article img");
    Array.prototype.forEach.call(images, function (img) {
      if (img.complete && img.naturalWidth > 0) {
        return; // already loaded (e.g. from cache) - leave at normal, always-visible default
      }
      img.classList.add("hje-loading");
      var settle = function () {
        img.classList.remove("hje-loading");
        img.classList.add("hje-loaded");
      };
      img.addEventListener("load", settle, { once: true });
      img.addEventListener("error", settle, { once: true }); // never hide a broken image
    });
  }

  function initScrollReveal() {
    if (!("IntersectionObserver" in window)) return;
    var candidates = document.querySelectorAll(
      "article.group, main section h2, main section > div > p.max-w-2xl, " +
        "footer form"
    );
    var toObserve = [];
    var vh = window.innerHeight;
    Array.prototype.forEach.call(candidates, function (el) {
      var rect = el.getBoundingClientRect();
      // Only reveal-animate content that starts below the fold; anything
      // already visible (or above it) stays exactly as rendered, so there is
      // never a flash of hidden above-the-fold content.
      if (rect.top > vh * 0.92) {
        el.classList.add("hje-reveal");
        toObserve.push(el);
      }
    });
    if (!toObserve.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("hje-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    toObserve.forEach(function (el) {
      observer.observe(el);
    });
  }

  function init() {
    initHeaderElevation();
    initImageFadeIn();
    initScrollReveal();
  }

  function deferredInit() {
    setTimeout(init, 400);
  }

  if (document.readyState === "complete") {
    deferredInit();
  } else {
    window.addEventListener("load", deferredInit);
  }
})();
