'use strict';
// Protokoll bearbeiten: Einträge ändern, löschen und von Hand nachtragen.
// Funktioniert für das laufende und für beendete Spiele.
// Markierung für die Offline-Prüfung in sw.js: build-13

const EV_NAMES = { goal: 'Tor', oppGoal: 'Gegentor', ownGoalOpp: 'Eigentor des Gegners', sub: 'Wechsel' };

function rosterText(g, id) {
  const p = g.roster && g.roster[id];
  return p ? `#${p.number} ${esc(p.name)}` : '?';
}

function scoreOf(g) {
  return {
    us: g.events.filter(e => e.type === 'goal' || e.type === 'ownGoalOpp').length,
    them: g.events.filter(e => e.type === 'oppGoal').length,
  };
}

// "13" oder "25+2" in Halbzeit und Sekunde umrechnen
function parseMinute(g, str) {
  const m = String(str || '').trim().match(/^(\d{1,3})\s*(?:\+\s*(\d{1,2}))?$/);
  if (!m) return null;
  const base = +m[1], extra = m[2] ? +m[2] : 0, H = g.halfMinutes;
  if (extra) {
    if (base === H) return { half: 1, sec: (H + extra - 1) * 60 };
    if (base === 2 * H) return { half: 2, sec: (H + extra - 1) * 60 };
    return null;
  }
  if (base >= 1 && base <= H) return { half: 1, sec: (base - 1) * 60 };
  if (base > H && base <= 2 * H) return { half: 2, sec: (base - H - 1) * 60 };
  return null;
}

// Beschreibung eines Eintrags (HTML) mit Zwischenstand
function eventLines(g) {
  const evs = [...g.events].sort((a, b) => a.half - b.half || a.sec - b.sec);
  let us = 0, them = 0;
  return evs.map(ev => {
    let ico = '', html = '', cls = '';
    if (ev.type === 'goal') { us++; ico = '⚽'; cls = 'goal'; html = `<b>TOR ${us}:${them}</b> – ${rosterText(g, ev.scorer)}`; }
    else if (ev.type === 'ownGoalOpp') { us++; ico = '⚽'; cls = 'goal'; html = `<b>TOR ${us}:${them}</b> – Eigentor des Gegners`; }
    else if (ev.type === 'oppGoal') { them++; ico = '🥅'; cls = 'opp'; html = `<b>Gegentor ${us}:${them}</b>${ev.number ? ` – #${ev.number}` : ''}`; }
    else if (ev.type === 'sub') {
      ico = '⇄';
      html = `<span class="arr-in">▲</span> ${rosterText(g, ev.in)}<br><span class="arr-out">▼</span> ${rosterText(g, ev.out)}`;
    }
    return { ev, ico, html, cls, min: minuteLabel(g, ev) };
  });
}

// Löschen mit Sicherheitsabfrage. Ändert g (noch nicht gespeichert). Liefert eine Meldung oder null.
async function confirmDeleteEvent(g, ev) {
  ensureClock(g);
  const now = scoreOf(g);
  let text;
  if (ev.type === 'sub') {
    text = `${minuteLabel(g, ev)}' Wechsel (rein ${rosterText(g, ev.in)}, raus ${rosterText(g, ev.out)}) wird gelöscht.`;
  } else {
    const after = {
      us: now.us - (ev.type === 'oppGoal' ? 0 : 1),
      them: now.them - (ev.type === 'oppGoal' ? 1 : 0),
    };
    const what = ev.type === 'goal' ? `Tor von ${rosterText(g, ev.scorer)}`
      : ev.type === 'ownGoalOpp' ? 'Eigentor des Gegners'
      : `Gegentor${ev.number ? ` von #${ev.number}` : ''}`;
    text = `${minuteLabel(g, ev)}' ${what} wird gelöscht. Der Spielstand ändert sich von ${now.us}:${now.them} auf ${after.us}:${after.them}.`;
  }
  const ok = await dialog({
    title: 'Eintrag löschen?',
    text: text.replace(/&amp;/g, '&'),
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Löschen', value: true, cls: 'danger' },
    ],
  });
  if (!ok) return null;
  g.events = g.events.filter(e => e.id !== ev.id);
  if (ev.type === 'sub') {
    // Wenn möglich auch auf dem Feld zurücktauschen
    const iIn = g.slots.indexOf(ev.in);
    if (g.clock.phase !== 'end' && iIn >= 0 && !g.slots.includes(ev.out)) {
      g.slots[iIn] = ev.out;
      return 'Wechsel gelöscht – Spieler ist wieder auf dem Feld';
    }
    return 'Wechsel gelöscht';
  }
  const s = scoreOf(g);
  return `Gelöscht – Spielstand jetzt ${s.us}:${s.them}`;
}

