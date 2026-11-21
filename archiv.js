'use strict';
// Archiv (beendete Spiele, Torschützenliste) und Datensicherung
// Markierung für die Offline-Prüfung in sw.js: build-18

function isEnded(g) { return !!(g.clock && g.clock.phase === 'end'); }

function gameScore(g) {
  const ev = g.events || [];
  return {
    us: ev.filter(e => e.type === 'goal' || e.type === 'ownGoalOpp').length,
    them: ev.filter(e => e.type === 'oppGoal').length,
  };
}

async function endedGames() {
  return (await DB.all('games')).filter(isEnded)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.endedAt || 0) - (a.endedAt || 0));
}

// Tore und Einsätze je Spieler über alle beendeten Spiele
function scorerTable(games, kader) {
  const rows = {};
  const row = (g, id) => {
    if (!rows[id]) {
      const now = kader[id];
      const snap = (g.roster && g.roster[id]) || {};
      // Feste Nummer aus dem Kader; bei wechselnden Nummern keine Nummer anzeigen
      const number = now ? (hasFixed(now) ? now.number : null) : snap.number;
      rows[id] = { id, name: now ? now.name : snap.name, number, goals: 0, games: 0 };
    }
    return rows[id];
  };
  for (const g of games) {
    // Eingesetzt = in der Startaufstellung oder eingewechselt
    const played = new Set((g.lineup || []).filter(Boolean));
    for (const e of g.events || []) if (e.type === 'sub') played.add(e.in);
    played.forEach(id => { row(g, id).games++; });
    for (const e of g.events || []) if (e.type === 'goal') row(g, e.scorer).goals++;
  }
  return Object.values(rows).sort((a, b) => b.goals - a.goals || b.games - a.games || (a.number - b.number));
}

let archivTab = 'spiele';

pages.archiv = {
  title: 'Archiv',
  async render() {
    const games = await endedGames();
    const kader = byId(await DB.all('players'));
    const tabs = `<div class="tabs">
      <button class="tab ${archivTab === 'spiele' ? 'on' : ''}" data-tab="spiele">Spiele (${games.length})</button>
      <button class="tab ${archivTab === 'tore' ? 'on' : ''}" data-tab="tore">Torschützen</button>
    </div>`;
    if (!games.length) {
      return tabs + `<div class="placeholder"><div class="sym">📋</div>
        <p>Noch keine beendeten Spiele.<br>Nach dem Abpfiff landet jedes Spiel automatisch hier.</p></div>`;
    }
    if (archivTab === 'tore') {
      const table = scorerTable(games, kader);
      const total = games.reduce((n, g) => n + gameScore(g).us, 0);
      return tabs + `
        <p class="hint">${games.length} ${games.length === 1 ? 'Spiel' : 'Spiele'} · ${total} eigene Tore ·
          „Spiele“ = in der Startelf oder eingewechselt</p>
        <div class="rep-box scorers">
          <div class="sc-row sc-head"><span>Spieler</span><span>Tore</span><span>Spiele</span></div>
          ${table.map(r => {
            // Gleich viele Tore = gleicher Platz
            const rank = 1 + table.filter(o => o.goals > r.goals).length;
            return `<div class="sc-row ${r.goals ? '' : 'zero'}">
            <span><b class="sc-rank">${r.goals ? rank + '.' : ''}</b> ${r.number ? '#' + esc(r.number) + ' ' : ''}${esc(r.name)}</span>
            <span class="sc-num">${r.goals}</span><span class="sc-num">${r.games}</span></div>`;
          }).join('')}
        </div>`;
    }
    return tabs + `<ul class="list">${games.map(g => {
      const s = gameScore(g);
      const res = s.us > s.them ? 'win' : s.us < s.them ? 'loss' : 'draw';
      return `<li><button class="row game-row" data-id="${g.id}">
        <span class="g-date">${esc(fmtDate(g.date))}</span>
        <span class="name">${esc(g.team)} – ${esc(g.opponent)}</span>
        <span class="g-score ${res}">${s.us}:${s.them}</span>
        <span class="chev">›</span>
      </button></li>`;
    }).join('')}</ul>`;
  },
  after() {
    view.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      archivTab = b.dataset.tab;
      show();
    }));
    view.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => go('bericht/' + b.dataset.id)));
  }
};

