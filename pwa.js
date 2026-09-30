/* Progressive web app wiring shared by every page:
   registers the service worker and shows an "Install app" pill on Android
   when Chrome offers the install prompt. */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* Offline support is a bonus; the site works without it. */
      });
    });
  }

  var DISMISS_KEY = 'lh-install-dismissed';
  var deferredPrompt = null;
  var bar = null;

  function dismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function remember() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch (err) {
      /* private mode: just show it again next visit */
    }
  }

  function installed() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || window.navigator.standalone === true;
  }

  function injectStyles() {
    if (document.getElementById('lh-install-styles')) return;
    var style = document.createElement('style');
    style.id = 'lh-install-styles';
    style.textContent = [
      '.lh-install {',
      '  position: fixed;',
      '  z-index: 999;',
      '  right: max(16px, env(safe-area-inset-right));',
      '  bottom: calc(16px + env(safe-area-inset-bottom));',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '  padding: 4px 4px 4px 14px;',
      '  border-radius: 999px;',
      '  background: linear-gradient(145deg, #16324a, #071827);',
      '  box-shadow: 0 14px 32px rgba(6, 21, 35, .38);',
      '  color: #fff;',
      '  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;',
      '  animation: lh-install-in .28s ease-out both;',
      '}',
      '@keyframes lh-install-in { from { opacity: 0; transform: translateY(12px); } }',
      '@media (prefers-reduced-motion: reduce) { .lh-install { animation: none; } }',
      '.lh-install button {',
      '  border: 0;',
      '  background: none;',
      '  color: inherit;',
      '  cursor: pointer;',
      '  -webkit-tap-highlight-color: transparent;',
      '}',
      '.lh-install-action {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 9px;',
      '  padding: 9px 6px;',
      '  font-size: 13px;',
      '  font-weight: 800;',
      '  letter-spacing: .01em;',
      '}',
      '.lh-install-action::before {',
      '  content: "";',
      '  width: 9px;',
      '  height: 9px;',
      '  border-radius: 50%;',
      '  background: #d71920;',
      '  box-shadow: 0 0 0 3px rgba(215, 25, 32, .22);',
      '}',
      '.lh-install-close {',
      '  width: 30px;',
      '  height: 30px;',
      '  border-radius: 50%;',
      '  font-size: 16px;',
      '  line-height: 1;',
      '  color: #9fb2c4;',
      '}',
      '.lh-install-close:hover { background: rgba(255, 255, 255, .1); color: #fff; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function hide() {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
  }

  function show() {
    if (bar || !deferredPrompt || dismissed() || installed()) return;
    injectStyles();

    bar = document.createElement('div');
    bar.className = 'lh-install';

    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'lh-install-action';
    action.textContent = 'Install app';
    action.addEventListener('click', function () {
      var prompt = deferredPrompt;
      if (!prompt) return hide();
      deferredPrompt = null;
      hide();
      prompt.prompt();
      prompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'dismissed') remember();
      }).catch(function () {});
    });

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'lh-install-close';
    close.setAttribute('aria-label', 'Dismiss install prompt');
    close.textContent = '×';
    close.addEventListener('click', function () {
      remember();
      hide();
    });

    bar.appendChild(action);
    bar.appendChild(close);
    document.body.appendChild(bar);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hide();
  });
})();