// ---------- Seite ----------

let protoGame = null;

pages.protokoll = {
  title: 'Protokoll bearbeiten',
  async render(id) {
    protoGame = id ? await DB.get('games', id) : await currentGame();
    if (!protoGame) return `<div class="placeholder"><p>Spiel nicht gefunden.</p></div>`;
    const g = protoGame;
    ensureClock(g);
    const s = scoreOf(g);
    const lines = eventLines(g);
    const ended = g.clock.phase === 'end';
    return `
      <div class="rep-head small">
        <div class="rep-title">${esc(g.team)} – ${esc(g.opponent)}</div>
        <div class="rep-score">${s.us} : ${s.them}</div>
        <div class="rep-sub">${esc(fmtDate(g.date))} · ${g.halfMinutes} Min. pro Halbzeit · ${ended ? 'beendet' : 'läuft'}</div>
      </div>
      <p class="hint">Eintrag antippen zum Ändern oder Löschen.</p>
      ${lines.length ? `<ul class="list">${lines.map(l => `
        <li><button class="row ev-row ${l.cls}" data-ev="${l.ev.id}">
          <span class="log-min">${l.min}'</span>
          <span class="log-ico">${l.ico}</span>
          <span class="log-text">${l.html}</span>
          <span class="chev">›</span>
        </button></li>`).join('')}</ul>` : '<p class="hint">Noch keine Einträge.</p>'}
      <button class="btn primary wide" id="add-ev">+ Ereignis nachtragen</button>
      <button class="btn wide" id="to-report">📄 Zum Spielbericht</button>
      ${ended ? '' : `<button class="btn wide" id="mark-ended">🏁 Spiel als beendet markieren (Nachtrag)</button>
        <p class="hint">Für Spiele, die Sie nachträglich erfassen: Die Spielzeit wird dann mit ${g.halfMinutes} Minuten pro Halbzeit angesetzt.</p>`}`;
  },
  after() {
    const g = protoGame;
    if (!g) return;
    view.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => {
      const ev = g.events.find(e => e.id === b.dataset.ev);
      if (ev) eventSheet(g, ev);
    }));
    document.getElementById('add-ev').addEventListener('click', () => chooseType(g));
    document.getElementById('to-report').addEventListener('click', () => go('bericht/' + g.id));
    const mark = document.getElementById('mark-ended');
    if (mark) mark.addEventListener('click', () => markEnded(g));
  }
};

async function saveProto(g, msg) {
  await DB.put('games', g);
  if (msg) toast(msg, 3500);
  show();
}

function chooseType(g) {
  const sh = sheet('Was nachtragen?', `
    <div class="type-grid">
      <button class="btn" data-t="goal">⚽ Tor</button>
      <button class="btn" data-t="oppGoal">🥅 Gegentor</button>
      <button class="btn" data-t="sub">⇄ Wechsel</button>
      <button class="btn" data-t="ownGoalOpp">⚽ Eigentor Gegner</button>
    </div>`);
  sh.el.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    sh.close();
    eventSheet(g, null, b.dataset.t);
  }));
}

function playerOptions(g, selected) {
  return sortPlayers(g.squad.map(id => ({ id, ...g.roster[id] })))
    .map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>#${p.number} ${esc(p.name)}</option>`).join('');
}

