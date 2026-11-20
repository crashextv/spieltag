'use strict';

// Versionsnummer der App – wird bei jeder Etappe erhöht.
// Markierung für die Offline-Prüfung in sw.js: build-11
const APP_VERSION = '6.2 (Tore löschen, Wechsel-Pfeile)';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('btn-back');

// Alle Seiten der App. Weitere Seiten tragen sich in kader.js, spiel.js usw. ein.
const pages = {};

// ---------- Hilfsfunktionen ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0] || '')[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

// Rundes Spielerbild; ohne Foto ein grüner Kreis mit Rückennummer (oder Initialen)
function avatar(p, cls = '', inner) {
  return p.photo
    ? `<img class="avatar ${cls}" src="${p.photo}" alt="">`
    : `<span class="avatar ph ${cls}">${esc(inner !== undefined ? inner : p.number)}</span>`;
}

function sortPlayers(list) {
  return list.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'de'));
}

function byId(list) {
  const map = {};
  for (const p of list) map[p.id] = p;
  return map;
}

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s) {
  const [y, m, d] = String(s || '').split('-');
  return d ? `${d}.${m}.${y}` : '';
}

async function getMeta(key) {
  const row = await DB.get('meta', key);
  return row ? row.value : undefined;
}
function setMeta(key, value) { return DB.put('meta', { id: key, value }); }
function delMeta(key) { return DB.del('meta', key); }

// Das laufende Spiel (falls es eins gibt)
async function currentGame() {
  const id = await getMeta('current');
  return id ? DB.get('games', id) : undefined;
}

// Dialog mit Knöpfen; liefert den Wert des gedrückten Knopfs.
// Optional: eigener Inhalt (html) und init(el), um ihn zu bedienen.
function dialog({ title, text, html, init, buttons }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = `<div class="dlg" role="dialog">
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${html ? `<div class="dlg-body">${html}</div>` : ''}
      <div class="dlg-btns">
        ${buttons.map((b, i) => `<button data-i="${i}" class="btn ${b.cls || ''}">${esc(b.label)}</button>`).join('')}
      </div></div>`;
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b && e.target !== wrap) return;
      wrap.remove();
      resolve(b ? buttons[b.dataset.i].value : undefined);
    });
    document.body.appendChild(wrap);
    if (init) init(wrap.querySelector('.dlg'));
  });
}

// Fenster, das von unten hochfährt
function sheet(title, html) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet"><div class="grip"></div>
    ${title ? `<h2>${esc(title)}</h2>` : ''}<div class="sheet-body">${html}</div></div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  return { el: wrap.querySelector('.sheet-body'), close };
}

// Kurze Meldung unten, optional mit Knopf (z. B. "Rückgängig")
let toastTimer;
// Pfeile für Wechsel: grün = kommt rein, rot = geht raus
function subArrows(inText, outText) {
  return `<span class="nw"><span class="arr-in">▲</span> ${inText}</span> <span class="nw"><span class="arr-out">▼</span> ${outText}</span>`;
}

