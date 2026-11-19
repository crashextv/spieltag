'use strict';
// Spielfeld: unsere Hälfte mit festen Plätzen gemäß Formation
// Markierung für die Offline-Prüfung in sw.js: build-7
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
      return `<button class="slot" data-slot="${i}" data-drop="slot:${i}" ${p ? `data-drag="slot:${i}"` : ''}
          style="left:${s.x}%;top:${s.y}%">
        ${p ? avatar(p, 'pitch-av', initials(p.name)) : `<span class="avatar pitch-av empty-av">+</span>`}
        <span class="slot-label ${p ? '' : 'role'}">${p ? esc(p.number) : s.role}</span>
      </button>`;
    }).join('')}
  </div>`;
}

// ---------- Ziehen und Ablegen ----------
// Elemente mit data-drag="slot:3" oder data-drag="bench:<id>" lassen sich ziehen,
// Elemente mit data-drop="slot:3" oder data-drop="bench" nehmen sie auf.
// Ein kurzer Tipp (ohne Bewegung) bleibt ein normaler Tipp.
function parseDnd(s) {
  const [type, v] = String(s).split(':');
  return type === 'slot' ? { type, i: +v } : { type, id: v };
}

function makeDraggable(container, onDrop) {
  let st = null;
  let suppressClick = false;

  container.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-drag]');
    if (!el || !container.contains(el) || e.button > 0) return;
    st = { el, src: parseDnd(el.dataset.drag), x: e.clientX, y: e.clientY, pid: e.pointerId, ghost: null, over: null };
  });

  container.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.pid) return;
    if (!st.ghost) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 8) return; // noch ein Tipp
      const av = st.el.querySelector('.avatar') || st.el;
      st.ghost = av.cloneNode(true);
      st.ghost.classList.add('drag-ghost');
      document.body.appendChild(st.ghost);
      st.el.classList.add('dragging');
      try { st.el.setPointerCapture(e.pointerId); } catch (_) {}
    }
    e.preventDefault();
    st.ghost.style.left = e.clientX + 'px';
    st.ghost.style.top = e.clientY + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const tgt = under && under.closest('[data-drop]');
    const over = tgt && container.contains(tgt) && tgt !== st.el ? tgt : null;
    if (over !== st.over) {
      if (st.over) st.over.classList.remove('drop-hover');
      if (over) over.classList.add('drop-hover');
      st.over = over;
    }
  });

  const end = e => {
    if (!st || e.pointerId !== st.pid) return;
    const s = st;
    st = null;
    if (!s.ghost) return; // war nur ein Tipp
    s.ghost.remove();
    s.el.classList.remove('dragging');
    if (s.over) s.over.classList.remove('drop-hover');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 300);
    if (e.type === 'pointerup' && s.over) onDrop(s.src, parseDnd(s.over.dataset.drop));
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);

  // Nach dem Ziehen keinen zusätzlichen "Tipp" auf Spieler oder Plätze auslösen
  // (andere Knöpfe wie die Uhr bleiben sofort bedienbar)
  container.addEventListener('click', e => {
    if (suppressClick && e.target.closest('[data-drag],[data-drop]')) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }, true);
}
