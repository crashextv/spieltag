'use strict';
// Spielfeld: unsere Hälfte mit festen Plätzen gemäß Formation
// Markierung für die Offline-Prüfung in sw.js: build-5
//
// Platz 0 ist immer der Torwart, danach Abwehr (links → rechts),
// Mittelfeld und Sturm.

const ROLE_NAMES = { TW: 'Torwart', AB: 'Abwehr', MF: 'Mittelfeld', ST: 'Sturm' };

function fieldCount(f) { return 1 + f.def + f.mid + f.att; }
function formationText(f) { return `${f.def}-${f.mid}-${f.att}`; }

// Position (in Prozent) jedes Platzes auf dem Feld
function slotLayout(f) {
  const out = [{ role: 'TW', x: 50, y: 85 }];
  const rows = [['AB', f.def], ['MF', f.mid], ['ST', f.att]].filter(r => r[1] > 0);
  const top = 13, bottom = 63; // Sturm oben an der Mittellinie, Abwehr vor dem Strafraum
  rows.forEach(([role, n], k) => {
    const y = rows.length === 1 ? (top + bottom) / 2 : bottom - k * (bottom - top) / (rows.length - 1);
    for (let i = 0; i < n; i++) out.push({ role, x: (i + 0.5) * 100 / n, y });
  });
  return out;
}

// slots: Liste von Spieler-IDs (oder null) je Platz; players: {id: Spieler}
function renderPitch(formation, slots, players, cls = '') {
  const layout = slotLayout(formation);
  const maxRow = Math.max(formation.def, formation.mid, formation.att);
  const size = maxRow >= 5 ? 'tight' : '';
  return `<div class="pitch ${size} ${cls}">
    <div class="pl pl-circle"></div>
    <div class="pl pl-box"></div>
    <div class="pl pl-small"></div>
    <div class="pl-goal"></div>
    ${layout.map((s, i) => {
      const p = players[slots[i]];
      return `<button class="slot" data-slot="${i}" style="left:${s.x}%;top:${s.y}%">
        ${p ? avatar(p, 'pitch-av', initials(p.name)) : `<span class="avatar pitch-av empty-av">+</span>`}
        <span class="slot-label ${p ? '' : 'role'}">${p ? esc(p.number) : s.role}</span>
      </button>`;
    }).join('')}
  </div>`;
}
