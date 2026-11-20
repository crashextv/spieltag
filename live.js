'use strict';
// Spielansicht: Spielstand, Uhr, Spielfeld, Bank, Wechsel, Protokoll
// Markierung für die Offline-Prüfung in sw.js: build-16

let liveGame = null;     // das laufende Spiel
let livePlayers = {};    // Spieler des Spiels (Name, Nummer, Foto)
let benchOpen = false;
let tickTimer = null;
let wakeLock = null;
let pitchObserver = null;

const PHASE_NAMES = { pre: 'Vor Anpfiff', h1: '1. Halbzeit', break: 'Halbzeitpause', h2: '2. Halbzeit', end: 'Spielende' };

// ---------- Uhr und Spielminute ----------
// Die Uhr speichert die Startzeit. So läuft sie auch weiter, wenn das Handy
// gesperrt oder die App geschlossen ist.

function ensureClock(g) {
  if (!g.clock) g.clock = { phase: 'pre', running: false, since: 0, acc: 0 };
  if (!g.stoppage) g.stoppage = { 1: 0, 2: 0 };
  if (!g.events) g.events = [];
}

function clockMs(g) {
  const c = g.clock;
  return c.acc + (c.running ? Date.now() - c.since : 0);
}

function curHalf(g) {
  return g.clock.phase === 'pre' || g.clock.phase === 'h1' ? 1 : 2;
}

// Spielminute nach Fußball-Zählung: 0:00–0:59 ist die 1. Minute.
// Nach Ablauf der Halbzeit: "25+1", "25+2" …
function minuteOf(g, half, sec) {
  const H = g.halfMinutes;
  const m = Math.floor(sec / 60) + 1;
  return m <= H ? { min: (half - 1) * H + m, extra: 0 } : { min: half * H, extra: m - H };
}
function minuteLabel(g, ev) {
  const { min, extra } = minuteOf(g, ev.half, ev.sec);
  return extra ? `${min}+${extra}` : `${min}`;
}

// Zeitstempel für ein Ereignis "jetzt"
function nowStamp(g) {
  if (g.clock.phase === 'break') return { half: 2, sec: 0 }; // Wechsel in der Pause zählt zum Beginn der 2. HZ
  return { half: curHalf(g), sec: Math.floor(clockMs(g) / 1000) };
}

const pad2 = n => String(n).padStart(2, '0');

function clockText(g) {
  const H = g.halfMinutes;
  const ph = g.clock.phase;
  const base = (curHalf(g) - 1) * H * 60;
  let sec = ph === 'pre' ? 0 : ph === 'break' ? H * 60 : Math.floor(clockMs(g) / 1000);
  const lim = H * 60;
  if (ph === 'break') return { main: `${pad2(H)}:00`, extra: '' };
  if (sec < lim) {
    const t = base + sec;
    return { main: `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`, extra: '' };
  }
  const over = sec - lim;
  return { main: `${pad2((base + lim) / 60)}:00`, extra: `+${Math.floor(over / 60)}:${pad2(over % 60)}` };
}

// Ende einer Halbzeit: eingestellte Minuten plus eingetragene Nachspielzeit
function limitMs(g, half) {
  return (g.halfMinutes + ((g.stoppage && g.stoppage[half]) || 0)) * 60000;
}

function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// Wird regelmäßig aufgerufen: Ist die Zeit abgelaufen, endet die Halbzeit bzw. das Spiel.
// Auch wenn das Handy gesperrt war, wird die Spielzeit genau auf das Ende begrenzt.
function checkTimeUp() {
  const g = liveGame;
  if (!g) return;
  const c = g.clock;
  if (!c.running || (c.phase !== 'h1' && c.phase !== 'h2')) return;
  const lim = limitMs(g, curHalf(g));
  if (clockMs(g) < lim) return;
  c.acc = lim;
  c.running = false;
  if (c.phase === 'h1') {
    g.half1Ms = lim;
    c.phase = 'break';
    c.acc = 0;
    buzz([500, 200, 500]);
    saveLive();
    drawLive();
    toast('Halbzeit! Die 1. Halbzeit ist abgelaufen.', 6000);
  } else {
    c.phase = 'end';
    g.endedAt = Date.now();
    buzz([800, 300, 800, 300, 800]);
    saveLive().then(() => go('bericht/' + g.id));
  }
}