// Ein Spiel endgültig löschen (aus dem Bericht heraus)
async function deleteGameForever(g) {
  const s = gameScore(g);
  const ok = await dialog({
    title: 'Spiel löschen?',
    text: `${fmtDate(g.date)} ${g.team} – ${g.opponent} (${s.us}:${s.them}) wird mit Bericht und Toren endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Löschen', value: true, cls: 'danger' },
    ],
  });
  if (!ok) return;
  await DB.del('games', g.id);
  if ((await getMeta('current')) === g.id) await delMeta('current');
  toast('Spiel gelöscht');
  goBack('archiv');
}

// ---------- Sicherung ----------

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function buildBackup() {
  const [players, games, meta] = await Promise.all([DB.all('players'), DB.all('games'), DB.all('meta')]);
  return {
    app: 'spieltag',
    format: 1,
    exportedAt: new Date().toISOString(),
    players,
    games,
    meta: meta.filter(m => m.id !== 'lastBackup'),
  };
}

function backupName() {
  return `Spieltag-Sicherung_${today()}.json`;
}

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function backupAgeText(iso) {
  const d = daysAgo(iso);
  if (d === null) return 'Noch nie gesichert';
  if (d === 0) return 'Zuletzt gesichert: heute';
  if (d === 1) return 'Zuletzt gesichert: gestern';
  return `Zuletzt gesichert: vor ${d} Tagen`;
}

pages.sicherung = {
  title: 'Sicherung',
  async render() {
    const [players, games, last] = await Promise.all([DB.all('players'), DB.all('games'), getMeta('lastBackup')]);
    const d = daysAgo(last);
    return `
      <div class="status">
        <div><b>Auf diesem Handy:</b> ${players.length} Spieler, ${games.length} ${games.length === 1 ? 'Spiel' : 'Spiele'}</div>
        <div class="${d === null || d > 14 ? 'warn' : 'ok'}">${backupAgeText(last)}</div>
      </div>
      <p class="hint" style="margin-top:14px">Ihre Daten liegen nur auf diesem Handy. Speichern Sie ab und zu eine Sicherung –
        am besten per „Teilen“ an sich selbst (z. B. E-Mail oder Cloud). Damit können Sie alles auf
        demselben oder einem neuen Handy wiederherstellen.</p>
      <button class="btn primary wide" id="bk-save">💾 Sicherung speichern</button>
      ${navigator.share ? '<button class="btn wide" id="bk-share">📤 Sicherung teilen (z. B. per E-Mail)</button>' : ''}
      <h3 class="sub">Wiederherstellen</h3>
      <label class="btn wide">📂 Sicherung einspielen …
        <input type="file" id="bk-file" accept=".json,application/json" hidden>
      </label>
      <p class="hint">Achtung: Beim Einspielen werden alle Daten auf diesem Handy durch die Sicherung ersetzt.</p>`;
  },
  after() {
    document.getElementById('bk-save').addEventListener('click', async () => {
      const data = await buildBackup();
      downloadFile(backupName(), JSON.stringify(data), 'application/json');
      await setMeta('lastBackup', data.exportedAt);
      toast('Sicherung wird gespeichert (Ordner „Downloads“)', 3500);
      show();
    });
    const share = document.getElementById('bk-share');
    if (share) share.addEventListener('click', async () => {
      const data = await buildBackup();
      const file = new File([JSON.stringify(data)], backupName(), { type: 'application/json' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Spieltag-Sicherung', files: [file] });
        } else {
          downloadFile(backupName(), JSON.stringify(data), 'application/json');
        }
        await setMeta('lastBackup', data.exportedAt);
        show();
      } catch (e) { /* Teilen abgebrochen */ }
    });
    document.getElementById('bk-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await restoreBackup(file);
    });
  }
};

async function restoreBackup(file) {
  let data;
  try {
    data = JSON.parse((await file.text()).replace(/^﻿/, ''));
  } catch (e) { data = null; }
  if (!data || data.app !== 'spieltag' || !Array.isArray(data.players) || !Array.isArray(data.games)) {
    await dialog({ title: 'Keine gültige Sicherung', text: 'Diese Datei ist keine Sicherung der Spieltag-App.',
      buttons: [{ label: 'OK', value: true, cls: 'primary' }] });
    return;
  }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('de-DE') : 'unbekannt';
  const ok = await dialog({
    title: 'Sicherung einspielen?',
    text: `Sicherung vom ${when}: ${data.players.length} Spieler, ${data.games.length} Spiele. ` +
      'Alle aktuellen Daten auf diesem Handy werden dadurch ersetzt.',
    buttons: [
      { label: 'Abbrechen', value: false, cls: 'ghost' },
      { label: 'Einspielen', value: true, cls: 'danger' },
    ],
  });
  if (!ok) return;
  for (const s of ['players', 'games', 'meta']) await DB.clear(s);
  await DB.putAll('players', data.players);
  await DB.putAll('games', data.games);
  await DB.putAll('meta', (data.meta || []).filter(m => m && m.id));
  await setMeta('lastBackup', data.exportedAt || new Date().toISOString());
  toast('Sicherung eingespielt', 3000);
  setTimeout(() => { location.hash = ''; location.reload(); }, 800);
}
