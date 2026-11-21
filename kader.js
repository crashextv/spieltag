'use strict';
// Kader: Spieler anlegen, ändern, löschen – mit Foto-Ausschnitt und fester/wechselnder Rückennummer
// Markierung für die Offline-Prüfung in sw.js: build-18

// Bild laden, richtig herum drehen (Handyfotos) und auf höchstens 1600 px verkleinern
async function readImage(file) {
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
  const f = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * f);
  c.height = Math.round(img.height * f);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  return c.toDataURL('image/jpeg', 0.9);
}

// Fenster zum Wählen des Ausschnitts: Bild verschieben und vergrößern.
// Der Kreis zeigt, was später im runden Spielerbild zu sehen ist.
// Liefert das zugeschnittene Bild (320 × 320) oder null bei "Abbrechen".
function cropPhoto(src) {
  return new Promise(resolve => {
    const BOX = Math.min(300, window.innerWidth - 72);
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = `<div class="dlg crop-dlg" role="dialog">
      <h2>Ausschnitt wählen</h2>
      <p>Bild mit dem Finger <b>verschieben</b>. Mit dem Regler oder zwei Fingern <b>vergrößern</b>.
        Im Kreis sehen Sie, was später angezeigt wird.</p>
      <div class="crop-box" style="width:${BOX}px;height:${BOX}px">
        <img alt="" draggable="false">
        <div class="crop-mask"></div>
      </div>
      <div class="crop-zoom"><span>−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Vergrößern"><span>+</span></div>
      <div class="dlg-btns">
        <button class="btn ghost" data-a="cancel">Abbrechen</button>
        <button class="btn primary" data-a="ok">Übernehmen</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const box = wrap.querySelector('.crop-box');
    const img = box.querySelector('img');
    const range = wrap.querySelector('input[type=range]');
    let w = 0, h = 0, base = 1, zoom = 1, x = 0, y = 0;

    // Bild muss den Kasten immer ganz ausfüllen
    const clamp = () => {
      const s = base * zoom;
      x = Math.min(0, Math.max(BOX - w * s, x));
      y = Math.min(0, Math.max(BOX - h * s, y));
    };
    const draw = () => {
      clamp();
      const s = base * zoom;
      img.style.width = w * s + 'px';
      img.style.height = h * s + 'px';
      img.style.transform = `translate(${x}px, ${y}px)`;
    };
    // Vergrößern, wobei der Punkt (cx, cy) an seiner Stelle bleibt
    const setZoom = (z, cx = BOX / 2, cy = BOX / 2) => {
      z = Math.min(4, Math.max(1, z));
      const s0 = base * zoom, s1 = base * z;
      x = cx - (cx - x) * s1 / s0;
      y = cy - (cy - y) * s1 / s0;
      zoom = z;
      range.value = z;
      draw();
    };
    img.onload = () => {
      w = img.naturalWidth;
      h = img.naturalHeight;
      base = BOX / Math.min(w, h);
      x = (BOX - w * base) / 2;
      y = (BOX - h * base) / 2;
      draw();
    };
    img.src = src;
    range.addEventListener('input', () => setZoom(+range.value));

    // Verschieben mit einem Finger, Vergrößern mit zwei Fingern
    const pts = new Map();
    let pinch = null;
    box.addEventListener('pointerdown', e => {
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
      }
    });
    box.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size === 1) {
        x += cur.x - prev.x;
        y += cur.y - prev.y;
        draw();
      } else if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const r = box.getBoundingClientRect();
        setZoom(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d,
          (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);

    wrap.querySelector('.dlg-btns').addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      let out = null;
      if (a.dataset.a === 'ok' && w) {
        const s = base * zoom, SIZE = 320;
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        c.getContext('2d').drawImage(img, -x / s, -y / s, BOX / s, BOX / s, 0, 0, SIZE, SIZE);
        out = c.toDataURL('image/jpeg', 0.85);
      }
      wrap.remove();
      resolve(out);
    });
  });
}

pages.kader = {
  title: 'Kader',
  async render() {
    const players = sortPlayers(await DB.all('players'));
    const list = players.length
      ? `<p class="hint">${players.length} Spieler · zum Ändern antippen</p>
         <ul class="list">${players.map(p => `
           <li><button class="row" data-id="${p.id}">
             ${avatar(p)}
             <span class="num ${hasFixed(p) ? '' : 'muted'}">${hasFixed(p) ? esc(p.number) : '–'}</span>
             <span class="name">${esc(p.name)}${hasFixed(p) ? '' : '<small class="tag">Nr. wechselt</small>'}</span>
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
};

// Bearbeitungs-Zustand des gerade geöffneten Spielers
let editPlayer = null;

pages.spieler = {
  title: 'Spieler',
  async render(id) {
    const isNew = id === 'neu';
    const p = isNew ? { id: newId(), name: '', number: '', photo: null, fixedNumber: true } : await DB.get('players', id);
    if (!p) { editPlayer = null; return `<div class="placeholder"><p>Spieler nicht gefunden.</p></div>`; }
    const fixed = hasFixed(p);
    editPlayer = { p: { ...p }, isNew, saved: { name: p.name, number: fixed ? p.number : null } };
    titleEl.textContent = isNew ? 'Neuer Spieler' : 'Spieler ändern';
    return `
      <div class="photo-area">
        <div id="photo-preview">${avatar(p, 'big')}</div>
        <div class="photo-btns">
          <label class="btn">📷 Foto wählen
            <input type="file" id="photo-input" accept="image/*" hidden>
          </label>
          <button class="btn" id="photo-crop" ${p.photo ? '' : 'hidden'}>✂️ Ausschnitt</button>
          <button class="btn ghost" id="photo-del" ${p.photo ? '' : 'hidden'}>Foto entfernen</button>
        </div>
      </div>
      <label class="field">Name
        <input id="f-name" type="text" autocomplete="off" autocapitalize="words" maxlength="30" value="${esc(p.name)}">
      </label>
      <label class="check-line">
        <input type="checkbox" id="f-fixed" ${fixed ? 'checked' : ''}>
        <span>Feste Rückennummer</span>
      </label>
      <label class="field" id="num-field" ${fixed ? '' : 'hidden'}>Rückennummer
        <input id="f-num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${fixed ? esc(p.number) : ''}">
      </label>
      <p class="hint" id="num-hint" ${fixed ? 'hidden' : ''}>Ohne feste Nummer tragen Sie die Rückennummer
        bei jedem Spiel beim Anlegen neu ein (die Nummer vom letzten Spiel wird vorgeschlagen).</p>
      <p class="error" id="f-err" hidden></p>
      <button class="btn primary wide" id="save">Speichern</button>
      ${isNew ? '' : '<button class="btn danger wide" id="delete">Spieler löschen</button>'}`;
  },
  after() {
    if (!editPlayer) return;
    const { p, isNew, saved } = editPlayer;
    const preview = document.getElementById('photo-preview');
    const delBtn = document.getElementById('photo-del');
    const cropBtn = document.getElementById('photo-crop');
    const nameIn = document.getElementById('f-name');
    const numIn = document.getElementById('f-num');
    const fixedIn = document.getElementById('f-fixed');
    const err = document.getElementById('f-err');

    const refreshPreview = () => {
      p.number = fixedIn.checked ? numIn.value.trim() : null;
      p.name = nameIn.value;
      preview.innerHTML = avatar(p, 'big');
      delBtn.hidden = cropBtn.hidden = !p.photo;
    };
    numIn.addEventListener('input', () => {
      numIn.value = numIn.value.replace(/\D/g, '');
      if (!p.photo) refreshPreview();
    });
    nameIn.addEventListener('input', () => { if (!p.photo && !fixedIn.checked) refreshPreview(); });
    fixedIn.addEventListener('change', () => {
      document.getElementById('num-field').hidden = !fixedIn.checked;
      document.getElementById('num-hint').hidden = fixedIn.checked;
      if (fixedIn.checked) numIn.focus();
      refreshPreview();
    });

    document.getElementById('photo-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const full = await readImage(file);
        const cut = await cropPhoto(full);
        if (cut) { p.photo = cut; refreshPreview(); }
      } catch (ex) {
        toast('Dieses Bild kann leider nicht gelesen werden.');
      }
    });
    cropBtn.addEventListener('click', async () => {
      const cut = await cropPhoto(p.photo);
      if (cut) { p.photo = cut; refreshPreview(); }
    });
    delBtn.addEventListener('click', () => { p.photo = null; refreshPreview(); });

    if (isNew) nameIn.focus();

    document.getElementById('save').addEventListener('click', async () => {
      const name = nameIn.value.trim().replace(/\s+/g, ' ');
      const fixed = fixedIn.checked;
      const num = parseInt(numIn.value, 10);
      const fail = msg => { err.textContent = msg; err.hidden = false; };
      if (!name) return fail('Bitte einen Namen eingeben.');
      if (fixed) {
        if (!(num >= 1 && num <= 99)) return fail('Bitte eine Rückennummer von 1 bis 99 eingeben.');
        const all = await DB.all('players');
        const clash = all.find(o => o.id !== p.id && hasFixed(o) && o.number === num);
        if (clash) return fail(`Die Nummer ${num} hat schon ${clash.name} fest.`);
      }
      const old = isNew ? {} : (await DB.get('players', p.id)) || {};
      await DB.put('players', {
        ...old,
        id: p.id,
        name,
        number: fixed ? num : null,
        fixedNumber: fixed,
        photo: p.photo || null,
      });
      askPersist();
      toast(isNew ? `${name} angelegt` : 'Gespeichert');
      goBack('kader');
    });

    const delBtn2 = document.getElementById('delete');
    if (delBtn2) delBtn2.addEventListener('click', async () => {
      const ok = await dialog({
        title: 'Spieler löschen?',
        text: `${saved.name}${saved.number ? ` (Nr. ${saved.number})` : ''} wird aus dem Kader entfernt.`,
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
};