// Schiedsrichter spielt doch weiter: Halbzeit bzw. Spiel wieder aufnehmen
async function resumePlay() {
  const g = liveGame;
  const c = g.clock;
  const half = c.phase === 'break' ? 1 : 2;
  const ok = await stoppageDialog(half);
  if (!ok || !liveGame) return;
  if (c.phase === 'break') { c.phase = 'h1'; c.acc = g.half1Ms || 0; }
  else if (c.phase === 'end') { c.phase = 'h2'; delete g.endedAt; }
  c.running = false;
  drawLive();
  saveLive();
  toast('Weiter mit ▶');
}

function score(g) {
  return {
    us: g.events.filter(e => e.type === 'goal' || e.type === 'ownGoalOpp').length,
    them: g.events.filter(e => e.type === 'oppGoal').length,
  };
}

// Speichern läuft im Hintergrund (in der richtigen Reihenfolge), damit die Anzeige sofort reagiert
function saveLive() {
  return DB.put('games', liveGame).catch(() => toast('Speichern fehlgeschlagen!', 5000));
}

// ---------- Display anlassen ----------

async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { /* nicht schlimm, dann eben ohne */ }
}
document.addEventListener('visibilitychange', () => {
  if (liveGame && document.visibilityState === 'visible') { keepScreenOn(); drawLive(); }
});

// ---------- Seite ----------

pages.live = {
  title: 'Spiel',
  fullscreen: true,
  async render() {
    const game = await currentGame();
    if (!game) {
      liveGame = null;
      return `<div class="placeholder"><p>Kein laufendes Spiel.</p>
        <button class="btn primary" onclick="resetTo('')">Zur Startseite</button></div>`;
    }
    ensureClock(game);
    liveGame = game;
    const kader = byId(await DB.all('players'));
    livePlayers = {};
    for (const id of game.squad) {
      livePlayers[id] = { ...game.roster[id], id, photo: kader[id] ? kader[id].photo : null };
    }
    return `<div class="live" id="live">
      <div class="score">
        <div class="score-row">
          <button class="icon-btn" id="live-back" aria-label="Zurück">&#8592;</button>
          <span class="team">${esc(game.team)}</span>
          <span class="goals" id="goals"></span>
          <span class="team opp">${esc(game.opponent)}</span>
        </div>
        <div class="clock-row">
          <span class="half-tag" id="half-tag"></span>
          <span class="clock" id="clock"></span>
          <span class="clock-extra" id="clock-extra"></span>
          <button class="clock-btn" id="clock-btn"></button>
          <button class="nz-btn" id="nz-btn" aria-label="Nachspielzeit">+</button>
        </div>
        <div class="phase-row" id="phase-row"></div>
      </div>
      <div class="pitch-wrap" id="pitch-wrap"></div>
      <div class="bench-panel" id="bench-panel" ${benchOpen ? '' : 'hidden'}>
        <div class="bench-head">Bank · Spieler auf einen Feldspieler ziehen = Wechsel</div>
        <div class="bench-strip" id="live-bench" data-drop="bench"></div>
      </div>
      <div class="live-bar">
        <button class="btn" id="btn-log">📋 Protokoll</button>
        <button class="btn opp-btn" id="btn-opp">🥅 Gegentor</button>
        <button class="btn primary" id="btn-bench"></button>
      </div>
    </div>`;
  },
  after() {
    if (!liveGame) return;
    document.getElementById('live-back').addEventListener('click', () => goBack(''));
    document.getElementById('clock-btn').addEventListener('click', clockButton);
    document.getElementById('nz-btn').addEventListener('click', () => stoppageDialog());
    document.getElementById('btn-log').addEventListener('click', showLog);
    document.getElementById('btn-opp').addEventListener('click', oppGoalDialog);
    document.getElementById('pitch-wrap').addEventListener('click', onPitchTap);
    document.getElementById('btn-bench').addEventListener('click', () => {
      benchOpen = !benchOpen;
      drawLive();
    });
    makeDraggable(document.getElementById('live'), onLiveDrop);

    // Spielfeld so groß wie möglich, ohne zu scrollen
    const wrap = document.getElementById('pitch-wrap');
    pitchObserver = new ResizeObserver(fitPitch);
    pitchObserver.observe(wrap);

    drawLive();
    tickTimer = setInterval(() => { checkTimeUp(); drawClock(); }, 500);
    checkTimeUp(); // falls die Zeit abgelaufen ist, während die App zu war
    keepScreenOn();
  },
  leave() {
    clearInterval(tickTimer);
    if (pitchObserver) pitchObserver.disconnect();
    pitchObserver = null;
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    liveGame = null;
    hideToast();
  }
};

