'use strict';
// Trikot-Rückgabe: Nach jedem Spiel abhaken, wer sein (gewaschenes) Trikot zurückgegeben hat.
// Markierung für die Offline-Prüfung in sw.js: build-18

function tracksJerseys(g) {
  return !!(g.trackJerseys && g.clock && g.clock.phase === 'end');
}

// Alle noch offenen Trikots über alle beendeten Spiele
async function openJerseys() {
  const games = (await DB.all('games')).filter(tracksJerseys);
  const out = [];
  for (const g of games) {
    for (const id of g.squad) {
      if (g.jerseys && g.jerseys[id]) continue;
      const r = (g.roster && g.roster[id]) || {};
      out.push({ gameId: g.id, date: g.date, opponent: g.opponent, id, name: r.name || '?', number: r.number });
    }
  }
  return out;
}

function openCount(g) {
  return tracksJerseys(g) ? g.squad.filter(id => !(g.jerseys && g.jerseys[id])).length : 0;
}

pages.trikots = {
  title: 'Trikots',
  async render(gameId) {
    const kader = byId(await DB.all('players'));
    let games = (await DB.all('games')).filter(tracksJerseys)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.endedAt || 0) - (a.endedAt || 0));
    if (gameId) games = games.filter(g => g.id === gameId);
    else {
      // Spiele mit offenen Trikots, dazu immer das letzte Spiel
      games = games.filter((g, i) => i === 0 || openCount(g) > 0);
    }
    if (!games.length) {
      return `<div class="placeholder"><div class="sym">🎽</div>
        <p>Hier erscheint nach dem Abpfiff eine Liste, mit der Sie abhaken,
        wer sein Trikot zurückgegeben hat.</p></div>`;
    }
    const total = games.reduce((n, g) => n + openCount(g), 0);
    return `
      <div class="status ${total ? 'warn-box' : ''}">
        ${total ? `<b>${total} ${total === 1 ? 'Trikot ist' : 'Trikots sind'} noch nicht zurück.</b>`
          : '<span class="ok">Alle Trikots sind zurück ✓</span>'}
      </div>
      <p class="hint" style="margin-top:12px">Antippen, wenn das Trikot zurück ist. Nochmal antippen macht es rückgängig.</p>
      ${games.map(g => {
        // Offene Trikots zuerst, damit man sofort sieht, wer noch fehlt
        const back = id => !!(g.jerseys && g.jerseys[id]);
        const players = sortPlayers(g.squad.map(id => ({
          id, ...(g.roster[id] || {}), photo: kader[id] ? kader[id].photo : null,
        }))).sort((a, b) => back(a.id) - back(b.id));
        const open = openCount(g);
        return `<div class="jersey-game" data-game="${g.id}">
          <div class="jg-head">
            <div><b>${esc(fmtDate(g.date))}</b> · ${esc(g.team)} – ${esc(g.opponent)}</div>
            <div class="jg-count ${open ? 'open' : 'done'}">${open ? `${open} offen` : 'alle zurück ✓'}</div>
          </div>
          <ul class="list">${players.map(p => {
            const back = !!(g.jerseys && g.jerseys[p.id]);
            return `<li><button class="row pick jersey ${back ? 'on' : ''}" data-game="${g.id}" data-id="${p.id}">
              <span class="tick"></span>
              <span class="jersey-num">${esc(p.number)}</span>
              <span class="name">${esc(p.name)}</span>
              <span class="where">${back ? 'zurück' : 'offen'}</span>
            </button></li>`;
          }).join('')}</ul>
          ${open ? `<button class="btn wide" data-all="${g.id}">Alle Trikots dieses Spiels zurück</button>` : ''}
        </div>`;
      }).join('')}`;
  },
  after(gameId) {
    const toggle = async (gid, ids, value) => {
      const g = await DB.get('games', gid);
      if (!g) return;
      g.jerseys = g.jerseys || {};
      for (const id of ids) g.jerseys[id] = value === undefined ? !g.jerseys[id] : value;
      await DB.put('games', g);
      const left = openCount(g);
      if (left === 0) toast('Alle Trikots dieses Spiels sind zurück ✓');
      const y = view.scrollTop;
      await show();
      view.scrollTop = y;
    };
    view.querySelectorAll('.jersey[data-id]').forEach(b =>
      b.addEventListener('click', () => toggle(b.dataset.game, [b.dataset.id])));
    view.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', async () => {
      const g = await DB.get('games', b.dataset.all);
      const ok = await dialog({
        title: 'Alle Trikots zurück?',
        text: `Alle ${openCount(g)} offenen Trikots vom Spiel gegen ${g.opponent} als zurück abhaken?`,
        buttons: [
          { label: 'Abbrechen', value: false, cls: 'ghost' },
          { label: 'Ja, alle zurück', value: true, cls: 'primary' },
        ],
      });
      if (ok) toggle(g.id, g.squad, true);
    }));
  }
};
