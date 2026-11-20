'use strict';
// Spiel anlegen in drei Schritten: Spieldaten → Wer ist dabei? → Startaufstellung
// Markierung für die Offline-Prüfung in sw.js: build-16

// Der Entwurf wird nach jeder Änderung gespeichert, damit nichts verloren geht,
// falls das Handy zwischendurch gesperrt wird.
let draft = null;

async function loadDraft() {
  if (!draft) draft = await getMeta('draft');
  return draft;
}
function saveDraft() { return setMeta('draft', draft); }

async function freshDraft() {
  const s = (await getMeta('settings')) || {};
  draft = {
    date: today(),
    team: s.team || '',
    opponent: '',
    halfMinutes: s.halfMinutes || 25,
    formation: s.formation || { def: 2, mid: 3, att: 1 },
    squad: null,   // IDs der Spieler, die dabei sind
    slots: [],     // Startaufstellung: Spieler-ID je Platz
  };
  await saveDraft();
}

// Knopf "Neues Spiel" auf der Startseite
async function startNewGame() {
  const game = await currentGame();
  if (game && game.clock && game.clock.phase === 'end') {
    // Beendetes Spiel bleibt gespeichert (fürs Archiv), es ist nur nicht mehr "laufend"
    game.status = 'done';
    await DB.put('games', game);
    await delMeta('current');
  } else if (game) {
    const ok = await dialog({
      title: 'Es läuft noch ein Spiel',
      text: `${game.team} – ${game.opponent} wird dabei gelöscht.`,
      buttons: [
        { label: 'Abbrechen', value: false, cls: 'ghost' },
        { label: 'Löschen', value: true, cls: 'danger' },
      ],
    });
    if (!ok) return;
    await discardGame(game);
  }
  await freshDraft();
  go('spiel');
}

async function discardGame(game) {
  await DB.del('games', game.id);
  await delMeta('current');
}

function stepper(key, value, min, max) {
  return `<div class="stepper" data-key="${key}" data-min="${min}" data-max="${max}">
    <button type="button" data-d="-1" aria-label="weniger">−</button>
    <span class="val">${value}</span>
    <button type="button" data-d="1" aria-label="mehr">+</button>
  </div>`;
}

function stepsBar(n) {
  return `<div class="steps">${['Spieldaten', 'Wer ist dabei?', 'Aufstellung'].map((t, i) =>
    `<span class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
}

function noDraft() {
  return `<div class="placeholder"><p>Kein Spiel in Vorbereitung.</p>
    <button class="btn primary" onclick="resetTo('')">Zur Startseite</button></div>`;
}

// ---------- Schritt 1: Spieldaten und Formation ----------

pages.spiel = {
  title: 'Neues Spiel',
  async render() {
    const d = await loadDraft();
    if (!d) return noDraft();
    const f = d.formation;
    return `${stepsBar(1)}
      <label class="field">Datum
        <input id="f-date" type="date" value="${esc(d.date)}">
      </label>
      <label class="field">Eigene Mannschaft
        <input id="f-team" type="text" autocapitalize="words" maxlength="40" value="${esc(d.team)}" placeholder="z. B. SV Musterstadt E1">
      </label>
      <label class="field">Gegner
        <input id="f-opp" type="text" autocapitalize="words" maxlength="40" value="${esc(d.opponent)}">
      </label>
      <div class="field">Dauer einer Halbzeit (Minuten)
        <div class="stepper-line">${stepper('halfMinutes', d.halfMinutes, 1, 60)}</div>
      </div>
      <div class="field">Formation
        <div class="form-rows">
          <div class="form-row"><span>Sturm</span>${stepper('att', f.att, 0, 6)}</div>
          <div class="form-row"><span>Mittelfeld</span>${stepper('mid', f.mid, 0, 6)}</div>
          <div class="form-row"><span>Abwehr</span>${stepper('def', f.def, 0, 6)}</div>
          <div class="form-row"><span>Torwart</span><span class="fixed">1</span></div>
        </div>
        <div class="form-summary" id="form-summary"></div>
        <div id="mini-pitch"></div>
      </div>
      <p class="error" id="f-err" hidden></p>
      <button class="btn primary wide" id="next">Weiter: Wer ist dabei?</button>`;
  },
  after() {
    if (!draft) return;
    const d = draft;
    const summary = document.getElementById('form-summary');
    const mini = document.getElementById('mini-pitch');
    const refresh = () => {
      summary.innerHTML = `<b>${formationText(d.formation)}</b> · ${fieldCount(d.formation)} Spieler auf dem Feld (mit Torwart)`;
      mini.innerHTML = renderPitch(d.formation, [], {}, 'mini');
    };
    refresh();

    view.querySelectorAll('.stepper').forEach(st => {
      st.addEventListener('click', e => {
        const b = e.target.closest('[data-d]');
        if (!b) return;
        const key = st.dataset.key;
        const obj = key === 'halfMinutes' ? d : d.formation;
        const v = Math.min(+st.dataset.max, Math.max(+st.dataset.min, obj[key] + +b.dataset.d));
        if (key !== 'halfMinutes' && v !== obj[key]) d.slots = []; // andere Formation → Aufstellung neu
        obj[key] = v;
        st.querySelector('.val').textContent = v;
        refresh();
        saveDraft();
      });
    });

    const dateIn = document.getElementById('f-date');
    const teamIn = document.getElementById('f-team');
    const oppIn = document.getElementById('f-opp');
    for (const el of [dateIn, teamIn, oppIn]) {
      el.addEventListener('input', () => {
        d.date = dateIn.value;
        d.team = teamIn.value.trim();
        d.opponent = oppIn.value.trim();
        saveDraft();
      });
    }

    document.getElementById('next').addEventListener('click', () => {
      const err = document.getElementById('f-err');
      const fail = msg => { err.textContent = msg; err.hidden = false; };
      if (!d.date) return fail('Bitte ein Datum wählen.');
      if (!d.team) return fail('Bitte die eigene Mannschaft eintragen.');
      if (!d.opponent) return fail('Bitte den Gegner eintragen.');
      if (fieldCount(d.formation) < 2) return fail('Bitte mindestens einen Feldspieler in der Formation vorsehen.');
      go('kaderwahl');
    });
  }
};