function fitPitch() {
  const wrap = document.getElementById('pitch-wrap');
  const pitch = wrap && wrap.querySelector('.pitch');
  if (!pitch) return;
  const w = wrap.clientWidth - 24, h = wrap.clientHeight - 16;
  pitch.style.width = Math.max(200, Math.min(w, h * 5 / 6)) + 'px';
}

function drawLive() {
  const g = liveGame;
  if (!g || !document.getElementById('live')) return;
  const s = score(g);
  document.getElementById('goals').textContent = `${s.us} : ${s.them}`;

  document.getElementById('pitch-wrap').innerHTML = renderPitch(g.formation, g.slots, livePlayers);
  fitPitch();

  const bench = sortPlayers(g.squad.filter(id => !g.slots.includes(id)).map(id => livePlayers[id]));
  document.getElementById('bench-panel').hidden = !benchOpen;
  document.getElementById('live-bench').innerHTML = bench.length
    ? bench.map(p => `<div class="bench-item" data-drag="bench:${p.id}">${avatar(p, 'bench-av', initials(p.name))}<span class="slot-label">${esc(p.number)}</span></div>`).join('')
    : '<span class="hint light">Niemand auf der Bank</span>';
  document.getElementById('btn-bench').textContent = benchOpen ? 'Bank ▼' : `Bank ▲ (${bench.length})`;
  drawClock();
}

function drawClock() {
  const g = liveGame;
  if (!g || !document.getElementById('clock')) return;
  const c = g.clock, ph = c.phase;
  const t = clockText(g);
  document.getElementById('clock').textContent = t.main;
  document.getElementById('clock-extra').textContent = t.extra;
  document.getElementById('half-tag').textContent = PHASE_NAMES[ph];

  const btn = document.getElementById('clock-btn');
  btn.hidden = ph === 'end';
  btn.textContent = c.running ? '⏸' : '▶';
  btn.classList.toggle('running', c.running);
  btn.setAttribute('aria-label', c.running ? 'Uhr anhalten' : 'Uhr starten');

  const half = curHalf(g);
  const nz = g.stoppage[half] || 0;
  document.getElementById('nz-btn').textContent = nz ? `+${nz}` : '+';

  const row = document.getElementById('phase-row');
  let html = '';
  if (ph === 'pre') html = '<span>▶ Anpfiff startet die Uhr</span>';
  else if (ph === 'break') html = '<span>▶ startet die 2. Halbzeit</span> <button class="phase-btn ghost" data-act="resume">1. HZ fortsetzen</button>';
  else if (ph === 'h1' && !c.running) html = '<button class="phase-btn" data-act="endHalf">1. Halbzeit beenden</button>';
  else if (ph === 'h2' && !c.running) html = '<button class="phase-btn" data-act="endGame">Spiel beenden</button>';
  else if (ph === 'end') html = '<button class="phase-btn" data-act="report">📄 Bericht</button> <button class="phase-btn ghost" data-act="resume">Weiterspielen</button>';
  if (row.dataset.html !== html) {
    row.dataset.html = html;
    row.innerHTML = html;
    const acts = { endHalf, endGame, resume: resumePlay, report: () => go('bericht/' + g.id) };
    row.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', acts[b.dataset.act]));
  }
}

// ---------- Uhr bedienen ----------