// msg kann Text sein oder { html: '...' } für formatierte Meldungen
function toast(msg, ms = 2500, action) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${msg && msg.html !== undefined ? msg.html : esc(msg)}</span>` +
    (action ? `<button class="toast-btn">${esc(action.label)}</button>` : '');
  el.classList.toggle('has-btn', !!action);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  if (action) {
    el.querySelector('.toast-btn').onclick = () => {
      el.hidden = true;
      clearTimeout(toastTimer);
      action.run();
    };
  }
}
function hideToast() {
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
}

// ---------- Startseite und Platzhalter ----------

pages.start = {
  title: 'Spieltag',
  async render() {
    const [players, game, draft] = await Promise.all([DB.all('players'), currentGame(), getMeta('draft')]);
    const n = players.length;
    return `
      <div class="menu">
        ${game && game.clock && game.clock.phase === 'end' ? `<button class="menu-btn live" data-go="bericht/${game.id}">
            <span class="sym">📄</span>
            <span>Spiel beendet – Bericht<small>${esc(game.team)} – ${esc(game.opponent)}</small></span>
          </button>` : game ? `<button class="menu-btn live" data-go="live">
            <span class="sym">▶️</span>
            <span>Laufendes Spiel<small>${esc(game.team)} – ${esc(game.opponent)}</small></span>
          </button>` : ''}
        ${!game && draft ? `<button class="menu-btn live" data-go="spiel">
            <span class="sym">📝</span>
            <span>Spiel weiter vorbereiten<small>${esc(draft.team || '…')} – ${esc(draft.opponent || '…')}</small></span>
          </button>` : ''}
        ${menuBtn('kader', '👕', 'Kader', n ? `${n} Spieler` : 'Spieler anlegen und ändern')}
        <button class="menu-btn" id="new-game">
          <span class="sym">⚽</span>
          <span>Neues Spiel<small>Aufstellung und los geht’s</small></span>
        </button>
        ${menuBtn('archiv', '📋', 'Archiv', 'Beendete Spiele und Torschützen')}
        ${menuBtn('sicherung', '💾', 'Sicherung', 'Daten sichern und wiederherstellen')}
      </div>
      <div class="status" id="status">Prüfe …</div>`;
  },
  after() {
    view.querySelectorAll('[data-go]').forEach(b =>
      b.addEventListener('click', () => go(b.dataset.go)));
    document.getElementById('new-game').addEventListener('click', startNewGame);
    updateStatus();
  }
};

pages.archiv = placeholder('Archiv', '📋', 8);
pages.sicherung = placeholder('Sicherung', '💾', 8);

function menuBtn(page, sym, label, hint) {
  return `<button class="menu-btn" data-go="${page}">
    <span class="sym">${sym}</span>
    <span>${label}<small>${esc(hint)}</small></span>
  </button>`;
}

function placeholder(title, sym, etappe) {
  return {
    title,
    render: () => `<div class="placeholder">
        <div class="sym">${sym}</div>
        <p>Dieser Bereich kommt in <b>Etappe ${etappe}</b>.</p>
      </div>`
  };
}

// ---------- Navigation (Zurück-Taste von Android funktioniert) ----------

function depth() { return (history.state && history.state.d) || 0; }

function go(route) {
  history.pushState({ d: depth() + 1 }, '', '#' + route);
  show();
}

// Zurück zur vorigen Seite; wurde die App direkt hier geöffnet, zur Ersatzseite
function goBack(fallback) {
  if (depth() > 0) history.back();
  else { history.replaceState({ d: 0 }, '', fallback ? '#' + fallback : location.pathname); show(); }
}

// Alle Seiten "zurückspulen" bis zum Start und dann (optional) eine neue öffnen.
// So landet die Zurück-Taste nicht wieder mitten im Formular.
let pendingRoute = null;
function resetTo(route) {
  const d = depth();
  if (d > 0) { pendingRoute = route || ''; history.go(-d); }
  else if (route) go(route);
  else show();
}

let renderToken = 0;
let activePage = null;
async function show() {
  const [name, param] = location.hash.slice(1).split('/');
  const page = pages[name] || pages.start;
  const token = ++renderToken;
  // Vorige Seite aufräumen (z. B. Uhr-Anzeige der Spielansicht stoppen)
  if (activePage && activePage.leave) activePage.leave();
  activePage = page;
  document.querySelectorAll('.sheet-wrap').forEach(el => el.remove());
  document.body.classList.toggle('live-mode', !!page.fullscreen);
  titleEl.textContent = page.title;
  backBtn.hidden = page === pages.start;
  view.classList.add('busy'); // keine Doppel-Tipps auf die alte Seite
  const html = await page.render(param);
  if (token !== renderToken) return; // inzwischen woanders hin navigiert
  view.classList.remove('busy');
  view.innerHTML = html;
  view.scrollTop = 0;
  if (page.after) page.after(param);
}

backBtn.addEventListener('click', () => goBack(''));
window.addEventListener('popstate', () => {
  if (pendingRoute !== null) {
    const r = pendingRoute;
    pendingRoute = null;
    if (r) { go(r); return; }
  }
  show();
});
if (!history.state) history.replaceState({ d: 0 }, '', location.href);

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

// Browser bitten, unsere Daten nicht automatisch zu löschen
function askPersist() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(updateStatus).catch(() => {});
  }
}

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
    // Beim Zurückkehren in die App nach einer neuen Version schauen (nur mit Internet)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
    });
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

askPersist();
// Erst starten, wenn alle Seiten-Dateien geladen sind
document.addEventListener('DOMContentLoaded', show);
