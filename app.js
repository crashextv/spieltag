'use strict';

// Versionsnummer der App – wird bei jeder Etappe erhöht.
const APP_VERSION = '1 (Etappe 1: Grundgerüst)';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('btn-back');

// ---------- Seiten ----------

const pages = {
  start: {
    title: 'Spieltag',
    render() {
      view.innerHTML = `
        <div class="menu">
          ${menuBtn('kader', '👕', 'Kader', 'Spieler anlegen und ändern')}
          ${menuBtn('spiel', '⚽', 'Neues Spiel', 'Aufstellung und los geht’s')}
          ${menuBtn('archiv', '📋', 'Archiv', 'Beendete Spiele und Torschützen')}
          ${menuBtn('sicherung', '💾', 'Sicherung', 'Daten sichern und wiederherstellen')}
        </div>
        <div class="status" id="status">Prüfe …</div>
      `;
      view.querySelectorAll('[data-go]').forEach(b =>
        b.addEventListener('click', () => go(b.dataset.go)));
      updateStatus();
    }
  },
  kader:     placeholder('Kader', '👕', 2),
  spiel:     placeholder('Neues Spiel', '⚽', 3),
  archiv:    placeholder('Archiv', '📋', 8),
  sicherung: placeholder('Sicherung', '💾', 8),
};

function menuBtn(page, sym, label, hint) {
  return `<button class="menu-btn" data-go="${page}">
    <span class="sym">${sym}</span>
    <span>${label}<small>${hint}</small></span>
  </button>`;
}

function placeholder(title, sym, etappe) {
  return {
    title,
    render() {
      view.innerHTML = `<div class="placeholder">
        <div class="sym">${sym}</div>
        <p>Dieser Bereich kommt in <b>Etappe ${etappe}</b>.</p>
      </div>`;
    }
  };
}

// ---------- Navigation (Zurück-Taste von Android funktioniert) ----------

function go(page) {
  location.hash = page === 'start' ? '' : page;
}

function show() {
  const name = location.hash.slice(1) || 'start';
  const page = pages[name] || pages.start;
  titleEl.textContent = page.title;
  backBtn.hidden = name === 'start';
  page.render();
  view.scrollTop = 0;
}

backBtn.addEventListener('click', () => history.back());
window.addEventListener('hashchange', show);

// ---------- Statusanzeige ----------

async function updateStatus() {
  const el = document.getElementById('status');
  if (!el) return;

  const offlineReady = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  let persistent = false;
  if (navigator.storage && navigator.storage.persisted) {
    try { persistent = await navigator.storage.persisted(); } catch (e) {}
  }

  el.innerHTML = `
    <div>Offline nutzbar: ${offlineReady ? '<span class="ok">ja ✓</span>' : '<span class="warn">noch nicht – Seite einmal neu laden</span>'}</div>
    <div>Als App gestartet: ${installed ? '<span class="ok">ja ✓</span>' : '<span class="warn">nein (im Browser)</span>'}</div>
    <div>Daten dauerhaft geschützt: ${persistent ? '<span class="ok">ja ✓</span>' : '<span class="warn">noch nicht</span>'}</div>
    <div>Internet: ${navigator.onLine ? 'verbunden' : '<b>offline</b>'}</div>
    <div>Version: ${APP_VERSION}</div>
  `;
}
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);

// ---------- Offline-Funktion (Service Worker) ----------

if ('serviceWorker' in navigator) {
  // Lief beim Öffnen schon eine Version? Nur dann ist eine neue ein "Update".
  const hadVersion = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register('sw.js').then(reg => {
    // Neue Version gefunden, während eine alte läuft -> Hinweis zeigen
    reg.addEventListener('updatefound', () => {
      const neu = reg.installing;
      neu.addEventListener('statechange', () => {
        if (neu.state === 'installed' && hadVersion && reg.waiting === neu) {
          showUpdateBanner(neu);
        }
      });
    });
    if (reg.waiting && hadVersion) showUpdateBanner(reg.waiting);
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    updateStatus();
    // Nur neu laden, wenn eine alte Version ersetzt wurde
    if (!hadVersion || window.__reloading) return;
    window.__reloading = true;
    location.reload();
  });
  navigator.serviceWorker.ready.then(updateStatus);
}

function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  banner.hidden = false;
  // Verschwindet die wartende Version (z. B. von selbst aktiv geworden), Hinweis ausblenden
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'installed') banner.hidden = true;
  });
  document.getElementById('btn-update').onclick = () => {
    worker.postMessage('skipWaiting');
  };
}

// Browser bitten, unsere Daten nicht automatisch zu löschen
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(updateStatus).catch(() => {});
}

show();
