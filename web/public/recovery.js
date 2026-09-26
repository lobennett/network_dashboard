/* Loaded before the entry module so a stale asset cannot hide the reload action. */
(function () {
  function offerReload(event) {
    if (event) event.preventDefault();
    if (document.getElementById('site-update-notice')) return;
    function show() {
      var panel = document.createElement('section');
      panel.id = 'site-update-notice';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;background:white;color:#2e2d29;border:2px solid #8c1515;padding:16px;max-width:650px;box-shadow:0 3px 12px #0002;font:15px sans-serif';
      var message = document.createElement('p');
      message.textContent = 'The site may have updated while this page was open, or a site asset could not load. Reload to get the current interface. Your selected subject and stage stay in the URL.';
      var button = document.createElement('button');
      button.textContent = 'Reload site';
      button.onclick = function () { location.reload(); };
      panel.append(message, button);
      document.body.append(panel);
    }
    if (document.body) show();
    else window.addEventListener('DOMContentLoaded', show, { once: true });
  }
  window.addEventListener('vite:preloadError', offerReload);
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target.tagName === 'SCRIPT' && target.type === 'module') offerReload(event);
  }, true);
})();