// ---------- Schritt 2: Wer ist dabei? ----------

pages.kaderwahl = {
  title: 'Wer ist dabei?',
  async render() {
    const d = await loadDraft();
    if (!d) return noDraft();
    const players = sortPlayers(await DB.all('players'));
    if (!players.length) {
      return `${stepsBar(2)}<div class="placeholder"><div class="sym">👕</div>
        <p>Der Kader ist noch leer.</p>
        <button class="btn primary" onclick="go('kader')">Zum Kader</button></div>`;
    }
    // Beim ersten Mal sind alle ausgewählt; gelöschte Spieler fallen heraus
    const ids = new Set(players.map(p => p.id));
    if (!d.squad) d.squad = players.map(p => p.id);
    d.squad = d.squad.filter(id => ids.has(id));
    await saveDraft();
    return `${stepsBar(2)}
      <div class="pick-tools">
        <button class="btn ghost" id="all">Alle</button>
        <button class="btn ghost" id="none">Keiner</button>
      </div>
      <ul class="list">${players.map(p => `
        <li><button class="row pick" data-id="${p.id}">
          <span class="tick"></span>
          ${avatar(p)}
          <span class="num">${esc(p.number)}</span>
          <span class="name">${esc(p.name)}</span>
        </button></li>`).join('')}
      </ul>
      <div class="sticky-foot">
        <div class="count" id="count"></div>
        <p class="error" id="f-err" hidden></p>
        <button class="btn primary wide" id="next">Weiter: Aufstellung</button>
      </div>`;
  },
  after() {
    if (!draft || !draft.squad) return;
    const d = draft;
    const need = fieldCount(d.formation);
    const rows = [...view.querySelectorAll('.pick')];
    const refresh = () => {
      const sel = new Set(d.squad);
      rows.forEach(r => r.classList.toggle('on', sel.has(r.dataset.id)));
      const n = d.squad.length;
      document.getElementById('count').innerHTML =
        `<b>${n} dabei</b> · ${Math.min(n, need)} auf dem Feld · ${Math.max(0, n - need)} auf der Bank`;
    };
    refresh();
    rows.forEach(r => r.addEventListener('click', () => {
      const id = r.dataset.id;
      d.squad = d.squad.includes(id) ? d.squad.filter(x => x !== id) : [...d.squad, id];
      refresh();
      saveDraft();
    }));
    document.getElementById('all').addEventListener('click', () => {
      d.squad = rows.map(r => r.dataset.id); refresh(); saveDraft();
    });
    document.getElementById('none').addEventListener('click', () => {
      d.squad = []; refresh(); saveDraft();
    });
    document.getElementById('next').addEventListener('click', () => {
      if (d.squad.length < need) {
        const err = document.getElementById('f-err');
        err.textContent = `Für ${formationText(d.formation)} mit Torwart braucht es mindestens ${need} Spieler. ` +
          `Wählen Sie mehr Spieler aus oder ändern Sie in Schritt 1 die Formation.`;
        err.hidden = false;
        return;
      }
      // Nicht mehr ausgewählte Spieler aus der Aufstellung nehmen
      d.slots = d.slots.map(id => (id && d.squad.includes(id) ? id : null));
      saveDraft();
      go('aufstellung');
    });
  }
};

// ---------- Schritt 3: Startaufstellung ----------