// Formular zum Ändern (ev gesetzt) oder Nachtragen (type gesetzt)
function eventSheet(g, ev, type) {
  const isNew = !ev;
  type = ev ? ev.type : type;
  const H = g.halfMinutes;
  const minVal = ev ? minuteLabel(g, ev) : '';
  let fields = '';
  if (type === 'goal') {
    fields = `<label class="field">Torschütze
      <select id="f-p1">${isNew ? '<option value="">– bitte wählen –</option>' : ''}${playerOptions(g, ev && ev.scorer)}</select></label>`;
  } else if (type === 'oppGoal') {
    fields = `<label class="field">Rückennummer des Gegners (kann leer bleiben)
      <input id="f-num" type="text" inputmode="numeric" maxlength="2" value="${ev && ev.number ? ev.number : ''}"></label>`;
  } else if (type === 'sub') {
    fields = `<label class="field"><span class="arr-in">▲</span> Rein
      <select id="f-in">${isNew ? '<option value="">– bitte wählen –</option>' : ''}${playerOptions(g, ev && ev.in)}</select></label>
      <label class="field"><span class="arr-out">▼</span> Raus
      <select id="f-out">${isNew ? '<option value="">– bitte wählen –</option>' : ''}${playerOptions(g, ev && ev.out)}</select></label>`;
  }
  const sh = sheet(`${EV_NAMES[type]} ${isNew ? 'nachtragen' : 'ändern'}`, `
    <label class="field">Minute (z. B. 13 oder ${H}+2)
      <input id="f-min" type="text" inputmode="tel" maxlength="6" value="${esc(minVal)}" placeholder="1 – ${2 * H}">
    </label>
    ${fields}
    <p class="error" id="f-err" hidden></p>
    <button class="btn primary wide" id="f-save">${isNew ? 'Nachtragen' : 'Speichern'}</button>
    ${isNew ? '' : '<button class="btn danger wide" id="f-del">Eintrag löschen</button>'}`);
  const $ = sel => sh.el.querySelector(sel);
  if (isNew) setTimeout(() => $('#f-min').focus(), 100);
  const numIn = $('#f-num');
  if (numIn) numIn.addEventListener('input', () => { numIn.value = numIn.value.replace(/\D/g, ''); });

  $('#f-save').addEventListener('click', async () => {
    const err = $('#f-err');
    const fail = msg => { err.textContent = msg; err.hidden = false; };
    const raw = $('#f-min').value;
    let stamp = parseMinute(g, raw);
    if (!stamp) return fail(`Bitte eine Minute von 1 bis ${2 * H} eingeben – oder Nachspielzeit wie ${H}+2 bzw. ${2 * H}+3.`);
    // Minute unverändert → genaue Sekunde behalten (Reihenfolge bleibt gleich)
    if (ev && minuteLabel(g, ev) === minuteLabel(g, stamp)) stamp = { half: ev.half, sec: ev.sec };
    const data = { id: ev ? ev.id : newId(), type, ...stamp };
    if (type === 'goal') {
      data.scorer = $('#f-p1').value;
      if (!data.scorer) return fail('Bitte den Torschützen wählen.');
    } else if (type === 'oppGoal') {
      const n = parseInt($('#f-num').value, 10);
      data.number = n >= 1 && n <= 99 ? n : null;
    } else if (type === 'sub') {
      data.in = $('#f-in').value;
      data.out = $('#f-out').value;
      if (!data.in || !data.out) return fail('Bitte wählen, wer rein und wer raus geht.');
      if (data.in === data.out) return fail('Rein und Raus dürfen nicht derselbe Spieler sein.');
    }
    let msg;
    if (ev) {
      g.events = g.events.map(e => (e.id === ev.id ? data : e));
      msg = 'Eintrag geändert';
    } else {
      g.events.push(data);
      msg = `${EV_NAMES[type]} nachgetragen`;
      // Wechsel im laufenden Spiel auch auf dem Feld ausführen, wenn es passt
      if (type === 'sub' && g.clock.phase !== 'end') {
        const iOut = g.slots.indexOf(data.out);
        if (iOut >= 0 && !g.slots.includes(data.in)) { g.slots[iOut] = data.in; msg += ' und auf dem Feld getauscht'; }
      }
    }
    sh.close();
    await saveProto(g, msg);
  });

  const del = $('#f-del');
  if (del) del.addEventListener('click', async () => {
    sh.close();
    const msg = await confirmDeleteEvent(g, ev);
    if (msg) await saveProto(g, msg);
  });
}

async function markEnded(g) {
  const ok = await dialog({
    title: 'Spiel als beendet markieren?',
    text: 'Die Uhr wird gestoppt und das Spiel gilt als abgepfiffen. Einträge können Sie danach weiterhin ändern.',
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Beenden', value: true, cls: 'primary' },
    ],
  });
  if (!ok) return;
  ensureClock(g);
  const H = g.halfMinutes;
  // Spielzeit: Halbzeitdauer plus die größte eingetragene Nachspielzeit je Halbzeit
  const extra = half => Math.max(g.stoppage[half] || 0, ...g.events
    .filter(e => e.half === half).map(e => Math.max(0, Math.floor(e.sec / 60) + 1 - H)));
  const c = g.clock;
  if (c.phase === 'pre' || c.phase === 'h1') g.half1Ms = (H + extra(1)) * 60000;
  else if (!g.half1Ms) g.half1Ms = (H + extra(1)) * 60000;
  if (c.phase === 'h2') c.acc = Math.max(clockMs(g), H * 60000);
  else c.acc = (H + extra(2)) * 60000;
  c.phase = 'end';
  c.running = false;
  g.endedAt = Date.now();
  await saveProto(g, 'Spiel als beendet markiert');
}
