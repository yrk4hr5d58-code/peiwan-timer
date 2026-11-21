(function () {
  'use strict';

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {
        // 离线缓存失败不影响正常使用。
      });
    });
  }

  var isStandalone = false;
  try {
    isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  } catch (e) {
    isStandalone = window.navigator.standalone === true;
  }
  if (isStandalone) return;

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return;

  var KEY = 'peiwan-pwa-tip-dismissed';
  try {
    if (localStorage.getItem(KEY) === '1') return;
  } catch (e) {
    return;
  }

  window.setTimeout(function () {
    var tip = document.getElementById('pwaTip');
    if (!tip) return;
    tip.hidden = false;
    var close = document.getElementById('pwaTipClose');
    if (close) {
      close.addEventListener('click', function () {
        tip.hidden = true;
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
      });
    }
  }, 1200);
})();
