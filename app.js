'use strict';

// Versionsnummer der App – wird bei jeder Etappe erhöht.
const APP_VERSION = '2 (Etappe 2: Kader)';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('btn-back');

// ---------- Hilfsfunktionen ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Rundes Spielerbild; ohne Foto ein grüner Kreis mit der Rückennummer
function avatar(p, cls = '') {
  return p.photo
    ? `<img class="avatar ${cls}" src="${p.photo}" alt="">`
    : `<span class="avatar ph ${cls}">${esc(p.number)}</span>`;
}

function sortPlayers(list) {
  return list.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'de'));
}

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

// Foto auf ein Quadrat zuschneiden und verkleinern (spart Speicher)
async function loadPhoto(file) {
  const SIZE = 320;
  let img;
  try {
    img = await createImageBitmap(file);
  } catch (e) {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });
  }
  const w = img.width, h = img.height, s = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  c.getContext('2d').drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE);
  if (img.close) img.close();
  return c.toDataURL('image/jpeg', 0.82);
}

// Dialog mit Knöpfen; liefert den Wert des gedrückten Knopfs
function dialog({ title, text, buttons }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = `<div class="dlg" role="dialog">
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      ${text ? `<p>${esc(text)}</p>` : ''}
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
  });
}

// Kurze Meldung unten (später auch mit "Rückgängig")
let toastTimer;
function toast(msg, ms = 2500) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- Seiten ----------

const pages = {
  start: {
    title: 'Spieltag',
    async render() {
      const n = (await DB.all('players')).length;
      return `
        <div class="menu">
          ${menuBtn('kader', '👕', 'Kader', n ? `${n} Spieler` : 'Spieler anlegen und ändern')}
          ${menuBtn('spiel', '⚽', 'Neues Spiel', 'Aufstellung und los geht’s')}
          ${menuBtn('archiv', '📋', 'Archiv', 'Beendete Spiele und Torschützen')}
          ${menuBtn('sicherung', '💾', 'Sicherung', 'Daten sichern und wiederherstellen')}
        </div>
        <div class="status" id="status">Prüfe …</div>`;
    },
    after() {
      view.querySelectorAll('[data-go]').forEach(b =>
        b.addEventListener('click', () => go(b.dataset.go)));
      updateStatus();
    }
  },

  kader: {
    title: 'Kader',
    async render() {
      const players = sortPlayers(await DB.all('players'));
      const list = players.length
        ? `<p class="hint">${players.length} Spieler · zum Ändern antippen</p>
           <ul class="list">${players.map(p => `
             <li><button class="row" data-id="${p.id}">
               ${avatar(p)}
               <span class="num">${esc(p.number)}</span>
               <span class="name">${esc(p.name)}</span>
               <span class="chev">›</span>
             </button></li>`).join('')}
           </ul>`
        : `<div class="placeholder"><div class="sym">👕</div>
             <p>Noch keine Spieler im Kader.<br>Tippen Sie unten auf <b>+ Spieler</b>.</p></div>`;
      return list + `<div class="fab-space"></div><button class="fab" id="add">+ Spieler</button>`;
    },
    after() {
      view.querySelectorAll('[data-id]').forEach(b =>
        b.addEventListener('click', () => go('spieler/' + b.dataset.id)));
      document.getElementById('add').addEventListener('click', () => go('spieler/neu'));
    }
  },

  spieler: {
    title: 'Spieler',
    async render(id) {
      const isNew = id === 'neu';
      const p = isNew ? { id: newId(), name: '', number: '', photo: null } : await DB.get('players', id);
      if (!p) return `<div class="placeholder"><p>Spieler nicht gefunden.</p></div>`;
      this.player = { ...p };
      this.isNew = isNew;
      titleEl.textContent = isNew ? 'Neuer Spieler' : 'Spieler ändern';
      return `
        <div class="photo-area">
          <div id="photo-preview">${avatar(p, 'big')}</div>
          <div class="photo-btns">
            <label class="btn">📷 Foto wählen
              <input type="file" id="photo-input" accept="image/*" hidden>
            </label>
            <button class="btn ghost" id="photo-del" ${p.photo ? '' : 'hidden'}>Foto entfernen</button>
          </div>
        </div>
        <label class="field">Name
          <input id="f-name" type="text" autocomplete="off" autocapitalize="words" maxlength="30" value="${esc(p.name)}">
        </label>
        <label class="field">Rückennummer
          <input id="f-num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${esc(p.number)}">
        </label>
        <p class="error" id="f-err" hidden></p>
        <button class="btn primary wide" id="save">Speichern</button>
        ${isNew ? '' : '<button class="btn danger wide" id="delete">Spieler löschen</button>'}`;
    },
    after() {
      const page = this;
      const p = page.player;
      if (!p) return;
      const saved = { name: p.name, number: p.number };
      const preview = document.getElementById('photo-preview');
      const delBtn = document.getElementById('photo-del');
      const nameIn = document.getElementById('f-name');
      const numIn = document.getElementById('f-num');
      const err = document.getElementById('f-err');

      const refreshPreview = () => {
        p.number = numIn.value.trim();
        preview.innerHTML = avatar(p, 'big');
        delBtn.hidden = !p.photo;
      };
      numIn.addEventListener('input', () => {
        numIn.value = numIn.value.replace(/\D/g, '');
        if (!p.photo) refreshPreview();
      });

      document.getElementById('photo-input').addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          p.photo = await loadPhoto(file);
          refreshPreview();
        } catch (ex) {
          toast('Dieses Bild kann leider nicht gelesen werden.');
        }
      });
      delBtn.addEventListener('click', () => { p.photo = null; refreshPreview(); });

      if (page.isNew) nameIn.focus();

      document.getElementById('save').addEventListener('click', async () => {
        const name = nameIn.value.trim().replace(/\s+/g, ' ');
        const num = parseInt(numIn.value, 10);
        const fail = msg => { err.textContent = msg; err.hidden = false; };
        if (!name) return fail('Bitte einen Namen eingeben.');
        if (!(num >= 1 && num <= 99)) return fail('Bitte eine Rückennummer von 1 bis 99 eingeben.');
        const all = await DB.all('players');
        const clash = all.find(o => o.id !== p.id && o.number === num);
        if (clash) return fail(`Die Nummer ${num} hat schon ${clash.name}.`);
        await DB.put('players', { id: p.id, name, number: num, photo: p.photo || null });
        askPersist();
        toast(page.isNew ? `${name} angelegt` : 'Gespeichert');
        goBack('kader');
      });

      const delete_ = document.getElementById('delete');
      if (delete_) delete_.addEventListener('click', async () => {
        const ok = await dialog({
          title: 'Spieler löschen?',
          text: `${saved.name} (Nr. ${saved.number}) wird aus dem Kader entfernt.`,
          buttons: [
            { label: 'Abbrechen', value: false, cls: 'ghost' },
            { label: 'Löschen', value: true, cls: 'danger' },
          ],
        });
        if (!ok) return;
        await DB.del('players', p.id);
        toast(`${saved.name} gelöscht`);
        goBack('kader');
      });
    }
  },

  spiel:     placeholder('Neues Spiel', '⚽', 3),
  archiv:    placeholder('Archiv', '📋', 8),
  sicherung: placeholder('Sicherung', '💾', 8),
};

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

let renderToken = 0;
async function show() {
  const [name, param] = location.hash.slice(1).split('/');
  const page = pages[name] || pages.start;
  const token = ++renderToken;
  titleEl.textContent = page.title;
  backBtn.hidden = page === pages.start;
  view.classList.add('busy'); // keine Doppel-Tipps auf die alte Seite
  const html = await page.render(param);
  if (token !== renderToken) return; // inzwischen woanders hin navigiert
  view.classList.remove('busy');
  view.innerHTML = html;
  view.scrollTop = 0;
  if (page.after) page.after();
}

backBtn.addEventListener('click', () => goBack(''));
window.addEventListener('popstate', show);
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
show();