async function clockButton() {
  const g = liveGame, c = g.clock;
  if (c.phase === 'end') return;
  if (c.running) {
    c.acc += Date.now() - c.since;
    c.running = false;
  } else {
    if (c.phase === 'pre') c.phase = 'h1';
    if (c.phase === 'break') { c.phase = 'h2'; c.acc = 0; }
    c.since = Date.now();
    c.running = true;
  }
  drawClock();
  saveLive();
}

async function endHalf() {
  const ok = await dialog({
    title: '1. Halbzeit beenden?',
    text: 'Die Uhr springt danach auf den Start der 2. Halbzeit.',
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Halbzeit', value: true, cls: 'primary' },
    ],
  });
  if (!ok || !liveGame) return;
  const c = liveGame.clock;
  liveGame.half1Ms = c.acc;
  c.phase = 'break';
  c.acc = 0;
  c.running = false;
  drawClock();
  saveLive();
}

async function endGame() {
  const ok = await dialog({
    title: 'Spiel beenden?',
    text: 'Abpfiff – danach wird der Spielbericht angezeigt.',
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Abpfiff', value: true, cls: 'primary' },
    ],
  });
  if (!ok || !liveGame) return;
  const g = liveGame;
  g.clock.phase = 'end';
  g.clock.running = false;
  g.endedAt = Date.now();
  await saveLive();
  go('bericht/' + g.id);
}

// Liefert true, wenn übernommen wurde
async function stoppageDialog(focusHalf) {
  const g = liveGame;
  const val = { 1: g.stoppage[1] || 0, 2: g.stoppage[2] || 0 };
  const ok = await dialog({
    title: focusHalf ? `${focusHalf}. Halbzeit fortsetzen` : 'Nachspielzeit',
    text: focusHalf
      ? 'Wie viele Minuten Nachspielzeit gibt es insgesamt? Danach mit ▶ weiterspielen.'
      : 'Nachspielzeit in Minuten. Ist sie abgelaufen, endet die Halbzeit automatisch und das Handy vibriert.',
    html: [1, 2].map(h => `<div class="form-row nz-row"><span>${h}. Halbzeit</span>
      <div class="stepper" data-h="${h}"><button type="button" data-d="-1">−</button><span class="val">${val[h]}</span><button type="button" data-d="1">+</button></div></div>`).join(''),
    init(el) {
      el.querySelectorAll('.stepper').forEach(st => st.addEventListener('click', e => {
        const b = e.target.closest('[data-d]');
        if (!b) return;
        const h = st.dataset.h;
        val[h] = Math.min(15, Math.max(0, val[h] + +b.dataset.d));
        st.querySelector('.val').textContent = val[h];
      }));
    },
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Übernehmen', value: true, cls: 'primary' },
    ],
  });
  if (!ok || !liveGame) return false;
  liveGame.stoppage = val;
  drawClock();
  saveLive();
  return true;
}

// ---------- Wechsel und Positionstausch ----------

function num(id) { return livePlayers[id] ? livePlayers[id].number : '?'; }

function undoAction(snap, msg) {
  return {
    label: 'Rückgängig',
    run: async () => {
      if (!liveGame) return;
      liveGame.slots = snap.slots;
      liveGame.lineup = snap.lineup;
      liveGame.events = snap.events;
      drawLive();
      saveLive();
      toast(msg);
    }
  };
}

