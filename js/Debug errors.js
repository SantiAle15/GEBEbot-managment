// Captador de errores visual — muestra errores en pantalla (para móvil sin consola)
(function () {
  function box() {
    let b = document.getElementById("dbg-box");
    if (!b) {
      b = document.createElement("div");
      b.id = "dbg-box";
      b.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:999999;background:#c0142c;" +
        "color:#fff;font:12px monospace;padding:10px;white-space:pre-wrap;" +
        "max-height:60vh;overflow:auto;border-bottom:3px solid #fff;";
      (document.body || document.documentElement).appendChild(b);
    }
    return b;
  }
  function log(msg) { box().textContent += msg + "\n─────\n"; }

  window.addEventListener("error", (e) => {
    log("ERROR: " + e.message + "\n@ " + (e.filename||"?").split("/").pop() + ":" + e.lineno);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    log("PROMESA: " + (r && r.message ? r.message : String(r)));
  });

  // Rastrear el flujo del login
  window.__dbg = log;
  window.addEventListener("DOMContentLoaded", () => log("[cargó OK — toca Entrar]"));
})();
