'use strict';
// Kader: Spieler anlegen, ändern, löschen
// Markierung für die Offline-Prüfung in sw.js: build-8

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

pages.kader = {
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
};

// Bearbeitungs-Zustand des gerade geöffneten Spielers
let editPlayer = null;

pages.spieler = {
  title: 'Spieler',
  async render(id) {
    const isNew = id === 'neu';
    const p = isNew ? { id: newId(), name: '', number: '', photo: null } : await DB.get('players', id);
    if (!p) { editPlayer = null; return `<div class="placeholder"><p>Spieler nicht gefunden.</p></div>`; }
    editPlayer = { p: { ...p }, isNew, saved: { name: p.name, number: p.number } };
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
    if (!editPlayer) return;
    const { p, isNew, saved } = editPlayer;
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

    if (isNew) nameIn.focus();

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
      toast(isNew ? `${name} angelegt` : 'Gespeichert');
      goBack('kader');
    });

    const delBtn2 = document.getElementById('delete');
    if (delBtn2) delBtn2.addEventListener('click', async () => {
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
};