async function onLiveDrop(src, dst) {
  const g = liveGame;
  if (!g || dst.type !== 'slot') return; // auf die Bank ziehen geht im Spiel nicht
  if (g.clock.phase === 'end') { toast('Das Spiel ist schon beendet.'); return; }
  const snap = { slots: [...g.slots], lineup: [...g.lineup], events: [...g.events] };

  if (src.type === 'slot') {
    if (src.i === dst.i) return;
    [g.slots[src.i], g.slots[dst.i]] = [g.slots[dst.i], g.slots[src.i]];
    if (g.clock.phase === 'pre') g.lineup = [...g.slots];
    drawLive();
    saveLive();
    toast(`Positionen getauscht: #${num(g.slots[dst.i])} ↔ #${num(g.slots[src.i])}`, 5000, undoAction(snap, 'Tausch rückgängig gemacht'));
    return;
  }

  // Bankspieler auf Feldspieler = Wechsel
  const outId = g.slots[dst.i];
  const inId = src.id;
  g.slots[dst.i] = inId;
  if (g.clock.phase === 'pre') {
    // Vor dem Anpfiff ist das kein Wechsel, sondern eine Änderung der Startaufstellung
    g.lineup = [...g.slots];
    drawLive();
    saveLive();
    toast(`Startaufstellung: #${num(inId)} für #${num(outId)}`, 5000, undoAction(snap, 'Änderung rückgängig gemacht'));
    return;
  }
  const ev = { id: newId(), type: 'sub', ...nowStamp(g), out: outId, in: inId };
  g.events.push(ev);
  drawLive();
  saveLive();
  toast({ html: `${minuteLabel(g, ev)}'&nbsp; ${subArrows(playerText(inId), playerText(outId))}` },
    5000, undoAction(snap, 'Wechsel rückgängig gemacht'));
}

// ---------- Tore ----------

// Doppeltipp auf einen Feldspieler erkennen
let lastTap = { slot: null, t: 0 };
function onPitchTap(e) {
  const s = e.target.closest('.slot');
  if (!s) return;
  const i = +s.dataset.slot;
  const now = Date.now();
  if (lastTap.slot === i && now - lastTap.t < 450) {
    lastTap = { slot: null, t: 0 };
    ourGoal(i);
  } else {
    lastTap = { slot: i, t: now };
  }
}

function canScore(g) {
  const ph = g.clock.phase;
  if (ph === 'pre') { toast('Erst anpfeifen (▶), dann zählen Tore.'); return false; }
  if (ph === 'break') { toast('In der Halbzeitpause gibt es keine Tore.'); return false; }
  if (ph === 'end') { toast('Das Spiel ist schon beendet.'); return false; }
  return true;
}

function addGoalEvent(ev, msgFn, cheer) {
  const g = liveGame;
  const snap = { slots: [...g.slots], lineup: [...g.lineup], events: [...g.events] };
  g.events.push(ev);
  drawLive();
  saveLive();
  if (cheer) {
    buzz(200);
    const wrap = document.getElementById('pitch-wrap');
    const flash = document.createElement('div');
    flash.className = 'goal-flash';
    flash.textContent = 'TOR!';
    wrap.appendChild(flash);
    setTimeout(() => flash.remove(), 1300);
  }
  const s = score(g);
  toast(`${minuteLabel(g, ev)}'  ${msgFn(s)}`, 5000, undoAction(snap, 'Tor rückgängig gemacht'));
}

function ourGoal(i) {
  const g = liveGame;
  if (!g || !canScore(g)) return;
  const id = g.slots[i];
  if (!id) return;
  addGoalEvent({ id: newId(), type: 'goal', ...nowStamp(g), scorer: id },
    s => `TOR ${s.us}:${s.them} – #${num(id)} ${livePlayers[id].name}`, true);
}

function ownGoalOpp() {
  const g = liveGame;
  if (!g || !canScore(g)) return;
  addGoalEvent({ id: newId(), type: 'ownGoalOpp', ...nowStamp(g) },
    s => `TOR ${s.us}:${s.them} – Eigentor des Gegners`, true);
}

async function oppGoalDialog() {
  const g = liveGame;
  if (!g || !canScore(g)) return;
  const stamp = nowStamp(g); // Minute beim Antippen festhalten, nicht erst nach der Eingabe
  let input;
  const ok = await dialog({
    title: `Gegentor (${minuteLabel(g, stamp)}')`,
    text: 'Rückennummer des Torschützen (kann leer bleiben):',
    html: '<input class="num-input" id="opp-num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="z. B. 10">',
    init(el) {
      input = el.querySelector('#opp-num');
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
      setTimeout(() => input.focus(), 50);
    },
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Eintragen', value: true, cls: 'danger' },
    ],
  });
  if (!ok || !liveGame) return;
  const n = parseInt(input.value, 10);
  const number = n >= 1 && n <= 99 ? n : null;
  addGoalEvent({ id: newId(), type: 'oppGoal', ...stamp, number },
    s => `Gegentor ${s.us}:${s.them}` + (number ? ` – #${number}` : ''), false);
}

