'use strict';
// Spielbericht: Endstand, Spielzeit, Aufstellung, Tore und Wechsel im Liveticker-Stil.
// Zum Kopieren (DFBnet), Herunterladen (Textdatei) und Teilen.
// Markierung für die Offline-Prüfung in sw.js: build-8

function fmtMs(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Alle Angaben des Berichts aus einem Spiel zusammenstellen
function reportData(g) {
  ensureClock(g);
  const P = id => (g.roster && g.roster[id]) || { name: '?', number: '?' };
  const pl = id => `#${P(id).number} ${P(id).name}`;
  const H = g.halfMinutes;
  const c = g.clock;

  // Spielzeit je Halbzeit
  let h1 = null, h2 = null;
  if (c.phase === 'h1') h1 = clockMs(g);
  else if (c.phase !== 'pre') h1 = g.half1Ms || 0;
  if (c.phase === 'h2') h2 = clockMs(g);
  else if (c.phase === 'end') h2 = c.acc;
  const timeText = ms => ms === null ? '–'
    : fmtMs(ms) + (ms > H * 60000 ? ` (Nachspielzeit +${fmtMs(ms - H * 60000)})` : '');

  // Spielverlauf
  const evs = [...g.events].sort((a, b) => a.half - b.half || a.sec - b.sec);
  let us = 0, them = 0, htUs = 0, htThem = 0;
  const ticker = [];
  let htDone = false;
  const pushHalftime = () => {
    if (htDone) return;
    htDone = true;
    htUs = us; htThem = them;
    ticker.push({ divider: true, text: `Halbzeit ${us}:${them}` });
  };
  const scorers = {};
  for (const ev of evs) {
    if (ev.half === 2) pushHalftime();
    const min = minuteLabel(g, ev) + "'";
    if (ev.type === 'goal') {
      us++;
      scorers[ev.scorer] = (scorers[ev.scorer] || 0) + 1;
      ticker.push({ min, kind: 'goal', text: `TOR ${us}:${them} – ${pl(ev.scorer)}` });
    } else if (ev.type === 'oppGoal') {
      them++;
      ticker.push({ min, kind: 'opp', text: `Gegentor ${us}:${them}` + (ev.number ? ` – #${ev.number}` : '') });
    } else if (ev.type === 'sub') {
      ticker.push({ min, kind: 'sub', text: `Wechsel – rein ${pl(ev.in)}, raus ${pl(ev.out)}` });
    }
  }
  if (c.phase === 'break' || c.phase === 'h2' || c.phase === 'end') pushHalftime();
  if (c.phase === 'end') ticker.push({ divider: true, text: `Abpfiff ${us}:${them}` });

  // Startaufstellung nach Reihen
  const layout = slotLayout(g.formation);
  const rows = { TW: [], AB: [], MF: [], ST: [] };
  (g.lineup || []).forEach((id, i) => { if (id && layout[i]) rows[layout[i].role].push(pl(id)); });
  const benchStart = g.squad.filter(id => !(g.lineup || []).includes(id))
    .map(id => ({ id, ...P(id) })).sort((a, b) => a.number - b.number).map(p => pl(p.id));

  const scorerList = Object.entries(scorers)
    .sort((a, b) => b[1] - a[1] || P(a[0]).number - P(b[0]).number)
    .map(([id, n]) => `${pl(id)}: ${n}`);

  return {
    title: `${g.team} – ${g.opponent}`,
    date: fmtDate(g.date),
    us, them, htUs, htThem, htDone,
    ended: c.phase === 'end',
    h1: timeText(h1), h2: timeText(h2),
    total: h1 === null ? '–' : fmtMs((h1 || 0) + (h2 || 0)),
    formation: formationText(g.formation),
    rows, benchStart, ticker, scorerList,
  };
}

function reportText(g) {
  const r = reportData(g);
  const L = [];
  L.push(r.ended ? 'SPIELBERICHT' : 'SPIELBERICHT (Zwischenstand)');
  L.push(r.title);
  L.push(`Datum: ${r.date}`);
  L.push(`${r.ended ? 'Endstand' : 'Spielstand'}: ${r.us}:${r.them}` + (r.htDone ? ` (Halbzeit ${r.htUs}:${r.htThem})` : ''));
  L.push(`Spielzeit: 1. HZ ${r.h1} · 2. HZ ${r.h2} · gesamt ${r.total}`);
  L.push(`Formation: ${r.formation} (plus Torwart)`);
  L.push('');
  L.push('STARTAUFSTELLUNG');
  L.push(`Tor:        ${r.rows.TW.join(', ') || '–'}`);
  if (r.rows.AB.length) L.push(`Abwehr:     ${r.rows.AB.join(', ')}`);
  if (r.rows.MF.length) L.push(`Mittelfeld: ${r.rows.MF.join(', ')}`);
  if (r.rows.ST.length) L.push(`Sturm:      ${r.rows.ST.join(', ')}`);
  L.push(`Bank:       ${r.benchStart.join(', ') || '–'}`);
  L.push('');
  L.push('SPIELVERLAUF');
  if (!r.ticker.some(t => !t.divider)) L.push('Keine Tore und keine Wechsel.');
  for (const t of r.ticker) {
    L.push(t.divider ? `--- ${t.text} ---` : `${t.min.padEnd(7)}${t.text}`);
  }
  L.push('');
  L.push('TORSCHÜTZEN');
  L.push(r.scorerList.length ? r.scorerList.join('\n') : '–');
  return L.join('\r\n');
}

function fileName(g) {
  const clean = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `Spielbericht_${g.date}_${clean(g.team)}_vs_${clean(g.opponent)}.txt`;
}

function downloadText(name, text) {
  // ﻿ sorgt dafür, dass Umlaute auch unter Windows richtig angezeigt werden
  const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

let reportGame = null;

pages.bericht = {
  title: 'Spielbericht',
  async render(id) {
    reportGame = id ? await DB.get('games', id) : await currentGame();
    if (!reportGame) return `<div class="placeholder"><p>Spiel nicht gefunden.</p></div>`;
    const r = reportData(reportGame);
    const row = (label, list) => list.length ? `<div class="rep-line"><b>${label}</b> ${list.map(esc).join(', ')}</div>` : '';
    return `
      <div class="rep-head">
        <div class="rep-title">${esc(r.title)}</div>
        <div class="rep-score">${r.us} : ${r.them}</div>
        <div class="rep-sub">${r.ended ? 'Endstand' : 'Zwischenstand'}${r.htDone ? ` · Halbzeit ${r.htUs}:${r.htThem}` : ''} · ${esc(r.date)}</div>
      </div>
      <div class="rep-actions">
        <button class="btn" id="rep-copy">📋 Kopieren</button>
        <button class="btn" id="rep-dl">⬇️ Herunterladen</button>
        ${navigator.share ? '<button class="btn" id="rep-share">📤 Teilen</button>' : ''}
      </div>

      <h3 class="sub">Spielzeit</h3>
      <div class="rep-box">
        <div class="rep-line"><b>1. Halbzeit</b> ${esc(r.h1)}</div>
        <div class="rep-line"><b>2. Halbzeit</b> ${esc(r.h2)}</div>
        <div class="rep-line"><b>Gesamt</b> ${esc(r.total)}</div>
      </div>

      <h3 class="sub">Spielverlauf</h3>
      <div class="rep-box">
        ${r.ticker.some(t => !t.divider) ? '' : '<p class="hint">Keine Tore und keine Wechsel.</p>'}
        ${r.ticker.map(t => t.divider
          ? `<div class="rep-div">${esc(t.text)}</div>`
          : `<div class="rep-ev ${t.kind}"><span class="log-min">${esc(t.min)}</span><span>${esc(t.text)}</span></div>`).join('')}
      </div>

      <h3 class="sub">Torschützen</h3>
      <div class="rep-box">${r.scorerList.length ? r.scorerList.map(s => `<div class="rep-line">${esc(s)}</div>`).join('') : '<p class="hint">–</p>'}</div>

      <h3 class="sub">Startaufstellung (${esc(r.formation)})</h3>
      <div class="rep-box">
        ${row('Tor', r.rows.TW)}${row('Abwehr', r.rows.AB)}${row('Mittelfeld', r.rows.MF)}${row('Sturm', r.rows.ST)}
        ${row('Bank', r.benchStart)}
      </div>`;
  },
  after() {
    const g = reportGame;
    if (!g) return;
    const text = reportText(g);
    document.getElementById('rep-copy').addEventListener('click', async () => {
      toast(await copyText(text) ? 'Bericht kopiert – jetzt z. B. ins DFBnet einfügen' : 'Kopieren hat nicht geklappt');
    });
    document.getElementById('rep-dl').addEventListener('click', () => {
      downloadText(fileName(g), text);
      toast('Bericht wird heruntergeladen');
    });
    const share = document.getElementById('rep-share');
    if (share) share.addEventListener('click', async () => {
      try {
        const file = new File(['﻿' + text], fileName(g), { type: 'text/plain' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Spielbericht', files: [file] });
        } else {
          await navigator.share({ title: 'Spielbericht', text });
        }
      } catch (e) { /* Teilen abgebrochen */ }
    });
  }
};
