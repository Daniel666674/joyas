(function () {
  "use strict";

  var STORAGE_KEY = "hje_cookie_consent";
  var BANNER_ID = "hje-cookie-banner";

  function getChoice() { try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; } }
  function setChoice(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch (_) {} }

  function loadAnalytics() {
    if (document.getElementById("hje-ga4-script")) return;
    var s = document.createElement("script");
    s.id = "hje-ga4-script";
    s.src = "https://www.googletagmanager.com/gtag/js?id=G-PLACEHOLDER";
    s.async = true;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", "G-PLACEHOLDER");
  }

  function removeBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function accept() {
    setChoice("accepted");
    removeBanner();
    loadAnalytics();
  }

  function decline() {
    setChoice("declined");
    removeBanner();
  }

  function showBanner() {
    var banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Aviso de cookies");
    banner.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#1a150f;color:#f3ead9;padding:14px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:0.82rem;line-height:1.5;box-shadow:0 -2px 12px rgba(0,0,0,0.3)";
    banner.innerHTML =
      '<p style="flex:1 1 260px;margin:0">Usamos cookies propias y de terceros para analizar el uso del sitio (Google Analytics). Al continuar navegando aceptas nuestra <a href="/joyas/about" style="color:#c9a84c;text-underline-offset:3px">politica de privacidad</a>.</p>' +
      '<div style="display:flex;gap:8px;flex-shrink:0">' +
      '<button id="hje-cookie-decline" style="padding:6px 14px;border:1px solid #c9a84c;background:transparent;color:#c9a84c;border-radius:4px;cursor:pointer;font-size:0.82rem">Solo necesarias</button>' +
      '<button id="hje-cookie-accept" style="padding:6px 14px;background:#c9a84c;color:#1a150f;border:none;border-radius:4px;cursor:pointer;font-size:0.82rem;font-weight:600">Aceptar</button>' +
      '</div>';
    document.body.appendChild(banner);
    document.getElementById("hje-cookie-accept").addEventListener("click", accept);
    document.getElementById("hje-cookie-decline").addEventListener("click", decline);
  }

  var choice = getChoice();
  if (choice === "accepted") {
    loadAnalytics();
  } else if (!choice) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showBanner);
    } else {
      showBanner();
    }
  }
})();