// Tor aus dem Protokoll löschen (auch lange nach dem Eintragen) – mit Sicherheitsabfrage
async function deleteGoal(evId) {
  const g = liveGame;
  if (!g) return;
  const ev = g.events.find(e => e.id === evId);
  if (!ev) return;
  const msg = await confirmDeleteEvent(g, ev); // gemeinsame Abfrage aus protokoll.js (auch für Wechsel)
  if (!liveGame) return;
  if (msg) { drawLive(); saveLive(); }
  showLog();
  if (msg) toast(msg, 4000);
}

// ---------- Protokoll ----------

function sortedEvents(g) {
  return [...g.events].sort((a, b) => a.half - b.half || a.sec - b.sec);
}

function playerText(id) {
  const p = livePlayers[id];
  return p ? `#${p.number} ${esc(p.name)}` : '?';
}

function showLog() {
  const g = liveGame;
  const evs = sortedEvents(g);
  let us = 0, them = 0;
  const rows = evs.map(ev => {
    const min = `<span class="log-min">${minuteLabel(g, ev)}'</span>`;
    const del = `<button class="log-del" data-del="${ev.id}" aria-label="Eintrag löschen">✕</button>`;
    if (ev.type === 'sub') {
      return `<li class="log-row">${min}<span class="log-ico">⇄</span>
        <span class="log-text"><span class="arr-in">▲</span> ${playerText(ev.in)}<br><span class="arr-out">▼</span> ${playerText(ev.out)}</span>${del}</li>`;
    }
    if (ev.type === 'goal') {
      us++;
      return `<li class="log-row goal">${min}<span class="log-ico">⚽</span>
        <span class="log-text"><b>TOR ${us}:${them}</b> – ${playerText(ev.scorer)}</span>${del}</li>`;
    }
    if (ev.type === 'ownGoalOpp') {
      us++;
      return `<li class="log-row goal">${min}<span class="log-ico">⚽</span>
        <span class="log-text"><b>TOR ${us}:${them}</b> – Eigentor des Gegners</span>${del}</li>`;
    }
    if (ev.type === 'oppGoal') {
      them++;
      return `<li class="log-row opp">${min}<span class="log-ico">🥅</span>
        <span class="log-text"><b>Gegentor ${us}:${them}</b>${ev.number ? ` – #${ev.number}` : ''}</span>${del}</li>`;
    }
    return '';
  }).join('');
  const sh = sheet('Protokoll', `
    ${evs.length ? `<ul class="log">${rows}</ul>` : '<p class="hint">Noch keine Ereignisse.</p>'}
    <button class="btn wide" id="own-goal-opp">⚽ Eigentor des Gegners (Tor für uns)</button>
    <button class="btn wide" id="edit-log">✏️ Bearbeiten / Nachtragen</button>
    <button class="btn wide" id="to-report">📄 Bericht (Zwischenstand)</button>
    <button class="btn danger wide" id="discard">Spiel verwerfen</button>`);
  sh.el.querySelector('#own-goal-opp').addEventListener('click', () => { sh.close(); ownGoalOpp(); });
  sh.el.querySelector('#edit-log').addEventListener('click', () => { sh.close(); go('protokoll/' + g.id); });
  sh.el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    sh.close();
    deleteGoal(b.dataset.del);
  }));
  sh.el.querySelector('#to-report').addEventListener('click', () => { sh.close(); go('bericht/' + g.id); });
  sh.el.querySelector('#discard').addEventListener('click', async () => {
    sh.close();
    const ok = await dialog({
      title: 'Spiel verwerfen?',
      text: `${g.team} – ${g.opponent} wird komplett gelöscht.`,
      buttons: [
        { label: 'Abbrechen', value: false, cls: 'ghost' },
        { label: 'Verwerfen', value: true, cls: 'danger' },
      ],
    });
    if (!ok) return;
    await discardGame(g);
    toast('Spiel gelöscht');
    resetTo('');
  });
}