pages.aufstellung = {
  title: 'Startaufstellung',
  async render() {
    const d = await loadDraft();
    if (!d || !d.squad) return noDraft();
    return `${stepsBar(3)}
      <p class="hint">Spieler von der Bank auf einen Platz <b>ziehen</b> – oder einen Platz antippen.
        Spieler auf dem Feld lassen sich untereinander tauschen oder zurück auf die Bank ziehen.</p>
      <div id="setup-area">
        <div id="setup-pitch"></div>
        <h3 class="sub">Bank</h3>
        <div id="setup-bench" class="bench-strip" data-drop="bench"></div>
      </div>
      <button class="btn wide" id="auto">Freie Plätze automatisch füllen</button>
      <p class="error" id="f-err" hidden></p>
      <button class="btn primary wide" id="create">Spiel anlegen</button>`;
  },
  async after() {
    if (!draft || !draft.squad) return;
    const d = draft;
    const players = byId(await DB.all('players'));
    const layout = slotLayout(d.formation);
    d.squad = d.squad.filter(id => players[id]);
    while (d.slots.length < layout.length) d.slots.push(null);
    d.slots.length = layout.length;

    const bench = () => sortPlayers(d.squad.filter(id => !d.slots.includes(id)).map(id => players[id]));

    const refresh = () => {
      document.getElementById('setup-pitch').innerHTML = renderPitch(d.formation, d.slots, players);
      const b = bench();
      document.getElementById('setup-bench').innerHTML = b.length
        ? b.map(p => `<div class="bench-item" data-drag="bench:${p.id}">${avatar(p, 'bench-av', initials(p.name))}<span class="slot-label">${esc(p.number)}</span></div>`).join('')
        : '<span class="hint">Niemand auf der Bank</span>';
      document.getElementById('auto').hidden = !d.slots.includes(null) || !b.length;
      view.querySelectorAll('#setup-pitch .slot').forEach(s =>
        s.addEventListener('click', () => choose(+s.dataset.slot)));
      saveDraft();
    };

    // Ziehen: Bank → Platz, Platz ↔ Platz, Platz → Bank
    makeDraggable(document.getElementById('setup-area'), (src, dst) => {
      if (src.type === 'bench' && dst.type === 'slot') {
        d.slots[dst.i] = src.id; // bisheriger Spieler auf dem Platz geht automatisch auf die Bank
      } else if (src.type === 'slot' && dst.type === 'slot') {
        [d.slots[src.i], d.slots[dst.i]] = [d.slots[dst.i], d.slots[src.i]];
      } else if (src.type === 'slot' && dst.type === 'bench') {
        d.slots[src.i] = null;
      }
      refresh();
    });

    // Auswahlfenster für einen Platz: nur Spieler, die noch auf der Bank sitzen
    const choose = idx => {
      const current = d.slots[idx];
      const list = bench();
      const sh = sheet(`${ROLE_NAMES[layout[idx].role]}: Spieler wählen`, `
        ${list.length ? `<ul class="list">${list.map(p => `
          <li><button class="row" data-id="${p.id}">
            ${avatar(p)}
            <span class="num">${esc(p.number)}</span>
            <span class="name">${esc(p.name)}</span>
          </button></li>`).join('')}
        </ul>` : `<p class="hint">Alle Spieler stehen schon auf dem Feld. Zum Tauschen einen Spieler
          auf dem Feld auf einen anderen ziehen.</p>`}
        ${current ? '<button class="btn wide" id="clear-slot">Platz leeren (auf die Bank)</button>' : ''}`);
      sh.el.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => {
        d.slots[idx] = b.dataset.id; // bisheriger Spieler geht auf die Bank
        sh.close();
        refresh();
      }));
      const clr = sh.el.querySelector('#clear-slot');
      if (clr) clr.addEventListener('click', () => { d.slots[idx] = null; sh.close(); refresh(); });
    };

    document.getElementById('auto').addEventListener('click', () => {
      const b = bench();
      d.slots = d.slots.map(id => id || (b.length ? b.shift().id : null));
      refresh();
    });

    document.getElementById('create').addEventListener('click', async () => {
      if (d.slots.includes(null)) {
        const err = document.getElementById('f-err');
        err.textContent = 'Bitte zuerst alle Plätze besetzen.';
        err.hidden = false;
        return;
      }
      // Namen und Nummern für den Spielbericht festhalten
      const roster = {};
      for (const id of d.squad) roster[id] = { name: players[id].name, number: players[id].number };
      const game = {
        id: newId(),
        status: 'live',
        createdAt: Date.now(),
        date: d.date,
        team: d.team,
        opponent: d.opponent,
        halfMinutes: d.halfMinutes,
        formation: { ...d.formation },
        squad: [...d.squad],
        roster,
        lineup: [...d.slots],  // Startaufstellung (bleibt unverändert)
        slots: [...d.slots],   // aktuelle Belegung (ändert sich im Spiel)
        events: [],
      };
      await DB.put('games', game);
      await setMeta('current', game.id);
      await setMeta('settings', { team: d.team, halfMinutes: d.halfMinutes, formation: d.formation });
      await delMeta('draft');
      draft = null;
      askPersist();
      toast('Spiel angelegt');
      resetTo('live');
    });

    refresh();
  }
};

// Die Spielansicht selbst steht in live.js.
