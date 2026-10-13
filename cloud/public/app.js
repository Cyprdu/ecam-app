// ECAM — app iPhone/PC. Vanilla JS, routage par hash.
const SHORTCUT_REC = 'ECAM Enregistrer';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (n, cls = '') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const nowStr = () => new Date().toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

let KEY = store.get('key');
let S = JSON.parse(store.get('state') || 'null') || { events: [], subjects: [], files: [], tasks: [], jobs: [] };
let selDay = todayStr();
let showDone = false;

// ---------- Réseau ----------
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { ...opts, headers: { 'x-key': KEY, ...(opts.json ? { 'content-type': 'application/json' } : {}), ...opts.headers }, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  } catch {
    // « Failed to fetch » / « Load failed » : pas de réseau (sortie de veille, changement de Wi-Fi…)
    setOffline(true);
    throw Object.assign(new Error('Pas de connexion internet, réessaie'), { offline: true });
  }
  setOffline(false);
  if (res.status === 401) { KEY = null; store.set('key', ''); render(); throw new Error('Clé invalide'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}
async function refresh() {
  if (!KEY) return;
  try {
    const st = await api('/state');
    if (!st.events) st.events = S.events; // calendrier momentanément indisponible : garder le cache
    else st.calAt = Date.now();
    S = { ...st, calAt: st.calAt || S.calAt };
    colorOrder = null;
    store.set('state', JSON.stringify(S));
    render(false);
    dispatchEvent(new Event('ecam-state')); // l'app iPhone reprogramme ses rappels
    retryIn = 0;
  } catch (e) {
    // Mise à jour automatique : jamais de message, on réessaie un peu plus tard (5 s, 15 s, 1 min…)
    retryIn = Math.min((retryIn || 2.5) * 2, 60);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(refresh, retryIn * 1000);
    if (!e.offline) console.warn('Actualisation impossible :', e.message);
  }
}
let retryIn = 0, retryTimer;
function setOffline(off) {
  document.body.classList.toggle('offline', off);
}
addEventListener('online', () => refresh());
addEventListener('offline', () => setOffline(true));

// ---------- Utilitaires ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.innerHTML = (ms === 0 ? '<span class="spinner"></span>' : '') + esc(msg);
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const dFmt = (s, o) => new Date(s.length === 10 ? s + 'T12:00' : s).toLocaleDateString('fr-FR', o);
const dayLabel = (s) => {
  const diff = Math.round((Date.parse(s.slice(0, 10)) - Date.parse(todayStr())) / 864e5);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return dFmt(s, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/^./, (c) => c.toUpperCase());
};
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// 12 couleurs bien distinctes, attribuées dans l'ordre d'apparition des matières : chacune garde la sienne partout
const PALETTE = ['#e8590c', '#0f8b8d', '#2f6fd6', '#c2367a', '#4d8a2a', '#b07d12', '#d1423a', '#136f9c', '#7c5c3b', '#5f6b7a', '#1f9d6b', '#8a4fbf'];
let colorOrder = null;
const color = (s) => {
  colorOrder ||= [...new Set(S.events.filter((e) => /^(CM|TD|TP|DS|Projet)/i.test(e.type || '')).map((e) => e.subject))];
  const i = colorOrder.indexOf(s);
  return PALETTE[(i < 0 ? hue(s) : i) % PALETTE.length];
};
const filesOf = (pred) => S.files.filter(pred);
const isDS = (e) => /^(DS|Examen|Partiel|Contr)/i.test(e.type || '');
const COURSE_TYPE = /^(CM|TD|TP|DS|Projet|Examen|Partiel|Contr)/i;
function subjects() {
  const hidden = new Set(S.subjects.filter((s) => s.hidden).map((s) => s.name));
  const soon = new Date(Date.now() + 7 * 864e5).toLocaleDateString('sv-SE');
  const names = new Set([
    ...S.events.filter((e) => COURSE_TYPE.test(e.type || '') && e.start.slice(0, 10) <= soon).map((e) => e.subject),
    ...S.subjects.filter((s) => !s.hidden).map((s) => s.name),
    ...S.files.map((f) => f.subject),
  ]);
  return [...names].filter((n) => n && !hidden.has(n) && !/^Rattrapage/i.test(n)).sort((a, b) => a.localeCompare(b, 'fr'));
}
const findEvent = (uid) => S.events.find((e) => e.uid === uid);
const jobState = (j) => ({ pending: ['En attente du PC', 'warn', 'clock'], running: ['Traitement en cours', 'accent', 'refresh'], failed: ['Échec', 'warn', 'x'], done: ['Terminé', 'ok', 'check'] })[j.status];
const fileIcon = (f) => ({ audio: 'mic', fiche: 'sparkles', transcript: 'text' })[f.kind] || 'file';
const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1e3)) + ' Ko');

// ---------- Feuille modale ----------
let sheetGen = 0; // une feuille rouverte pendant la fermeture de la précédente ne doit pas être cachée
const sheetDocked = () => !matchMedia('(min-width: 1024px)').matches; // téléphone/tablette : feuille en bas d'écran
function openSheet(html, onMount) {
  const sh = $('#sheet'), bd = $('#backdrop');
  sheetGen++;
  sh.classList.remove('closing'); bd.classList.remove('closing');
  sh.style.transition = sh.style.transform = sh.style.opacity = bd.style.transition = bd.style.opacity = '';
  sh.innerHTML = html; sh.hidden = false; bd.hidden = false; sh.scrollTop = 0;
  onMount?.(sh);
}
function closeSheet() {
  const sh = $('#sheet'), bd = $('#backdrop');
  if (sh.hidden || sh.classList.contains('closing')) return;
  const gen = sheetGen;
  sh.classList.add('closing'); bd.classList.add('closing');
  if (sheetDocked()) { sh.style.transition = 'transform .3s cubic-bezier(.32, .72, 0, 1)'; sh.style.transform = 'translateY(100%)'; } else { sh.style.transition = 'opacity .2s'; sh.style.opacity = 0; }
  bd.style.transition = 'opacity .3s'; bd.style.opacity = 0;
  setTimeout(() => { if (gen === sheetGen) { sh.hidden = bd.hidden = true; sh.classList.remove('closing'); bd.classList.remove('closing'); sh.style.transition = sh.style.transform = sh.style.opacity = bd.style.transition = bd.style.opacity = ''; } }, 300);
}
$('#backdrop').onclick = closeSheet;

// Glisser la feuille vers le bas pour la fermer : depuis la poignée, ou de n'importe où quand son contenu est tout en haut
(() => {
  const sh = $('#sheet'), bd = $('#backdrop');
  let g = null;
  sh.addEventListener('touchstart', (e) => {
    if (!sheetDocked() || e.touches.length !== 1 || e.target.closest('input[type=range], textarea, select')) return (g = null);
    const t = e.touches[0];
    g = { y: t.clientY, x: t.clientX, last: t.clientY, t: Date.now(), v: 0, dy: 0, on: false, grip: t.clientY - sh.getBoundingClientRect().top < 40 };
  }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0], dy = t.clientY - g.y;
    if (!g.on) {
      if (Math.abs(t.clientX - g.x) > Math.abs(dy) && !g.grip) return (g = null); // geste horizontal : pas pour nous
      if (dy < 6 || (!g.grip && sh.scrollTop > 0)) { if (dy < -6 && !g.grip) g = null; return; }
      g.on = true; g.y = t.clientY; sh.style.transition = bd.style.transition = 'none';
    }
    e.preventDefault();
    const now = Date.now();
    g.v = (t.clientY - g.last) / Math.max(1, now - g.t); g.last = t.clientY; g.t = now;
    g.dy = Math.max(0, t.clientY - g.y) + Math.min(0, t.clientY - g.y) * 0.15; // vers le haut : léger élastique
    sh.style.transform = `translateY(${g.dy}px)`;
    bd.style.opacity = Math.max(0, 1 - g.dy / sh.offsetHeight);
  }, { passive: false });
  const end = () => {
    if (!g?.on) return (g = null);
    const { dy, v } = g; g = null;
    if (dy > Math.min(140, sh.offsetHeight * 0.3) || (v > 0.5 && dy > 20)) { haptic('light'); closeSheet(); return; }
    sh.style.transition = 'transform .38s cubic-bezier(.32, .72, 0, 1)'; bd.style.transition = 'opacity .38s';
    sh.style.transform = 'translateY(0)'; bd.style.opacity = '';
  };
  sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
})();

// ---------- Vues ----------
function vLogin() {
  return `<div class="login">
    <div class="logo">${icon('book')}</div>
    <div class="head"><div><h1>Bienvenue</h1><div class="sub">Colle ta clé d'accès pour relier l'app à ton espace.</div></div></div>
    <label class="field"><span>Clé d'accès</span><input id="key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <button class="btn" id="go">Continuer</button>
    <p class="note">La clé se trouve dans <code>_APP/cloud/.dev.vars</code> sur ton PC (ligne APP_KEY).</p>
  </div>`;
}

function eventCard(e, withDate) {
  const fs = filesOf((f) => f.event_uid === e.uid);
  const jobs = S.jobs.filter((j) => j.event_uid === e.uid && j.type === 'cours' && j.status !== 'done');
  const tasks = S.tasks.filter((t) => t.event_uid === e.uid && !t.done);
  const chips = [];
  if (isDS(e)) chips.push(`<span class="chip warn">${icon('target')}DS</span>`);
  if (fs.some((f) => f.kind === 'fiche')) chips.push(`<span class="chip ok">${icon('sparkles')}Fiche</span>`);
  else if (jobs.length) chips.push(`<span class="chip ${jobState(jobs[0])[1]}">${icon(jobState(jobs[0])[2])}${jobState(jobs[0])[0]}</span>`);
  if (fs.some((f) => f.kind === 'audio') && !jobs.length) chips.push(`<span class="chip">${icon('mic')}Audio</span>`);
  const docs = fs.filter((f) => f.kind === 'doc').length;
  if (docs) chips.push(`<span class="chip">${icon('file')}${docs}</span>`);
  if (tasks.length) chips.push(`<span class="chip accent">${icon('check')}${tasks.length} à faire</span>`);
  const past = (e.end || e.start) < nowStr();
  const live = e.start <= nowStr() && nowStr() < (e.end || e.start);
  return `<a class="card event ${past ? 'past' : ''} ${live ? 'live' : ''}" href="#cours/${encodeURIComponent(e.uid)}">
    <div class="time"><b>${e.start.slice(11, 16)}</b><span>${(e.end || '').slice(11, 16)}</span></div>
    <div class="bar" style="background:${color(e.subject)}"></div>
    <div class="body">
      <div class="title">${esc(e.subject)}</div>
      <div class="meta">${live ? '<span class="live-dot">En cours</span>' : ''}${withDate ? `<span>${dFmt(e.start, { weekday: 'short', day: 'numeric', month: 'short' })}</span>` : ''}${e.type ? `<span>${esc(e.type)}</span>` : ''}${e.room ? `<span>${icon('pin')}${esc(e.room)}</span>` : ''}${e.teacher ? `<span>${icon('user')}${esc(e.teacher)}</span>` : ''}</div>
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    </div>
  </a>`;
}

const addDays = (ds, n) => { const d = new Date(ds.slice(0, 10) + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const monday = (ds) => addDays(ds, -((new Date(ds.slice(0, 10) + 'T12:00').getDay() + 6) % 7));

function upcoming(days) {
  const now = nowStr(), lim = new Date(Date.now() + days * 864e5).toLocaleDateString('sv-SE') + 'T23:59';
  const items = [
    ...S.tasks.filter((t) => !t.done).map((t) => ({ ...t, isTask: true })),
    ...S.events.filter((e) => isDS(e) && e.start >= now && !S.tasks.some((t) => t.event_uid === e.uid)).map((e) => ({ title: 'DS', subject: e.subject, due: e.start, kind: 'ds', event_uid: e.uid })),
  ];
  return items.filter((i) => i.due <= lim).sort((a, b) => a.due.localeCompare(b.due));
}

function reminderRow(r) {
  const late = r.due < nowStr() && r.isTask;
  const tag = r.kind === 'ds' ? `<span class="chip warn">${icon('target')}DS</span>` : '';
  const lead = r.isTask
    ? `<button class="lead" data-done="${r.id}" aria-label="Marquer comme fait">${icon(r.done ? 'check' : 'clock')}</button>`
    : `<span class="lead">${icon('target')}</span>`;
  const href = `data-detail="${esc(r.isTask ? 't:' + r.id : 'ev:' + r.event_uid)}"`;
  return `<div class="row" ${href}>${lead}<div class="grow"><div class="t">${esc(r.title)}</div><div class="s" style="${late ? 'color:var(--danger)' : ''}">${esc(r.subject)} · ${dayLabel(r.due)}${r.due.slice(11, 16) !== '00:00' ? ' ' + r.due.slice(11, 16) : ''}</div>${r.note ? `<div class="s wrap" style="color:var(--text);margin-top:3px">${esc(r.note)}</div>` : ''}</div>${tag}</div>`;
}

// Début de l'année scolaire : 15 août
function schoolStart() {
  const n = new Date();
  return new Date(n.getMonth() >= 7 ? n.getFullYear() : n.getFullYear() - 1, 7, 15);
}

function agendaHead() {
  const today = todayStr();
  return `<div class="head"><div><h1>${dayLabel(selDay)}</h1><div class="sub">${dFmt(selDay, { weekday: 'long', day: 'numeric', month: 'long' })}${S.calAt ? ' · à jour ' + new Date(S.calAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</div></div>
      <div style="display:flex;gap:8px">
        ${selDay !== today ? `<button class="icon-btn" data-day="${today}" aria-label="Aujourd'hui">${icon('calendar')}</button>` : ''}
        <label class="icon-btn" style="position:relative" aria-label="Aller à une date">${icon('clock')}<input type="date" id="goto-day" value="${selDay}" style="position:absolute;inset:0;opacity:0;width:100%"></label>
      </div></div>`;
}

// Vacances de l'ECAM (dates données par l'étudiant : le calendrier ECAM ne les contient pas)
const VACANCES = [['2026-10-24', '2026-11-01', 'Vacances de la Toussaint']];
const vacationOf = (day) => VACANCES.find(([a, b]) => day >= a && day <= b);
const longDay = (d) => dFmt(d, { weekday: 'long', day: 'numeric', month: 'long' });

// Contenu d'un jour : ses cours, puis ses DS et devoirs (seulement ceux de ce jour-là)
function dayPane(day) {
  const evs = S.events.filter((e) => e.start.startsWith(day));
  const shown = new Set(evs.map((e) => e.uid));
  const dayItems = upcoming(3650).filter((r) => r.due.startsWith(day) && !(!r.isTask && shown.has(r.event_uid))); // un DS du calendrier a déjà sa carte
  const items = dayItems.length ? `<div class="section-title">Ce jour-là</div><div class="list">${dayItems.map(reminderRow).join('')}</div>` : '';
  const vac = !evs.length && vacationOf(day);
  if (vac) return `<div class="empty vacation"><div class="vac-sun">${icon('sun')}</div><b>${vac[2]}</b><div class="note">Du ${longDay(vac[0])} au ${longDay(vac[1])}<br>Reprise le ${longDay(addDays(vac[1], 1))}</div></div>${items}`;
  return `${evs.length ? evs.map((e) => eventCard(e)).join('') : `<div class="empty">${icon('calendar')}<div>Aucun cours ce jour-là${day < (S.events[0]?.start || '') ? '<br><span class="note">Le calendrier ECAM ne contient pas les cours d’avant le ' + dFmt(S.events[0].start, { day: 'numeric', month: 'long' }) + '.</span>' : ''}</div></div>`}
    ${items}`;
}
const panes = () => [-1, 0, 1].map((n) => `<div class="pane">${dayPane(addDays(selDay, n))}</div>`).join('');

function vAgenda() {
  const today = todayStr();
  const start = schoolStart();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lundi
  const last = S.events.length ? S.events[S.events.length - 1].start.slice(0, 10) : today;
  const end = new Date(Math.max(Date.parse(last), Date.now()) + 14 * 864e5);
  const daysWithEv = new Set(S.events.map((e) => e.start.slice(0, 10)));
  let strip = '';
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toLocaleDateString('sv-SE');
    strip += `<button class="day ${ds === today ? 'today' : ''} ${ds === selDay ? 'sel' : ''} ${daysWithEv.has(ds) ? 'has' : ''} ${!daysWithEv.has(ds) && vacationOf(ds) ? 'vac' : ''}" data-day="${ds}"><small>${d.toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3)}</small><b>${d.getDate()}</b><i></i></button>`;
  }
  return `<div id="ag-head">${agendaHead()}</div>
    <div class="days-wrap"><button class="days-nav" data-week="-7" aria-label="Semaine précédente">${icon('chevron-left')}</button><div class="days" id="days">${strip}</div><button class="days-nav" data-week="7" aria-label="Semaine suivante">${icon('chevron-right')}</button></div>
    <div class="pager" id="pager"><div class="track" id="track">${panes()}</div></div>`;
}

function fileRows(fs) {
  return fs.map((f) => `<button class="row" data-file="${f.id}"><span class="lead">${icon(fileIcon(f))}</span><div class="grow"><div class="t">${esc(f.name)}</div><div class="s">${dFmt(f.created, { day: 'numeric', month: 'short' })} · ${size(f.size)}</div></div>${icon('chevron-right', 'chev')}</button>`).join('');
}

const QUIET_H = 3; // comme le serveur

function jobRows(js) {
  return js.map((j) => {
    const [label, , ic] = jobState(j);
    const p = JSON.parse(j.params || '{}');
    const what = j.type === 'cours' ? 'Fiche du cours' : j.type === 'programme' ? 'Liste des notions du cours' : p.mode === 'ds' ? 'Préparation au DS' : 'Synthèse de la matière';
    const n = (p.audios || [p.audio]).length;
    const waiting = j.type === 'cours' && j.status === 'pending' && !p.ready;
    const detail = j.status === 'failed' ? `${label} — touche pour relancer`
      : waiting ? `Se fera ${p.after && p.after > nowStr() ? 'après la fin du cours, ' : ''}${QUIET_H} h après ton dernier ajout : tu peux encore envoyer des enregistrements ou des documents`
      : j.status === 'pending' ? `${label} — sera traité dès que ton PC est allumé` : label;
    return `<div class="row" ${j.status === 'failed' ? `data-retry="${j.id}"` : ''}><span class="lead">${icon(waiting ? 'clock' : ic, j.status === 'running' ? 'spin' : '')}</span><div class="grow"><div class="t">${what}${j.type === 'cours' && n > 1 ? ` · ${n} enregistrements` : ''}</div><div class="s wrap">${detail}</div></div></div>`;
  }).join('');
}

function vCours(uid) {
  const e = findEvent(uid);
  if (!e) return `<a class="back" href="#agenda">${icon('chevron-left')}Agenda</a><div class="empty">Cours introuvable</div>`;
  const fs = filesOf((f) => f.event_uid === uid);
  const jobs = S.jobs.filter((j) => j.event_uid === uid && j.status !== 'done');
  const tasks = S.tasks.filter((t) => t.event_uid === uid);
  const fiches = fs.filter((f) => f.kind === 'fiche');
  const audio = fs.filter((f) => f.kind === 'audio' || f.kind === 'transcript');
  const docs = fs.filter((f) => f.kind === 'doc');
  return `<a class="back" href="javascript:history.back()">${icon('chevron-left')}Retour</a>
    <div class="head"><div><h1 style="font-size:26px">${esc(e.subject)}</h1>
      <div class="sub">${dayLabel(e.start)} · ${e.start.slice(11, 16)}–${(e.end || '').slice(11, 16)}${e.type ? ' · ' + esc(e.type) : ''}</div>
      <div class="sub">${[e.room, e.teacher].filter(Boolean).map(esc).join(' · ')}</div></div></div>
    <div class="actions">
      <button class="card action rec" id="rec">${icon('mic')}Enregistrer</button>
      <button class="card action" id="add-doc">${icon('file-plus')}Document</button>
      <button class="card action" id="add-task">${icon('list-plus')}Devoir</button>
    </div>
    ${(audio.length || docs.length) && !jobs.some((j) => JSON.parse(j.params || '{}').ready || j.status === 'running') ? `<div class="list" style="margin-top:10px"><button class="row" id="fiche-now"><span class="lead">${icon('sparkles')}</span><div class="grow"><div class="t">${fiches.length ? 'Refaire la fiche maintenant' : 'Faire la fiche maintenant'}</div><div class="s">Avec ${[audio.filter((f) => f.kind === 'audio').length && audio.filter((f) => f.kind === 'audio').length + ' enregistrement(s)', docs.length && docs.length + ' document(s)'].filter(Boolean).join(' et ') || 'ce qui est envoyé'}, sans attendre</div></div></button></div>` : ''}
    <div class="list" style="margin-top:10px"><button class="row" data-ask="cours"><span class="lead">${icon('sparkles')}</span><div class="grow"><div class="t">Demander à Claude</div><div class="s">Explique-moi ce cours, fais-en une fiche…</div></div>${icon('chevron-right', 'chev')}</button>
      <button class="row" id="add-transcript"><span class="lead">${icon('text')}</span><div class="grow"><div class="t">Ajouter la transcription en texte</div><div class="s">Texte du cours tapé ou collé, à la place ou en plus de l’audio</div></div>${icon('chevron-right', 'chev')}</button></div>
    ${fiches.length || jobs.length ? `<div class="section-title">Fiche de révision</div><div class="list">${fiches.map((f) => `<a class="row" href="#fiche/${f.id}"><span class="lead">${icon('sparkles')}</span><div class="grow"><div class="t">${esc(f.name)}</div><div class="s">Prête · ${dFmt(f.created, { day: 'numeric', month: 'short' })}</div></div>${icon('chevron-right', 'chev')}</a>`).join('')}${jobRows(jobs)}</div>` : ''}
    ${tasks.length ? `<div class="section-title">Devoirs</div><div class="list">${tasks.map((t) => reminderRow({ ...t, isTask: true })).join('')}</div>` : ''}
    <div class="section-title">Documents</div>
    ${docs.length ? `<div class="list">${fileRows(docs.map((f) => ({ ...f, name: f.name.slice(f.name.lastIndexOf('/') + 1) })))}</div>` : `<p class="note">Aucun document pour ce cours. Ajoute les supports du prof : ils serviront pour les fiches.</p>`}
    <div class="list" style="margin-top:10px"><a class="row" href="#matiere/${encodeURIComponent(e.subject)}"><span class="lead">${icon('book')}</span><div class="grow"><div class="t">Tous les documents de la matière</div><div class="s">${docCount(e.subject)} documents et fiches</div></div>${icon('chevron-right', 'chev')}</a></div>
    ${audio.length ? `<div class="section-title">Enregistrements</div><div class="list">${fileRows(audio)}</div>` : ''}`;
}

// ---------- Matières : une icône et une couleur par matière ----------
const SUBJECT_ICONS = [
  [/math/, 'sigma'], [/reseau/, 'network'], [/si industriel|industriel|production/, 'factory'], [/actifs|\bot\b/, 'shield'],
  [/projet/, 'kanban'], [/capital humain|humain/, 'users'], [/ethique|droit/, 'scale'], [/structure|vie de l.entreprise/, 'building'],
  [/approches|metiers/, 'briefcase'], [/systemes d.information/, 'database'], [/anglais/, 'globe'], [/python|algorithm/, 'code'],
  [/linux|windows|shell/, 'terminal'], [/front|web/, 'layout'], [/communication/, 'message'], [/architecture|materiel|composants/, 'cpu'],
];
const subjectIcon = (s) => (SUBJECT_ICONS.find(([re]) => re.test(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) || [0, 'book'])[1];

// Moyenne d'une matière d'après les notes ECAM (pondérée par le barème)
function subjectAverage(s) {
  const ns = (S.ecam?.notes || []).filter((n) => n.subject === s && !isNaN(num(n.grade)));
  const w = ns.reduce((t, n) => t + (parseFloat(n.weight) || 100), 0);
  return ns.length ? ns.reduce((t, n) => t + num(n.grade) * (parseFloat(n.weight) || 100), 0) / w : null;
}

function subjectTile(s) {
  const n = S.files.filter((f) => f.subject === s && ['doc', 'transcript', 'audio'].includes(f.kind)).length;
  const fiches = S.files.filter((f) => f.subject === s && f.kind === 'fiche').length;
  const next = S.events.find((e) => e.subject === s && e.start >= nowStr());
  const ds = upcoming(60).find((r) => r.subject === s && r.kind === 'ds');
  const dsIn = ds && Math.round((Date.parse(ds.due.slice(0, 10)) - Date.parse(todayStr())) / 864e5);
  return `<a class="tile-subject" href="#matiere/${encodeURIComponent(s)}" style="--c:${color(s)}">
    <svg class="bg"><use href="#i-${subjectIcon(s)}"/></svg>
    ${ds ? `<span class="badge">${icon('target')}DS ${dsIn === 0 ? 'aujourd’hui' : dsIn === 1 ? 'demain' : 'J-' + dsIn}</span>` : '<span></span>'}
    <b>${esc(s)}</b>
    <span class="meta">${n} doc${n > 1 ? 's' : ''}${fiches ? ` · ${fiches} fiche${fiches > 1 ? 's' : ''}` : ''}${next ? ` · ${dayLabel(next.start).toLowerCase()}` : ''}</span>
  </a>`;
}

// Cartes DS : compte à rebours bien visible
function dsCard(r) {
  const d = Math.round((Date.parse(r.due.slice(0, 10)) - Date.parse(todayStr())) / 864e5);
  return `<button class="ds-card" data-detail="${esc(r.isTask ? 't:' + r.id : 'ev:' + r.event_uid)}" style="--c:${color(r.subject)}">
    <span class="j">${d <= 0 ? 'Auj.' : d === 1 ? 'Demain' : 'J-' + d}</span>
    <b>${esc(r.subject)}</b>
    <span class="when">${dayLabel(r.due)}${r.due.slice(11, 16) !== '00:00' ? ' · ' + r.due.slice(11, 16) : ''}</span>
    ${r.note ? `<span class="hint">${icon('bell')}${esc(r.note)}</span>` : ''}
    <span class="flags">${prepFiche(r.subject, r.event_uid) ? `<span>${icon('sparkles')}Prépa prête</span>` : ''}${parseScope(r)?.notions?.length ? `<span>${parseScope(r).notions.length} notions</span>` : ''}</span>
  </button>`;
}

function vRappels(arg) {
  const tab = arg === 'matieres' ? 'matieres' : 'faire';
  const seg = `<div class="seg big"><a href="#devoirs" class="${tab === 'faire' ? 'on' : ''}">À faire</a><a href="#devoirs/matieres" class="${tab === 'matieres' ? 'on' : ''}">Matières</a></div>`;
  if (tab === 'matieres') {
    const subs = subjects();
    return `<div class="head"><div><h1>Devoirs</h1><div class="sub">${subs.length} matières</div></div></div>${seg}
      <div class="subject-grid">${subs.map(subjectTile).join('')}</div>`;
  }
  const all = upcoming(3650);
  const dsList = all.filter((r) => r.kind === 'ds' && r.due >= todayStr());
  const rest = all.filter((r) => !(r.kind === 'ds' && r.due >= todayStr()));
  const late = rest.filter((r) => r.due < todayStr());
  const sunday = addDays(monday(todayStr()), 6), nextSunday = addDays(sunday, 7);
  const soon = rest.filter((r) => r.due >= todayStr() && r.due.slice(0, 10) <= sunday);
  const next = rest.filter((r) => r.due.slice(0, 10) > sunday && r.due.slice(0, 10) <= nextSunday);
  const later = rest.filter((r) => r.due.slice(0, 10) > nextSunday);
  const done = S.tasks.filter((t) => t.done);
  const block = (title, items) => (items.length ? `<div class="section-title">${title}</div><div class="list">${items.map(reminderRow).join('')}</div>` : '');
  return `<div class="head"><div><h1>Devoirs</h1><div class="sub">${dsList.length ? `${dsList.length} DS à venir · ` : ''}${rest.length ? rest.length + ' devoir' + (rest.length > 1 ? 's' : '') : 'aucun devoir'}</div></div><button class="icon-btn" id="add-task" aria-label="Ajouter">${icon('plus')}</button></div>${seg}
    ${dsList.length ? `<div class="section-title">DS à venir</div><div class="ds-strip">${dsList.map(dsCard).join('')}</div>` : ''}
    ${all.length ? '' : `<div class="empty">${icon('bell')}<div>Rien à prévoir. Ajoute un devoir avec le bouton +, ou depuis un cours de l'agenda.</div></div>`}
    ${block('En retard', late)}${block('Cette semaine', soon)}${block('Semaine prochaine', next)}${block('Plus tard', later)}
    ${done.length ? `<div class="section-title">Terminés <button id="toggle-done">${showDone ? 'Masquer' : `Afficher (${done.length})`}</button></div>${showDone ? `<div class="list">${done.map((t) => reminderRow({ ...t, isTask: true })).join('')}</div>` : ''}` : ''}`;
}

function notionsSection(name) {
  const prog = S.programmes?.[name], job = programmeJob(name);
  if (!prog) return `<div class="list" style="margin-top:10px">${job ? `<div class="row"><span class="lead">${icon('refresh', 'spin')}</span><div class="grow"><div class="t">Liste des notions en préparation</div><div class="s">Ton PC la fait établir par Claude — tu seras notifié</div></div></div>`
    : `<button class="row" data-prog="${esc(name)}"><span class="lead">${icon('kanban')}</span><div class="grow"><div class="t">Lister les notions du cours</div><div class="s">Pour choisir ce qui tombe à chaque DS</div></div>${icon('chevron-right', 'chev')}</button>`}</div>`;
  return `<details class="notions"><summary class="section-title">Notions du cours <span style="text-transform:none;letter-spacing:0;font-weight:500">${prog.notions.length} · voir</span></summary>
    <div class="list">${prog.notions.map((n) => `<div class="row plain"><div class="grow"><div class="t" style="white-space:normal">${esc(n.titre)}${'<span class="imp"></span>'.repeat(n.importance || 0)}</div><div class="s wrap">${n.seances?.length ? n.seances.map((d) => dFmt(d, { day: 'numeric', month: 'short' })).join(', ') + ' · ' : ''}${esc(n.resume || '')}</div></div></div>`).join('')}</div>
    <p class="note">Établie ${ago(prog.at)} · ${job ? 'mise à jour en cours…' : `<button class="link" data-prog="${esc(name)}">Mettre à jour</button>`}</p></details>`;
}

// ---------- Page d'une matière : tout ce qui la concerne ----------
function vMatiere(name) {
  const evs = S.events.filter((e) => e.subject === name);
  const past = evs.filter((e) => e.start <= nowStr()).reverse();
  const next = evs.filter((e) => e.start > nowStr()).slice(0, 3);
  const fiches = S.files.filter((f) => f.subject === name && f.kind === 'fiche');
  const docs = S.files.filter((f) => f.subject === name && ['doc', 'transcript', 'audio'].includes(f.kind));
  const jobs = S.jobs.filter((j) => j.subject === name && j.type === 'revision' && j.status !== 'done');
  const todo = upcoming(3650).filter((r) => r.subject === name);
  const avg = subjectAverage(name);
  // Documents rangés par dossier d'origine (« COURS 1/… », « DS FACTIS/… »), sinon par cours
  const groups = {};
  for (const f of docs) {
    const i = f.name.lastIndexOf('/');
    const g = i > 0 ? f.name.slice(0, i) : f.event_uid ? 'Cours du ' + dFmt(f.event_uid.split('|')[0], { day: 'numeric', month: 'short' }) : 'Documents';
    (groups[g] ||= []).push(f);
  }
  return `<a class="back" href="javascript:history.back()">${icon('chevron-left')}Retour</a>
    <div class="subject-hero" style="--c:${color(name)}">
      <svg class="bg"><use href="#i-${subjectIcon(name)}"/></svg>
      <h1>${esc(name)}</h1>
      <div class="stats">
        <span><b>${docs.length}</b>documents</span><span><b>${fiches.length}</b>fiches</span><span><b>${past.length}</b>séances</span>
        ${avg != null ? `<span><b>${avg.toFixed(1)}</b>moyenne</span>` : ''}
      </div>
    </div>
    <div class="actions">
      <button class="card action primary" data-claude="fiche" data-subject="${esc(name)}">${icon('sparkles')}Fiche</button>
      <button class="card action" data-claude="memo" data-subject="${esc(name)}">${icon('text')}Mémo</button>
      <button class="card action" data-claude="quiz" data-subject="${esc(name)}">${icon('check')}Quiz</button>
      <button class="card action" data-claude="ds" data-subject="${esc(name)}">${icon('target')}Prépa DS</button>
      <button class="card action" data-claude="expliquer" data-subject="${esc(name)}">${icon('book')}Expliquer</button>
      <button class="card action" id="add-doc">${icon('file-plus')}Document</button>
    </div>
    ${jobs.length ? `<div class="list" style="margin-top:10px">${jobRows(jobs)}</div>` : ''}
    ${notionsSection(name)}
    ${todo.length ? `<div class="section-title">DS et devoirs</div><div class="list">${todo.map(reminderRow).join('')}</div>` : ''}
    ${fiches.length ? `<div class="section-title">Fiches</div><div class="list">${fiches.map((f) => `<a class="row" href="#fiche/${f.id}"><span class="lead">${icon('sparkles')}</span><div class="grow"><div class="t">${esc(f.name)}</div><div class="s">${dFmt(f.created, { day: 'numeric', month: 'short' })}${f.event_uid ? ' · cours du ' + dFmt(f.event_uid.split('|')[0], { day: 'numeric', month: 'short' }) : ''}</div></div>${icon('chevron-right', 'chev')}</a>`).join('')}</div>` : ''}
    ${next.length ? `<div class="section-title">Prochains cours</div>${next.map((e) => eventCard(e, true)).join('')}` : ''}
    ${Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true })).map(([g, fs]) => `<div class="section-title">${esc(g)}<span style="text-transform:none;letter-spacing:0;font-weight:500">${fs.length}</span></div><div class="list">${fileRows(fs.map((f) => ({ ...f, name: f.name.slice(f.name.lastIndexOf('/') + 1) })))}</div>`).join('')}
    ${past.length ? `<div class="section-title">Séances passées</div>${past.map((e) => eventCard(e, true)).join('')}` : ''}
    <div style="margin-top:28px"><button class="btn danger" id="hide-subject">${icon('eye-off')}Masquer cette matière</button></div>`;
}

const gb = (n) => (n < 1e9 ? Math.round(n / 1e6) + ' Mo' : (n / 1e9).toFixed(2).replace('.', ',') + ' Go');

function vReglages() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const perm = NATIVE ? nativePerm : 'Notification' in window ? Notification.permission : 'unsupported';
  const seen = S.agentSeen ? Math.round((Date.now() - Date.parse(S.agentSeen)) / 60000) : null;
  const hidden = S.subjects.filter((s) => s.hidden);
  return `<a class="back" href="#ecam">${icon('chevron-left')}ECAM</a><div class="head"><div><h1>Réglages</h1></div></div>
    ${!standalone && /iPhone|iPad/.test(navigator.userAgent) ? `<div class="card" style="padding:14px;margin-bottom:8px"><b>Installer l'app</b><p class="note" style="margin:6px 0 0">Dans Safari : bouton Partager, puis « Sur l'écran d'accueil ». Les notifications ne marchent qu'une fois l'app installée.</p></div>` : ''}
    <div class="section-title">Notifications</div>
    <div class="list">
      <div class="row"><span class="lead">${icon('bell')}</span><div class="grow"><div class="t">Rappels et fiches prêtes</div><div class="s">${perm === 'granted' ? (NATIVE ? 'Activées : DS et devoirs rappelés 3 jours avant, la veille et le jour même' : 'Activées sur cet appareil') : perm === 'denied' ? 'Refusées — à réactiver dans Réglages iOS › ECAM › Notifications' : perm === 'old' ? 'Mets à jour l’app avec le dernier ECAM.ipa (SideStore)' :perm === 'unsupported' ? 'Installe l\'app pour les activer' : 'Désactivées'}</div></div></div>
    </div>
    <div style="margin-top:10px">${perm === 'granted' ? `<button class="btn secondary" id="test-push">Envoyer une notification de test</button>` : `<button class="btn" id="enable-push" ${['unsupported', 'denied', 'old'].includes(perm) ? 'disabled' : ''}>Activer les notifications</button>`}</div>
    ${pendingSection()}
    <div class="section-title">Ordinateur</div>
    <div class="list"><div class="row"><span class="lead">${icon('monitor')}</span><div class="grow"><div class="t">Transcription et IA</div><div class="s">${seen === null ? 'Jamais connecté' : seen < 5 ? 'Connecté' : `Vu il y a ${seen < 120 ? seen + ' min' : Math.round(seen / 60) + ' h'}`}</div></div></div></div>
    <div class="section-title">Compte ECAM</div>
    <div class="list">${S.ecamUser
      ? `<button class="row" id="e-logout"><span class="lead">${icon('lock')}</span><div class="grow"><div class="t">${esc(S.ecamUser)}</div><div class="s">Connecté — toucher pour supprimer les identifiants</div></div></button>`
      : `<a class="row" href="#ecam"><span class="lead">${icon('lock')}</span><div class="grow"><div class="t">Non connecté</div><div class="s">Notes, PaperCut et bar dans l’onglet ECAM</div></div>${icon('chevron-right', 'chev')}</a>`}</div>
    ${S.storage ? `<div class="section-title">Stockage gratuit</div>
    <div class="list"><div class="row"><span class="lead">${icon('database')}</span><div class="grow"><div class="t">${gb(S.storage.used)} utilisés · ${gb(S.storage.limit - S.storage.used)} libres</div><div class="gauge"><i style="width:${Math.max(1, S.storage.used / S.storage.limit * 100).toFixed(1)}%"></i></div><div class="s wrap">Sur ${gb(S.storage.limit)}, bloqué avant la limite gratuite de Cloudflare (10 Go) : jamais facturé. Les enregistrements sont effacés du cloud 30 jours après leur fiche (ton PC les garde).</div></div></div></div>` : ''}
    <div class="section-title">Assistant Claude</div>
    <div class="list"><button class="row" id="mcp-copy2"><span class="lead">${icon('sparkles')}</span><div class="grow"><div class="t">Copier le lien du connecteur</div><div class="s">claude.ai → Paramètres → Connecteurs</div></div></button></div>
    <div class="section-title">Enregistrement des cours</div>
    <div class="list"><button class="row" id="rec-guide"><span class="lead">${icon('mic')}</span><div class="grow"><div class="t">Configurer les raccourcis</div><div class="s">${store.get('recReady') ? 'Configurés' : 'À faire une fois — 5 min'}</div></div>${icon('chevron-right', 'chev')}</button></div>
    ${hidden.length ? `<div class="section-title">Matières masquées</div><div class="list">${hidden.map((s) => `<button class="row plain" data-unhide="${esc(s.name)}"><div class="grow"><div class="t">${esc(s.name)}</div></div><span style="color:var(--accent)">Afficher</span></button>`).join('')}</div>` : ''}
    <div style="margin-top:28px"><button class="btn danger" id="logout">Se déconnecter</button></div>`;
}

// ---------- Tableau de bord ECAM ----------
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "à l’instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `le ${dFmt(iso, { day: 'numeric', month: 'short' })}`;
};
const gradeClass = (g) => { const v = parseFloat(g); return isNaN(v) ? '' : v >= 12 ? 'ok' : v < 10 ? 'warn' : ''; };

function vConnect(title, sub) {
  return `<div class="head"><div><h1>${title}</h1><div class="sub">${sub}</div></div></div>
    <div class="card" style="padding:16px">
      <p style="margin:0 0 6px;font-weight:600">Connecte ton compte ECAM</p>
      <p class="note" style="margin:0 0 14px">Tes notes et tes soldes s’affichent ici. Tu reçois une notification à chaque nouvelle note, même PC éteint.</p>
      <label class="field"><span>Identifiant ECAM</span><input id="e-user" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Mot de passe</span><input id="e-pass" type="password" autocomplete="current-password"></label>
      <button class="btn" id="e-save">${icon('lock')}Connecter</button>
      <p class="note">Chiffré et stocké uniquement sur ton serveur Cloudflare. Jamais réaffiché.</p>
    </div>`;
}

// ---------- Notes ----------
const num = (g) => parseFloat(String(g).replace(',', '.'));

// Moyenne pondérée par le barème (%) des notes chiffrées (AJ, ABS… ignorées)
const noteAvg = (ns) => {
  const ok = ns.filter((n) => !isNaN(num(n.grade)));
  const w = ok.reduce((s, n) => s + (parseFloat(n.weight) || 100), 0);
  return ok.length ? ok.reduce((s, n) => s + num(n.grade) * (parseFloat(n.weight) || 100), 0) / w : null;
};
// Moyenne générale indicative : moyenne des moyennes de matière (sans les coefficients ECTS, inconnus)
function generalAvg(notes) {
  const by = {};
  for (const n of notes) (by[n.subject] ||= []).push(n);
  const avgs = Object.values(by).map(noteAvg).filter((a) => a != null);
  return avgs.length ? avgs.reduce((s, a) => s + a, 0) / avgs.length : null;
}
// Évolution : la moyenne recalculée à chaque date où une note est tombée
function avgHistory(notes, avgOf = generalAvg) {
  const days = [...new Set(notes.filter((n) => !isNaN(num(n.grade))).map((n) => n.date))].sort();
  return days.map((d) => ({ date: d, v: avgOf(notes.filter((n) => n.date <= d)) })).filter((p) => p.v != null);
}
const noteId = (n) => encodeURIComponent(`${n.label}|${n.date}`);
const fmt2 = (x) => x.toFixed(2).replace('.', ',');
const signed = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±') + fmt2(Math.abs(x));

// Courbe d'évolution (une seule série) : trait 2 px, aire légère, grille discrète, curseur au doigt avec la valeur
function lineChart(points, label) {
  if (points.length < 2) return '';
  const W = Math.round(Math.min(Math.max(innerWidth - 60, 300), 620)), H = 160, L = 30, R = 10, T = 12, B = 22; // largeur ≈ celle de l'écran : texte jamais déformé
  const vs = points.map((p) => p.v);
  let lo = Math.floor(Math.min(...vs) - 0.5), hi = Math.ceil(Math.max(...vs) + 0.5);
  lo = Math.max(0, lo); hi = Math.min(20, Math.max(hi, lo + 2));
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date) || t0 + 1;
  const x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const ticks = [lo, (lo + hi) / 2, hi];
  const months = [...new Set(points.map((p) => p.date.slice(0, 7)))];
  const last = points[points.length - 1];
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  return `<div class="chart" data-points='${esc(JSON.stringify(points.map((p) => [p.date, +p.v.toFixed(2)])))}' data-geom="${[W, H, L, R, T, B, lo, hi, t0, t1].join(',')}" role="img" aria-label="${esc(label)} : de ${fmt2(points[0].v)} à ${fmt2(last.v)}">
    <svg viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')}</text>`).join('')}
      ${months.map((m) => { const d = m + '-01', xx = Math.max(L, x(d)); return Date.parse(d) >= t0 - 15 * 864e5 ? `<text class="ax" x="${xx}" y="${H - 6}" text-anchor="${xx <= L + 4 ? 'start' : 'middle'}">${dFmt(d, { month: 'short' }).replace('.', '')}</text>` : ''; }).join('')}
      <path d="${line}L${x(last.date)},${H - B}L${L},${H - B}Z" fill="url(#${gid})" stroke="none"/>
      <path class="ln" d="${line}"/>
      <circle class="pt" cx="${x(last.date)}" cy="${y(last.v)}" r="4.5"/>
      <g class="cursor" style="display:none"><line class="cx" y1="${T}" y2="${H - B}"/><circle class="pt" r="4.5"/></g>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}
function bindCharts(root) {
  root.querySelectorAll('.chart').forEach((c) => {
    const pts = JSON.parse(c.dataset.points), [W, H, L, R, T, B, lo, hi, t0, t1] = c.dataset.geom.split(',').map(Number);
    const svg = c.querySelector('svg'), cur = c.querySelector('.cursor'), tip = c.querySelector('.tip');
    const x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let lastI = -1;
    const show = (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      let i = 0;
      pts.forEach((p, k) => { if (Math.abs(x(p[0]) - px) < Math.abs(x(pts[i][0]) - px)) i = k; });
      const [d, v] = pts[i], cx = x(d), cy = y(v);
      cur.style.display = ''; tip.hidden = false;
      cur.querySelector('line').setAttribute('x1', cx); cur.querySelector('line').setAttribute('x2', cx);
      cur.querySelector('circle').setAttribute('cx', cx); cur.querySelector('circle').setAttribute('cy', cy);
      const prev = i ? v - pts[i - 1][1] : null;
      tip.innerHTML = `<b>${fmt2(v)}</b>${prev != null ? `<span class="${prev >= 0 ? 'up' : 'down'}">${signed(prev)}</span>` : ''}<small>${dFmt(d, { day: 'numeric', month: 'long' })}</small>`;
      tip.style.left = `${Math.min(Math.max((cx / W) * 100, 14), 86)}%`;
      if (i !== lastI) { lastI = i; haptic('selection'); }
    };
    const hide = () => { cur.style.display = 'none'; tip.hidden = true; lastI = -1; };
    c.onpointerdown = (ev) => { c.setPointerCapture(ev.pointerId); show(ev); };
    c.onpointermove = (ev) => { if (ev.pointerType === 'mouse' || c.hasPointerCapture(ev.pointerId)) show(ev); };
    c.onpointerup = c.onpointercancel = c.onpointerleave = hide;
  });
}

function vNotes() {
  if (!S.ecamUser) return vConnect('Notes', 'Tes notes ECAM');
  const e = S.ecam || {};
  const r = e.report; // bulletin par module (UE), calculé par le serveur comme pour la page « famille »
  const general = r ? r.general : generalAvg(e.notes || []);
  const hist = r ? r.history.map(([date, v]) => ({ date, v })) : avgHistory(e.notes || []);
  const delta = hist.length > 1 ? hist[hist.length - 1].v - hist[hist.length - 2].v : null;
  const noteRow = (n) => `<a class="row" href="#note/${noteId(n)}"><span class="grade ${gradeClass(n.grade)}">${esc(n.grade.replace('/20', ''))}</span><div class="grow"><div class="t">${esc(n.exam || n.label)}</div><div class="s wrap">${n.average ? 'moy. classe ' + esc(n.average.replace('/20', '')) + ' · ' : ''}${dFmt(n.date, { day: 'numeric', month: 'short' })}</div></div>${icon('chevron-right', 'chev')}</a>`;
  const pill = (a) => `<span class="grade ${gradeClass(a)}" style="min-width:0;padding:2px 8px;text-transform:none">${fmt2(a)}</span>`;
  const mods = r ? r.modules.filter((u) => u.ecs.some((x) => x.notes.length)) : [];
  const body = r
    ? mods.map((u) => `<div class="module">
        <div class="mod-head"><div><div class="mod-name">${esc(u.ue)}</div><div class="s">${u.ects} ECTS · ${u.ecs.filter((x) => x.notes.length).length}/${u.ecs.length} matière${u.ecs.length > 1 ? 's' : ''} notée${u.ecs.length > 1 ? 's' : ''}</div></div>
          ${u.avg != null ? `<div class="mod-avg"><b class="${gradeClass(u.avg)}">${fmt2(u.avg)}</b><span class="${u.avg >= 10 ? 'ok' : 'warn'}">${u.ecs.every((x) => x.avg != null) ? (u.avg >= 10 ? 'Validé' : 'Non validé') : u.avg >= 10 ? 'En bonne voie' : 'Sous 10'}</span></div>` : ''}</div>
        ${u.ecs.filter((x) => x.notes.length).map((x) => `<div class="section-title"><span>${esc(x.ec)}</span>${x.avg != null ? pill(x.avg) : ''}</div><div class="list">${x.notes.map(noteRow).join('')}</div>`).join('')}
      </div>`).join('') + (r.other.length ? `<div class="section-title">Autres</div><div class="list">${r.other.map(noteRow).join('')}</div>` : '')
    : Object.entries((e.notes || []).reduce((m, n) => ((m[n.subject] ||= []).push(n), m), {})).map(([s, ns]) => `<div class="section-title"><span>${esc(s)}</span>${noteAvg(ns) != null ? pill(noteAvg(ns)) : ''}</div><div class="list">${ns.map(noteRow).join('')}</div>`).join('');
  return `<div class="head"><div><h1>Notes</h1><div class="sub">${e.at ? 'Mis à jour ' + ago(e.at) : 'Première synchronisation…'}</div></div>
      <div style="display:flex;gap:8px"><button class="icon-btn" id="share-notes" aria-label="Partager mes notes">${icon('share')}</button><button class="icon-btn" id="e-sync" aria-label="Actualiser">${icon('refresh')}</button></div></div>
    ${e.error ? `<div class="banner">${esc(e.error)}</div>` : ''}
    ${general != null ? `<div class="card avg-card">
        <div class="avg-top"><div><span class="k">${icon('award')}Moyenne générale</span><div class="v">${fmt2(general)}<small> /20</small></div></div>
        ${delta != null ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${signed(delta)}<small>depuis la dernière note</small></span>` : ''}</div>
        ${lineChart(hist, 'Évolution de la moyenne générale')}
        <div class="s">${r ? `Modules pondérés par leurs crédits (${r.ects} ECTS évalués sur 30) ; un module se valide avec 10.` : 'Moyenne des matières.'} Touche la courbe pour voir chaque date.</div>
      </div>` : ''}
    ${body || `<div class="empty">${icon('award')}<div>Aucune note pour l’instant.</div></div>`}`;
}

// Lien public, en lecture seule, pour montrer ses notes (famille) : sans compte, révocable
async function shareNotesSheet(renew) {
  let url;
  try { url = (await api('/share/notes', { method: 'POST', json: { renew: !!renew } })).url; } catch (e) { return toast(e.message); }
  openSheet(`<h2>${icon('share')} Partager mes notes</h2>
    <p class="note" style="margin-top:-8px">Toute personne qui a ce lien voit tes notes et tes moyennes, à jour automatiquement — et rien d’autre de l’app. Aucun compte nécessaire.</p>
    <div class="card" style="padding:12px 14px;word-break:break-all;font-size:14px;margin-bottom:12px">${esc(url)}</div>
    ${navigator.share ? '<button class="btn" id="sn-share">Envoyer…</button>' : ''}
    <button class="btn ${navigator.share ? 'secondary' : ''}" id="sn-copy" style="margin-top:8px">Copier le lien</button>
    <a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener" style="margin-top:8px;display:block;text-align:center">Voir la page</a>
    <button class="btn danger" id="sn-renew" style="margin-top:8px">Créer un nouveau lien (l’ancien ne marchera plus)</button>`, (sh) => {
    $('#sn-share', sh)?.addEventListener('click', () => navigator.share({ title: 'Mes notes ECAM', url }).catch(() => {}));
    $('#sn-copy', sh).onclick = async () => { await navigator.clipboard.writeText(url); toast('Lien copié'); };
    $('#sn-renew', sh).onclick = () => { if (confirm('Créer un nouveau lien ? Les personnes qui ont l’ancien ne pourront plus voir tes notes.')) shareNotesSheet(true); };
  });
}

// Détail d'une note, en plein écran
function vNote(id) {
  const notes = S.ecam?.notes || [];
  const n = notes.find((x) => noteId(x) === encodeURIComponent(id));
  const back = `<a class="back" href="#notes">${icon('chevron-left')}Notes</a>`;
  if (!n) return `${back}<div class="empty">${icon('award')}<div>Note introuvable (elle a peut-être changé sur l’intranet).</div></div>`;
  const g = num(n.grade), cls = num(n.average), max = parseFloat(String(n.grade).split('/')[1]) || 20;
  const same = notes.filter((x) => x.subject === n.subject);
  const others = notes.filter((x) => x !== n);
  const subjWith = noteAvg(same), subjWithout = noteAvg(same.filter((x) => x !== n));
  const ef = S.ecam?.report?.effects?.[`${n.label}|${n.date}`];
  const ue = S.ecam?.report?.modules.find((u) => u.ecs.some((x) => x.notes.some((y) => y.label === n.label && y.date === n.date)));
  const [genWithout, genWith] = ef ? ef.general : [generalAvg(others), generalAvg(notes)];
  const bar = (v, label, c) => `<div class="cmp"><span>${label}</span><div class="track-bar"><i class="${c}" style="width:${Math.max(2, (v / max) * 100)}%"></i></div><b>${fmt2(v)}</b></div>`;
  const effect = (a, b, label) => (a != null && b != null ? `<div class="row"><div class="grow"><div class="t">${label}</div><div class="s">${fmt2(b)} → ${fmt2(a)}</div></div><span class="delta ${a - b >= 0 ? 'up' : 'down'}">${signed(a - b)}</span></div>` : '');
  const subjHist = avgHistory(same, noteAvg);
  return `${back}
    <div class="note-hero">
      <div class="note-big ${gradeClass(n.grade)}">${isNaN(g) ? esc(n.grade) : fmt2(g)}<small>/${max}</small></div>
      <h1>${esc(n.exam || n.label)}</h1>
      <div class="sub">${esc(n.subject)}${ue ? ` · module ${esc(ue.ue)}` : ''}</div>
    </div>
    ${!isNaN(g) && !isNaN(cls) ? `<div class="card note-cmp">
      ${bar(g, 'Toi', 'me')}${bar(cls, 'Classe', 'cls')}
      <div class="s">${g >= cls ? `${fmt2(g - cls)} point${g - cls >= 2 ? 's' : ''} au-dessus de la moyenne de la classe` : `${fmt2(cls - g)} point${cls - g >= 2 ? 's' : ''} sous la moyenne de la classe`}</div>
    </div>` : ''}
    <div class="section-title">Détails</div>
    <div class="list">
      <div class="row"><span class="lead">${icon('calendar')}</span><div class="grow"><div class="t">Date</div><div class="s">${longDay(n.date)}</div></div></div>
      ${n.weight ? `<div class="row"><span class="lead">${icon('scale')}</span><div class="grow"><div class="t">Barème dans la matière</div><div class="s">${esc(n.weight)}</div></div></div>` : ''}
      ${n.average ? `<div class="row"><span class="lead">${icon('users')}</span><div class="grow"><div class="t">Moyenne de la classe</div><div class="s">${esc(n.average)}</div></div></div>` : ''}
      ${n.teacher ? `<div class="row"><span class="lead">${icon('user')}</span><div class="grow"><div class="t">Professeur</div><div class="s">${esc(n.teacher)}</div></div></div>` : ''}
      <div class="row"><span class="lead">${icon('text')}</span><div class="grow"><div class="t">Intitulé complet</div><div class="s wrap">${esc(n.label)}</div></div></div>
    </div>
    ${!isNaN(g) ? `<div class="section-title">Effet de cette note</div><div class="list">${effect(subjWith, subjWithout, 'Moyenne de la matière')}${ef && ue ? effect(ef.ue[1], ef.ue[0], `Module ${ue.ue} (${ue.ects} ECTS)`) : ''}${effect(genWith, genWithout, 'Moyenne générale')}${subjWithout == null ? '<div class="row"><div class="grow"><div class="s">Première note de la matière.</div></div></div>' : ''}</div>` : ''}
    ${subjHist.length > 1 ? `<div class="section-title">Évolution en ${esc(n.subject)}</div><div class="card avg-card">${lineChart(subjHist, 'Évolution de la moyenne de la matière')}</div>` : ''}
    ${same.length > 1 ? `<div class="section-title">Autres notes de la matière</div><div class="list">${same.filter((x) => x !== n).map((x) => `<a class="row" href="#note/${noteId(x)}"><span class="grade ${gradeClass(x.grade)}">${esc(x.grade.replace('/20', ''))}</span><div class="grow"><div class="t">${esc(x.exam || x.label)}</div><div class="s">${dFmt(x.date, { day: 'numeric', month: 'short' })}</div></div>${icon('chevron-right', 'chev')}</a>`).join('')}</div>` : ''}`;
}

// ---------- ECAM (soldes, liens, réglages) ----------
function vEcam() {
  if (!S.ecamUser) return vConnect('ECAM', 'Intranet, impression, bar') + `<div style="margin-top:20px"><a class="btn secondary" href="#reglages">${icon('settings')}Réglages de l’app</a></div>`;
  const e = S.ecam || {};
  const bar = e.bar || {};
  return `<div class="head"><div><h1>ECAM</h1><div class="sub">${e.at ? 'Mis à jour ' + ago(e.at) : ''}</div></div>
      <a class="icon-btn" href="#reglages" aria-label="Réglages">${icon('settings')}</a></div>
    <div class="tiles">
      <a class="card tile" href="https://espace.ecam.fr/group/tools/accueil" target="_blank" rel="noopener"><span class="k">${icon('printer')}Impression</span><span class="v">${e.papercut != null ? esc(e.papercut) + ' €' : '—'}</span><span class="s">Solde PaperCut</span></a>
      <a class="card tile" href="https://bar.ecam.fr/" target="_blank" rel="noopener"><span class="k">${icon('cup')}Bar</span><span class="v">${bar.balance != null ? esc(bar.balance) + ' €' : '—'}</span><span class="s">${bar.favorite ? 'Préférée : ' + esc(bar.favorite) : 'Solde du bar'}</span></a>
    </div>
    <div class="section-title">Accès rapides</div>
    <div class="list">
      ${[['mail', 'Messagerie', 'https://espace.ecam.fr/group/tools/mail'], ['book', 'Moodle', 'https://moodle.ecam.fr/'], ['grid', 'Espace intranet', 'https://espace.ecam.fr/'], ['user', 'Trombinoscope', 'https://espace.ecam.fr/group/tools/trombinoscope']]
        .map(([ic, t, u]) => `<a class="row" href="${u}" target="_blank" rel="noopener"><span class="lead">${icon(ic)}</span><div class="grow"><div class="t">${t}</div></div>${icon('external', 'chev')}</a>`).join('')}
    </div>
    ${bar.history?.length ? `<div class="section-title"><span>Bar — dernières opérations</span><span style="text-transform:none;letter-spacing:0">Solde ${money(bar.balance)}</span></div><div class="list">${barRows(bar)}</div>` : ''}`;
}

// Bar : le site affiche les achats en positif et les recharges en négatif → on inverse (recharge +10 €, boisson −1 €)
const money = (v) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(2).replace('.', ',') + ' €');
function barRows(bar) {
  let after = parseFloat(bar.balance); // solde après chaque opération, en remontant depuis le solde actuel
  return bar.history.slice(0, 8).map((h) => {
    const amount = -parseFloat(String(h.price).replace(',', '.'));
    const row = `<div class="row plain"><div class="grow"><div class="t">${esc(h.item)}</div><div class="s">${dFmt(h.date.replace(' ', 'T'), { weekday: 'short', day: 'numeric', month: 'short' })} · ${esc(h.date.slice(11, 16))} · solde ${money(after)}</div></div><span style="font-weight:650;font-variant-numeric:tabular-nums;color:${amount > 0 ? 'var(--ok)' : 'var(--text)'}">${amount > 0 ? '+' : '−'}${money(Math.abs(amount))}</span></div>`;
    after -= amount;
    return row;
  }).join('');
}

// ---------- Assistant : Claude (abonnement Pro) relié aux cours via le connecteur ----------
async function linkFor(purpose) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(purpose + ':' + KEY));
  return location.origin + `/${purpose === 'mcp' ? 'mcp' : 'up'}/` + [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Actions de l'assistant : chacune a ses réglages ; une feuille de confirmation montre le message avant d'ouvrir Claude
const seg = (id, label, choices, def) => ({ id, label, type: 'seg', choices, def });
const toggle = (id, label, def = true) => ({ id, label, type: 'toggle', def });
const text = (id, label, ph) => ({ id, label, type: 'text', ph, def: '' });
const FOCUS = text('focus', 'Centré sur (facultatif)', 'Ex. chapitre 3, les logarithmes, le cours du 5 oct.');
const focusOf = (o) => (o.focus ? `, en te concentrant sur : ${o.focus}` : '');
const READ = 'Récupère mes cours en UN SEUL appel : dossier_revision (fiches de mes cours + résumés de mes documents ; ajoute seance=AAAA-MM-JJ si la demande porte sur un cours précis). N’ouvre un document en entier (lire_document avec complet=true) que s’il manque un point précis, 2 documents au maximum. Les lignes « [Schéma] » décrivent les schémas de mes supports : reprends les importants dans ta réponse, reconstruits en texte (tableau, liste ou schéma en bloc de code).';

const ASK = {
  fiche: {
    icon: 'sparkles', label: 'Fiche de révision',
    opts: [seg('detail', 'Niveau de détail', ['Synthétique', 'Complète', 'Très détaillée'], 'Complète'), FOCUS, toggle('ex', 'Avec des exemples concrets'), toggle('q', 'Avec les questions d’examen probables')],
    build: (s, o) => `Fais-moi une fiche de révision ${{ 'Synthétique': 'synthétique (2 pages maximum, l’essentiel seulement — priorité à la concision sur mes consignes de longueur)', 'Complète': 'complète', 'Très détaillée': 'très détaillée et exhaustive' }[o.detail]} de « ${s} »${focusOf(o)}. Étapes : 1) lis mes consignes avec consignes_fiche ; 2) ${READ} ; 3) rédige la fiche${o.ex ? ', avec des exemples concrets' : ''}${o.q ? ', et termine par les questions d’examen probables' : ''} ; 4) enregistre-la avec enregistrer_fiche (titre « Fiche de révision — ${s} »).`,
  },
  memo: {
    icon: 'text', label: 'Feuille mémo',
    opts: [seg('len', 'Longueur', ['½ page', '1 page', '2 pages'], '1 page'), seg('fmt', 'Présentation', ['Liste', 'Tableaux', 'Mixte'], 'Mixte'), FOCUS],
    build: (s, o) => `Fais-moi une feuille mémo de ${o.len} maximum pour « ${s} »${focusOf(o)} : uniquement l’essentiel à savoir par cœur (définitions, formules, chiffres, listes, pièges), très compacte, présentée ${{ Liste: 'en listes à puces', Tableaux: 'en tableaux', Mixte: 'en listes et tableaux' }[o.fmt]}. ${READ} Enregistre-la avec enregistrer_fiche (titre « Mémo — ${s} »).`,
  },
  ds: {
    icon: 'target', label: 'Prépa DS',
    opts: [toggle('blanc', 'Avec un DS blanc'), seg('nb', 'Exercices dans le DS blanc', ['3', '5', '8'], '5'), toggle('corr', 'Avec le corrigé détaillé'), FOCUS],
    build: (s, o) => `Prépare-moi au prochain DS de « ${s} »${focusOf(o)}. Regarde devoirs et emploi_du_temps pour la date. ${READ} Inclus aussi les DS blancs, annales et TD. Regarde la liste des notions avec programme : traite CHAQUE notion au programme du DS dans sa propre section, sans en sauter aucune. Donne : ce qui va le plus probablement tomber (justifié), les méthodes, les formules à connaître et les pièges${o.blanc ? `, puis un DS blanc de ${o.nb} exercices dans le style des annales${o.corr ? ', avec son corrigé détaillé' : ' (sans corrigé : je te donnerai mes réponses)'}` : ''}. Enregistre le tout avec enregistrer_fiche (titre « Prépa DS — ${s} »).`,
  },
  quiz: {
    icon: 'check', label: 'Quiz',
    opts: [seg('n', 'Nombre de questions', ['5', '10', '15', '20'], '10'), seg('diff', 'Difficulté', ['Facile', 'Moyen', 'Difficile', 'Progressive'], 'Progressive'), seg('fmt', 'Type de questions', ['QCM', 'Ouvertes', 'Mixte'], 'Mixte'), seg('mode', 'Déroulement', ['Une par une', 'Toutes d’un coup'], 'Une par une'), FOCUS],
    build: (s, o) => `Interroge-moi sur « ${s} »${focusOf(o)} à partir de mes cours. ${READ} Fais ${o.n} questions ${{ QCM: 'à choix multiples (4 propositions)', Ouvertes: 'ouvertes', Mixte: 'mêlant QCM et questions ouvertes' }[o.fmt]}, de difficulté ${{ Facile: 'facile', Moyen: 'moyenne', Difficile: 'élevée (niveau DS exigeant)', Progressive: 'progressive (de facile à difficile)' }[o.diff]}. ${o.mode === 'Une par une' ? 'Pose-les UNE par UNE : attends ma réponse, corrige-moi en expliquant, puis passe à la suivante.' : 'Donne toutes les questions d’un coup, puis corrige mes réponses quand je te les envoie.'} Donne mon score à la fin et ce que je dois revoir.`,
  },
  expliquer: {
    icon: 'book', label: 'Expliquer',
    opts: [{ id: 'cours', label: 'Quoi', type: 'session', def: '' }, seg('niv', 'Niveau', ['Simple', 'Détaillé'], 'Simple'), toggle('verif', 'Me poser 3 questions de vérification à la fin')],
    build: (s, o) => `Explique-moi ${o.cours ? `le cours de « ${s} » du ${dFmt(o.cours, { weekday: 'long', day: 'numeric', month: 'long' })} (séance ${o.cours.slice(0, 10)})` : `la matière « ${s} » dans son ensemble`}. ${READ} Explique ${o.niv === 'Simple' ? 'simplement, comme à quelqu’un qui découvre, avec des analogies' : 'en détail, avec la rigueur attendue en DS'} et des exemples concrets.${o.verif ? ' Termine par 3 questions pour vérifier que j’ai compris, et corrige mes réponses.' : ''}${o.cours ? ` Propose-moi ensuite d’en faire une fiche (enregistrer_fiche, seance ${o.cours.slice(0, 10)}).` : ''}`,
  },
  plan: {
    icon: 'calendar', label: 'Plan de révision',
    opts: [{ id: 'until', label: 'Jusqu’au', type: 'date', def: '' }, seg('daily', 'Temps par jour', ['30 min', '1 h', '2 h'], '1 h'), toggle('we', 'Réviser aussi le week-end', false), toggle('add', 'Ajouter les étapes clés à mes devoirs')],
    build: (s, o) => `Fais-moi un planning de révision pour « ${s} »${o.until ? ` jusqu’au ${dFmt(o.until, { weekday: 'long', day: 'numeric', month: 'long' })}` : ' jusqu’au prochain DS (regarde emploi_du_temps et devoirs)'}, avec ${o.daily} par jour${o.we ? ', week-ends compris' : ', sans les week-ends'}, en tenant compte de mes autres cours (emploi_du_temps). ${READ} Découpe par notions, du plus important au moins important.${o.add ? ' Propose-le moi, et si je suis d’accord, ajoute les étapes clés avec ajouter_devoir.' : ''}`,
  },
};

// Prochain DS de la matière : date par défaut du planning
const nextDS = (s) => upcoming(365).find((r) => r.subject === s && r.kind === 'ds')?.due.slice(0, 10) || '';

function askSheet(action, subject, preset = {}) {
  const a = ASK[action];
  const saved = JSON.parse(store.get('askOpts:' + action) || '{}');
  const o = Object.fromEntries(a.opts.map((x) => [x.id, preset[x.id] ?? saved[x.id] ?? x.def]));
  if (action === 'plan' && !preset.until) o.until = nextDS(subject);
  if (action === 'expliquer' && preset.cours === undefined) o.cours = S.events.filter((e) => e.subject === subject && e.start <= nowStr()).pop()?.start || '';
  let edited = false;

  const control = (x) => {
    if (x.type === 'seg') return `<div class="seg" data-opt="${x.id}">${x.choices.map((c) => `<button type="button" data-v="${esc(c)}" class="${o[x.id] === c ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>`;
    if (x.type === 'toggle') return `<label class="switch"><span>${x.label}</span><input type="checkbox" data-opt="${x.id}" ${o[x.id] ? 'checked' : ''}><i></i></label>`;
    if (x.type === 'text') return `<input data-opt="${x.id}" value="${esc(o[x.id])}" placeholder="${esc(x.ph)}">`;
    if (x.type === 'date') return `<input type="date" data-opt="${x.id}" value="${esc(o[x.id])}">`;
    if (x.type === 'session') {
      const ss = S.events.filter((e) => e.subject === subject && e.start <= nowStr()).reverse();
      return `<select data-opt="${x.id}"><option value="">Toute la matière</option>${ss.map((e) => `<option value="${e.start}" ${e.start === o.cours ? 'selected' : ''}>Cours du ${dFmt(e.start, { weekday: 'short', day: 'numeric', month: 'short' })} · ${esc(e.type || '')}</option>`).join('')}</select>`;
    }
  };
  openSheet(`<h2 style="margin-bottom:4px">${icon(a.icon)} ${a.label}</h2><p class="note" style="margin:0 0 14px">${esc(subject)}</p>
    ${a.opts.map((x) => x.type === 'toggle' ? control(x) : `<label class="field"><span>${x.label}</span>${control(x)}</label>`).join('')}
    <label class="field" style="margin-top:6px"><span style="display:flex;justify-content:space-between">Message envoyé à Claude <button type="button" id="k-reset" class="link" hidden>Régénérer</button></span><textarea id="k-text" rows="6"></textarea></label>
    <button class="btn" id="k-go">${icon('sparkles')}Ouvrir dans Claude</button>
    <p class="note">Claude s’ouvre avec ce message prêt à envoyer. Tes réglages sont gardés pour la prochaine fois.</p>`, (sh) => {
    const box = $('#k-text', sh);
    const regen = () => { box.value = a.build(subject, o); edited = false; $('#k-reset', sh).hidden = true; };
    const changed = () => { store.set('askOpts:' + action, JSON.stringify(o)); if (!edited) regen(); };
    sh.querySelectorAll('.seg[data-opt]').forEach((g) => g.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      o[g.dataset.opt] = b.dataset.v;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      changed();
    })));
    sh.querySelectorAll('input[data-opt], select[data-opt]').forEach((el) => (el.oninput = el.onchange = () => { o[el.dataset.opt] = el.type === 'checkbox' ? el.checked : el.value; changed(); }));
    box.oninput = () => { edited = true; $('#k-reset', sh).hidden = false; };
    $('#k-reset', sh).onclick = regen;
    $('#k-go', sh).onclick = () => { if (!box.value.trim()) return toast('Le message est vide'); askClaude(box.value.trim()); closeSheet(); };
    regen();
  });
}

function askFree(subject, question) {
  openSheet(`<h2 style="margin-bottom:4px">${icon('sparkles')} Question</h2><p class="note" style="margin:0 0 14px">${esc(subject)}</p>
    <label class="switch"><span>M’appuyer sur tes cours</span><input type="checkbox" id="k-cours" checked><i></i></label>
    <label class="field" style="margin-top:6px"><span>Message envoyé à Claude</span><textarea id="k-text" rows="6"></textarea></label>
    <button class="btn" id="k-go">${icon('sparkles')}Ouvrir dans Claude</button>`, (sh) => {
    const box = $('#k-text', sh), useCourses = $('#k-cours', sh);
    const regen = () => (box.value = useCourses.checked ? `Matière : « ${subject} ». Appuie-toi sur mes cours (dossier_revision en un seul appel) pour répondre. Question : ${question}` : question);
    useCourses.onchange = regen;
    $('#k-go', sh).onclick = () => { askClaude(box.value.trim()); closeSheet(); };
    regen();
  });
}



function askClaude(text) {
  window.open('https://claude.ai/new?q=' + encodeURIComponent('[Connecteur ECAM] ' + text), '_blank'); // le connecteur ECAM doit être activé
}

function currentSubject() {
  const saved = store.get('askSubject');
  if (saved && subjects().includes(saved)) return saved;
  const now = nowStr();
  return (S.events.find((e) => e.start >= now.slice(0, 10)) || S.events[S.events.length - 1])?.subject || subjects()[0];
}

const docCount = (s) => S.files.filter((f) => f.subject === s && f.kind !== 'audio').length;

function vAssistant() {
  const subs = subjects();
  const cur = currentSubject();
  const fiches = S.files.filter((f) => f.kind === 'fiche').slice(0, 12);
  return `<div class="head"><div><h1>Assistant</h1><div class="sub">Claude, relié à tous tes cours</div></div></div>
    ${store.get('mcpReady') ? '' : `<div class="card" style="padding:16px;margin-bottom:14px">
      <p style="margin:0 0 6px;font-weight:600">À faire une fois : relier Claude à tes cours</p>
      <div class="list" style="box-shadow:none;background:none">
        <div class="row plain" style="align-items:flex-start;padding-left:0"><b style="color:var(--accent);width:22px">1</b><div class="grow" style="white-space:normal">Copie ton lien de connecteur.<div style="margin-top:8px"><button class="btn secondary" id="mcp-copy">Copier le lien</button></div></div></div>
        <div class="row plain" style="align-items:flex-start;padding-left:0"><b style="color:var(--accent);width:22px">2</b><div class="grow" style="white-space:normal">Ouvre <b>claude.ai</b> dans Safari → <b>Paramètres</b> → <b>Connecteurs</b> → <b>Ajouter un connecteur personnalisé</b>.<br>Nom : <b>ECAM</b> · URL : colle le lien → <b>Ajouter</b>.</div></div>
        <div class="row plain" style="align-items:flex-start;padding-left:0"><b style="color:var(--accent);width:22px">3</b><div class="grow" style="white-space:normal">C’est tout : ça marche aussi dans l’app Claude. Claude pourra lire tes cours et enregistrer ses fiches ici.</div></div>
      </div>
      <button class="btn" id="mcp-done" style="margin-top:6px">C’est fait</button>
    </div>`}
    <label class="field"><span>Matière</span><select id="ask-subject">${subs.map((s) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <div class="actions" style="margin-top:4px">${Object.entries(ASK).map(([k, x], i) => `<button class="card action ${i === 0 ? 'primary' : ''}" data-claude="${k}">${icon(x.icon)}${x.label}</button>`).join('')}</div>
    <label class="field" style="margin-top:14px"><span>Ou pose ta question</span><textarea id="ask-text" rows="3" placeholder="Ex. Explique-moi la différence entre un switch et un routeur"></textarea></label>
    <button class="btn" id="ask-go">${icon('sparkles')}Demander à Claude</button>
    <p class="note">Claude s’ouvre avec ta demande. Les fiches qu’il crée arrivent ici, sur ton PC, et tu es notifié.</p>
    ${fiches.length ? `<div class="section-title">Mes fiches</div><div class="list">${fiches.map((f) => `<a class="row" href="#fiche/${f.id}"><span class="lead">${icon('sparkles')}</span><div class="grow"><div class="t">${esc(f.name)}</div><div class="s">${esc(f.subject)} · ${dFmt(f.created, { day: 'numeric', month: 'short' })}</div></div>${icon('chevron-right', 'chev')}</a>`).join('')}</div>` : ''}
    <div class="list" style="margin-top:22px"><a class="row" href="#devoirs/matieres"><span class="lead">${icon('grid')}</span><div class="grow"><div class="t">Toutes mes matières</div><div class="s">Documents, fiches, cours et DS de chaque matière</div></div>${icon('chevron-right', 'chev')}</a></div>
`;
}

// Refaire une fiche : même type de demande, la nouvelle version remplace l'ancienne
async function regenFiche(f) {
  if (/^Fiche du cours/.test(f.name) && f.event_uid) {
    try { await api('/courses/fiche', { method: 'POST', json: { uid: f.event_uid } }); toast('Ton PC refait la fiche du cours — tu seras notifié', 4000); refresh(); } catch (e) { toast(e.message); }
    return;
  }
  const action = /^Prépa DS/i.test(f.name) ? 'ds' : /^Mémo/i.test(f.name) ? 'memo' : 'fiche';
  const ds = action === 'ds' && S.tasks.find((t) => t.event_uid === f.event_uid && t.kind === 'ds');
  askSheet(action, f.subject, ds && parseScope(ds) ? { focus: 'UNIQUEMENT ' + scopeText(parseScope(ds)) + ' (le reste n’est pas au programme du DS)' } : {});
}

async function vFiche(id) {
  const f = S.files.find((x) => x.id === id);
  view.innerHTML = `<a class="back" href="javascript:history.back()">${icon('chevron-left')}Retour</a>
    <div class="head"><div><h1 style="font-size:24px">${esc(f?.name || 'Fiche')}</h1><div class="sub">${esc(f?.subject || '')}</div></div><div style="display:flex;gap:8px"><button class="icon-btn" id="regen" aria-label="Refaire cette fiche">${icon('refresh')}</button><button class="icon-btn" id="move" aria-label="Déplacer vers un autre cours">${icon('calendar')}</button><button class="icon-btn" id="print" aria-label="PDF / Imprimer">${icon('printer')}</button><button class="icon-btn" id="share" aria-label="Partager">${icon('share')}</button></div></div>
    <div class="doc" id="doc"><div class="skeleton"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>`;
  const cached = store.get('fiche:' + id);
  let text = cached;
  if (!text) {
    try { text = await (await api('/files/' + id)).text(); store.set('fiche:' + id, text); }
    catch (e) { $('#doc').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  }
  if (!location.hash.endsWith(id)) return;
  $('#doc').innerHTML = f?.kind === 'transcript' ? `<p style="white-space:pre-wrap">${esc(text)}</p>` : window.marked ? marked.parse(text) : `<pre>${esc(text)}</pre>`;
  $('#move').onclick = () => f && moveSheet(f);
  $('#regen').onclick = () => f && regenFiche(f);
  $('#print').onclick = () => window.print(); // iOS : Imprimer → partager → enregistrer en PDF
  $('#share').onclick = async () => {
    const file = new File([text], (f?.name || 'fiche') + '.md', { type: 'text/markdown' });
    if (navigator.canShare?.({ files: [file] })) navigator.share({ files: [file] }).catch(() => {});
    else download(file);
  };
}

// ---------- Actions ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name || blob.name; a.target = '_blank';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function openFile(id) {
  const f = S.files.find((x) => x.id === id);
  if (f.kind === 'fiche' || f.kind === 'transcript') return (location.hash = '#fiche/' + id);
  openSheet(`<h2>${esc(f.name)}</h2><p class="note">${size(f.size)} · ${esc(f.subject)}</p>
    <button class="btn" id="open">Ouvrir</button><button class="btn secondary" id="move">Déplacer vers un autre cours</button><button class="btn danger" id="del">${icon('trash')}Supprimer</button>`, (sh) => {
    $('#move', sh).onclick = () => moveSheet(f);
    $('#open', sh).onclick = async () => {
      toast('Ouverture…', 0);
      try { const blob = await (await api('/files/' + id)).blob(); download(new File([blob], f.name, { type: f.mime })); toast('Prêt'); }
      catch (e) { toast(e.message); }
      closeSheet();
    };
    $('#del', sh).onclick = async () => {
      if (!confirm(`Supprimer « ${f.name} » ?`)) return;
      await api('/files/' + id, { method: 'DELETE' }); closeSheet(); toast('Supprimé'); refresh();
    };
  });
}

// Change la matière / le cours d'un fichier (un enregistrement emmène sa transcription et sa fiche)
function moveSheet(f) {
  const sessions = (s) => S.events.filter((e) => e.subject === s && e.start <= nowStr().slice(0, 10) + 'T23:59').reverse();
  const options = (s) => `<option value="">Aucun cours précis (matière seulement)</option>` + sessions(s).map((e) => `<option value="${esc(e.uid)}" ${e.uid === f.event_uid ? 'selected' : ''}>${dFmt(e.start, { weekday: 'short', day: 'numeric', month: 'short' })} · ${e.start.slice(11, 16)} · ${esc(e.type || '')}</option>`).join('');
  openSheet(`<h2>Déplacer</h2><p class="note">${esc(f.name.split('/').pop())}</p>
    <label class="field"><span>Matière</span><select id="m-subject">${subjects().map((s) => `<option ${s === f.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label class="field"><span>Cours</span><select id="m-session">${options(f.subject)}</select></label>
    <button class="btn" id="m-save">Déplacer</button>
    ${f.kind === 'audio' ? '<p class="note">La transcription et la fiche de cet enregistrement suivent.</p>' : ''}`, (sh) => {
    $('#m-subject', sh).onchange = (ev) => ($('#m-session', sh).innerHTML = options(ev.target.value));
    $('#m-save', sh).onclick = async () => {
      try { await api('/files/' + f.id, { method: 'PATCH', json: { subject: $('#m-subject', sh).value, event_uid: $('#m-session', sh).value || null } }); }
      catch (e) { return toast(e.message); }
      closeSheet(); toast('Déplacé'); refresh();
    };
  });
}

// ---------- Documents partagés à l'app iPhone (« Partager › ECAM ») ----------
const plainWords = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const shiftMin = (t, m) => new Date(Date.parse(t + ':00Z') + m * 6e4).toISOString().slice(0, 16);
// Proposition de rangement : la matière citée dans le titre, et le cours en cours / qui vient de finir (sinon le dernier)
function guessCourse(fileName) {
  const now = nowStr(), name = plainWords(fileName);
  const score = (s) => plainWords(s).filter((w) => w.length >= 4 && name.some((n) => w.startsWith(n) || n.startsWith(w))).length;
  const best = subjects().map((s) => [score(s), s]).sort((a, b) => b[0] - a[0])[0];
  const live = S.events.find((e) => e.start <= shiftMin(now, 15) && shiftMin(e.end || e.start, 45) >= now); // ±, pour une photo prise en fin de cours
  const subject = best?.[0] > 0 ? best[1] : live?.subject || subjects()[0];
  const past = S.events.filter((e) => e.subject === subject && e.start <= shiftMin(now, 15)).sort((a, b) => b.start.localeCompare(a.start));
  const ev = live?.subject === subject ? live : past[0];
  return { subject, uid: ev?.uid || '', why: best?.[0] > 0 ? 'd’après le titre' : live ? 'cours en cours' : '' };
}
let shareBusy = false, sharedWaiting = 0;
const shareSkipped = new Set(); // fermés sans choix : plus reproposés d'eux-mêmes (ils attendent dans Réglages)
async function checkShared(all) {
  if (!NATIVE?.incoming || shareBusy || !KEY) return;
  const { items = [] } = await NATIVE.incoming().catch(() => ({}));
  sharedWaiting = items.length;
  const todo = all ? items : items.filter((i) => !shareSkipped.has(i.name));
  if (todo.length) shareSheet(todo[0], todo.length);
}
function shareSheet(item, count) {
  shareBusy = true;
  let chosen = false;
  const g = guessCourse(item.name);
  const sessions = (s) => S.events.filter((e) => e.subject === s && e.start <= shiftMin(nowStr(), 15)).reverse();
  const options = (s, sel) => `<option value="">Aucun cours précis (matière seulement)</option>` + sessions(s).map((e) => `<option value="${esc(e.uid)}" ${e.uid === sel ? 'selected' : ''}>${dFmt(e.start, { weekday: 'short', day: 'numeric', month: 'short' })} · ${e.start.slice(11, 16)} · ${esc(e.type || '')}</option>`).join('');
  openSheet(`<h2>${icon('file-plus')} Ranger le document</h2>
    <div class="list" style="margin-bottom:14px"><div class="row"><span class="lead">${icon('file')}</span><div class="grow"><div class="t">${esc(item.name)}</div><div class="s">${size(item.size)}${count > 1 ? ` · encore ${count - 1} après celui-ci` : ''}</div></div></div></div>
    <label class="field"><span>Matière${g.why ? ` <small class="note">proposée ${g.why}</small>` : ''}</span><select id="sh-subject">${subjects().map((s) => `<option ${s === g.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label class="field"><span>Cours</span><select id="sh-session">${options(g.subject, g.uid)}</select></label>
    <button class="btn" id="sh-send">Ajouter</button>
    <button class="btn secondary" id="sh-drop" style="margin-top:8px">Ne pas l’ajouter</button>
    <p class="note">Il sera lu (texte et schémas) et utilisé pour la fiche du cours.</p>`, (sh) => {
    $('#sh-subject', sh).onchange = (ev) => ($('#sh-session', sh).innerHTML = options(ev.target.value, ''));
    const next = () => { chosen = true; shareBusy = false; closeSheet(); setTimeout(() => checkShared(), 400); };
    $('#sh-send', sh).onclick = async () => {
      try { await NATIVE.sendShared({ name: item.name, path: item.path, uploadUrl: await linkFor('upload'), subject: $('#sh-subject', sh).value, uid: $('#sh-session', sh).value }); toast('Envoi en cours — tu seras notifié'); }
      catch (e) { shareSkipped.add(item.name); return toast(e.message + ' — mets à jour l’app (dernier ECAM.ipa)', 5000); }
      haptic('success'); next(); setTimeout(refresh, 4000);
    };
    $('#sh-drop', sh).onclick = async () => { shareSkipped.add(item.name); await NATIVE.dropShared({ name: item.name, path: item.path }).catch(() => {}); next(); };
  });
  // Fermée sans choisir : le document reste en attente, la feuille reviendra
  const obs = new MutationObserver(() => { if ($('#sheet').hidden) { if (!chosen) shareSkipped.add(item.name); shareBusy = false; obs.disconnect(); } });
  obs.observe($('#sheet'), { attributes: true, attributeFilter: ['hidden'] });
}

// ---------- Enregistrements gardés sur l'iPhone tant que le serveur ne les a pas reçus ----------
let nativePending = [];
async function syncPending(announce) {
  if (!NATIVE?.pending || !KEY) return;
  await NATIVE.retry({ uploadUrl: await linkFor('upload') }).catch(() => {}); // relance tout ce qui n'est pas parti
  const before = nativePending.length;
  nativePending = ((await NATIVE.pending().catch(() => ({}))).items || []);
  if (announce && nativePending.length) toast(`${nativePending.length} envoi(s) gardé(s) sur l’iPhone : envoi en cours`, 4000);
  if (before !== nativePending.length && location.hash === '#reglages') render(false);
}
const pendingSection = () => (NATIVE?.pending ? `<div class="section-title">Sur cet iPhone</div>
    <div class="list">${nativePending.length ? nativePending.map((p) => `<div class="row"><span class="lead">${icon(/\.m4a$|^Cours /.test(p.name) ? 'mic' : 'file')}</span><div class="grow"><div class="t">${esc(p.name.replace(/^[0-9A-F]{8}-/, ''))}</div><div class="s">${size(p.size)} · ${p.sending ? 'envoi en cours' : 'en attente d’envoi'}</div></div></div>`).join('')
      : `<div class="row"><span class="lead">${icon('check')}</span><div class="grow"><div class="t">Tout est envoyé</div><div class="s">Un enregistrement reste sur l’iPhone tant que le serveur ne l’a pas reçu</div></div></div>`}</div>
    ${nativePending.length ? `<div style="margin-top:10px"><button class="btn secondary" id="retry-pending">Renvoyer maintenant</button></div>` : ''}
    ${sharedWaiting ? `<div style="margin-top:10px"><button class="btn" id="file-shared">Ranger ${sharedWaiting} document${sharedWaiting > 1 ? 's' : ''} reçu${sharedWaiting > 1 ? 's' : ''}</button></div>` : ''}` : '');

// ---------- Transcription ajoutée à la main (texte collé, notes tapées…) ----------
function transcriptSheet(ev) {
  openSheet(`<h2>${icon('text')} Transcription du cours</h2>
    <p class="note" style="margin-top:-8px">Colle ou tape le texte du cours : il sert comme une transcription automatique (fiche, Claude).</p>
    <label class="field"><textarea id="tr-text" rows="10" placeholder="Texte du cours…" style="width:100%;min-height:220px;resize:vertical;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card)"></textarea></label>
    <button class="btn" id="tr-save">Ajouter au cours</button>`, (sh) => {
    $('#tr-save', sh).onclick = async () => {
      const text = $('#tr-text', sh).value.trim();
      if (text.length < 20) return toast('Le texte est trop court');
      const q = new URLSearchParams({ kind: 'transcript', subject: ev.subject, uid: ev.uid, name: 'Transcription (ajoutée à la main)' });
      try { await api('/files?' + q, { method: 'POST', body: text, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
      catch (e) { return toast(e.message); }
      haptic('success'); closeSheet(); toast('Transcription ajoutée'); refresh();
    };
  });
}

let uploadCtx = null;
function pickDocs(ctx) { uploadCtx = ctx; $('#picker').click(); }
$('#picker').onchange = async (ev) => {
  const files = [...ev.target.files]; ev.target.value = '';
  let dupes = 0;
  for (const [i, file] of files.entries()) {
    toast(`Envoi ${i + 1}/${files.length}…`, 0);
    const q = new URLSearchParams({ kind: file.type.startsWith('audio/') || /\.(m4a|mp3|wav|aac)$/i.test(file.name) ? 'audio' : 'doc', subject: uploadCtx.subject, name: file.name, dedupe: 1, ...(uploadCtx.uid ? { uid: uploadCtx.uid } : {}) });
    try { const r = await api('/files?' + q, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } }); if (r.duplicate) dupes++; }
    catch (e) { return toast(`Échec : ${e.message}`); }
  }
  const added = files.length - dupes;
  toast(dupes ? `${added} ajouté(s) · ${dupes} déjà présent(s), ignoré(s)` : files.length > 1 ? `${files.length} documents ajoutés` : 'Document ajouté', 4000);
  refresh();
};

// ---------- Portée d'un DS : les notions au programme ----------
const parseScope = (t) => { try { return JSON.parse(t?.scope || 'null'); } catch { return null; } };
const scopeText = (sc) => (sc ? [...(sc.notions || []), sc.texte].filter(Boolean).join(' ; ') : '');

// Fiche de prépa déjà faite pour ce DS (ou, à défaut, la plus récente de la matière)
function prepFiche(subject, uid) {
  const fs = S.files.filter((f) => f.kind === 'fiche' && f.subject === subject && /^Prépa DS/i.test(f.name));
  return fs.find((f) => f.event_uid === uid) || fs[0] || null;
}

// Date du DS précédent de la matière (pour « depuis le dernier DS »)
function lastDSBefore(subject, due) {
  const past = [
    ...S.tasks.filter((t) => t.subject === subject && t.kind === 'ds' && t.due < due).map((t) => t.due),
    ...S.events.filter((e) => e.subject === subject && isDS(e) && e.start < due).map((e) => e.start),
  ].sort();
  return past.pop() || '';
}

function programmeJob(subject) {
  return S.jobs.find((j) => j.type === 'programme' && j.subject === subject && j.status !== 'done');
}
async function askProgramme(subject) {
  try { await api('/programme', { method: 'POST', json: { subject } }); toast('Ton PC fait lister les notions par Claude — tu seras notifié', 4000); refresh(); }
  catch (e) { toast(e.message); }
}

function scopeSheet(t, ev, subject) {
  const prog = S.programmes?.[subject];
  const due = t?.due || ev.start;
  const sc = parseScope(t) || {};
  const chosen = new Set(sc.notions || []);
  if (!prog) {
    const job = programmeJob(subject);
    return openSheet(`<h2>Sur quoi porte ce DS ?</h2>
      <p class="note">Pour choisir les notions, il faut d’abord la liste des notions de <b>${esc(subject)}</b>. Ton PC la fait établir par Claude à partir de tous tes documents (transcriptions, notes, supports).</p>
      ${job ? `<div class="list"><div class="row"><span class="lead">${icon('refresh', 'spin')}</span><div class="grow"><div class="t">Analyse en cours</div><div class="s">Dès que ton PC est allumé — tu seras notifié</div></div></div></div>`
        : `<button class="btn" id="p-go">${icon('sparkles')}Lister les notions du cours</button>`}
      <label class="field" style="margin-top:16px"><span>En attendant, tu peux le préciser toi-même</span><input id="p-text" value="${esc(sc.texte || '')}" placeholder="Ex. chapitres 1 à 3, tout sauf le RGPD"></label>
      <button class="btn secondary" id="p-save">Enregistrer</button>`, (sh) => {
      $('#p-go', sh)?.addEventListener('click', () => { askProgramme(subject); closeSheet(); });
      $('#p-save', sh).onclick = () => saveScope(t, ev, subject, { notions: [], texte: $('#p-text', sh).value.trim() });
    });
  }
  const last = lastDSBefore(subject, due);
  const row = (n, i) => `<label class="pick"><input type="checkbox" data-n="${i}" ${chosen.has(n.titre) ? 'checked' : ''}><i></i><div class="grow"><div class="t">${esc(n.titre)}${'<span class="imp"></span>'.repeat(n.importance || 0)}</div><div class="s">${n.seances?.length ? n.seances.map((d) => dFmt(d, { day: 'numeric', month: 'short' })).join(', ') + ' · ' : ''}${esc(n.resume || '')}</div></div></label>`;
  openSheet(`<h2>Sur quoi porte ce DS ?</h2>
    <p class="note" style="margin-top:-8px">${esc(subject)} · ${dayLabel(due)}</p>
    <div class="quick"><button data-q="all">Tout</button>${last ? `<button data-q="since">Depuis le dernier DS (${dFmt(last, { day: 'numeric', month: 'short' })})</button>` : ''}<button data-q="none">Aucune</button></div>
    <div class="list picks">${prog.notions.map(row).join('')}</div>
    <label class="field" style="margin-top:14px"><span>Précision (facultatif)</span><input id="p-text" value="${esc(sc.texte || '')}" placeholder="Ex. surtout les exercices du TD2"></label>
    <button class="btn" id="p-save">Enregistrer</button>
    <p class="note">Liste établie ${ago(prog.at)} · <button class="link" id="p-redo">Mettre à jour</button> · <span id="p-count"></span></p>`, (sh) => {
    const boxes = [...sh.querySelectorAll('[data-n]')];
    const count = () => ($('#p-count', sh).textContent = `${boxes.filter((b) => b.checked).length} notion(s) choisie(s)`);
    boxes.forEach((b) => (b.onchange = count));
    sh.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
      boxes.forEach((x) => {
        const n = prog.notions[x.dataset.n];
        x.checked = b.dataset.q === 'all' || (b.dataset.q === 'since' && (n.seances || []).some((d) => d > last.slice(0, 10)));
      });
      count();
    }));
    $('#p-redo', sh).onclick = () => { askProgramme(subject); closeSheet(); };
    $('#p-save', sh).onclick = () => saveScope(t, ev, subject, { notions: boxes.filter((b) => b.checked).map((b) => prog.notions[b.dataset.n].titre), texte: $('#p-text', sh).value.trim() });
    count();
  });
}

async function saveScope(t, ev, subject, scope) {
  const empty = !scope.notions.length && !scope.texte;
  const task = t || { id: 'ds-' + ev.uid.replace(/\W+/g, '-'), subject, event_uid: ev.uid, due: ev.start, title: 'DS', kind: 'ds' };
  task.scope = empty ? null : JSON.stringify(scope);
  if (!S.tasks.includes(task)) S.tasks.push(task);
  try { await api('/tasks', { method: 'POST', json: task }); } catch (e) { return toast(e.message); }
  closeSheet(); toast(empty ? 'Tout le programme' : 'Programme du DS enregistré'); refresh();
}

// Fiche détaillée d'un DS / devoir : les infos d'abord, le crayon pour modifier
function openDetail(key) {
  const t = key.startsWith('t:') ? S.tasks.find((x) => x.id === key.slice(2)) : null;
  const ev = t ? (t.event_uid && findEvent(t.event_uid)) || S.events.find((e) => e.subject === t.subject && e.start === t.due.slice(0, 16)) : findEvent(key.slice(3));
  if (!t && !ev) return;
  const kind = t ? t.kind : 'ds', subject = t?.subject || ev.subject, due = t?.due || ev.start;
  const days = Math.round((Date.parse(due.slice(0, 10)) - Date.parse(todayStr())) / 864e5);
  const when = days === 0 ? 'Aujourd’hui' : days === 1 ? 'Demain' : days > 1 ? `Dans ${days} jours` : days === -1 ? 'Hier' : `Il y a ${-days} jours`;
  const mins = ev?.end ? (Date.parse(ev.end + ':00Z') - Date.parse(ev.start + ':00Z')) / 60000 : 0;
  const duration = mins ? `${Math.floor(mins / 60)} h${mins % 60 ? ' ' + String(mins % 60).padStart(2, '0') : ''}` : '';
  const hour = due.slice(11, 16) !== '00:00' ? due.slice(11, 16) + (ev?.end ? '–' + ev.end.slice(11, 16) : '') : '';
  const epreuve = kind === 'ds' ? (t && t.title && t.title !== 'DS' ? t.title : 'DS') : t.title;
  const scope = parseScope(t);
  const prep = kind === 'ds' ? prepFiche(subject, ev?.uid || t?.event_uid) : null;
  const info = (ic, k, v, muted) => `<div class="row plain"><span class="lead">${icon(ic)}</span><div class="grow"><div class="s">${k}</div><div class="t" style="white-space:normal;${muted ? 'color:var(--muted);font-weight:500' : ''}">${v}</div></div></div>`;
  openSheet(`<div class="detail-top"><span class="chip ${kind === 'ds' ? 'warn' : 'accent'}">${icon(kind === 'ds' ? 'target' : 'check')}${kind === 'ds' ? 'DS' : kind === 'autre' ? 'Rappel' : 'Devoir'}</span>
      <button class="icon-btn" id="d-edit" aria-label="Modifier">${icon('pencil')}</button></div>
    <h2 class="detail-title">${esc(kind === 'ds' ? subject : epreuve)}</h2>
    <div class="countdown ${days < 0 && t && !t.done ? 'late' : ''}">${when}${t?.done ? ' · fait' : ''}</div>
    ${prep ? `<a class="prep-ready" href="#fiche/${prep.id}" style="--c:${color(subject)}">${icon('sparkles')}<div class="grow"><b>Ta prépa est prête</b><span>${esc(prep.name)} · ${dFmt(prep.created, { day: 'numeric', month: 'short' })}</span></div>${icon('chevron-right')}</a>` : ''}
    ${t?.note ? `<div class="callout">${icon('bell')}<div><b>À ne pas oublier</b><div>${esc(t.note)}</div></div></div>` : ''}
    ${kind === 'ds' ? `<div class="section-title" style="margin-top:18px">Ce DS porte sur <button id="d-scope">${scope ? 'Modifier' : 'Choisir les notions'}</button></div>
      <div class="scope">${scope ? [...(scope.notions || []).map((n) => `<span class="chip">${esc(n)}</span>`), scope.texte ? `<span class="chip accent">${esc(scope.texte)}</span>` : ''].join('') : '<span class="note" style="margin:0">Tout le programme (non précisé) — touche « Choisir les notions » si le DS ne porte que sur une partie.</span>'}</div>` : ''}
    <div class="list" style="margin-top:14px">
      ${info('calendar', 'Date', `${dFmt(due, { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())}${hour ? ' · ' + hour : ''}${duration ? ` <span style="color:var(--muted);font-weight:500">(${duration})</span>` : ''}`)}
      ${kind === 'ds' ? info('target', 'Épreuve', esc(epreuve) + (ev?.type && !/^DS/i.test(ev.type) ? ` <span style="color:var(--muted);font-weight:500">· sur un créneau de ${esc(ev.type)}</span>` : '')) : info('book', 'Matière', esc(subject))}
      ${info('pin', 'Salle', esc(ev?.room || 'Non communiquée'), !ev?.room)}
      ${info('user', kind === 'ds' ? 'Surveillant / professeur' : 'Professeur', esc(ev?.teacher || 'Non communiqué'), !ev?.teacher)}
      ${t ? '' : info('grid', 'Source', 'Calendrier ECAM')}
    </div>
    <div style="margin-top:16px">
      ${kind === 'ds' ? `<button class="btn ${prep ? 'secondary' : ''}" id="d-prep">${icon('sparkles')}${prep ? 'Refaire la prépa avec Claude' : 'Préparer ce DS avec Claude'}</button>` : ''}
      ${ev ? `<button class="btn secondary" id="d-course">${icon('book')}Voir le cours</button>` : ''}
      ${t ? `<button class="btn secondary" id="d-done">${icon('check')}${t.done ? 'Remettre à faire' : 'Marquer comme fait'}</button>` : ''}
    </div>`, (sh) => {
    $('#d-edit', sh).onclick = () => taskSheet(t || { subject, event_uid: ev.uid, due: ev.start, kind: 'ds', title: 'DS' });
    $('#d-prep', sh)?.addEventListener('click', () => askSheet('ds', subject, scope ? { focus: 'UNIQUEMENT ' + scopeText(scope) + ' (le reste n’est pas au programme du DS)' } : {}));
    $('#d-scope', sh)?.addEventListener('click', () => scopeSheet(t, ev, subject));
    $('#d-course', sh)?.addEventListener('click', () => (location.hash = '#cours/' + encodeURIComponent(ev.uid)));
    $('#d-done', sh)?.addEventListener('click', async () => {
      t.done = t.done ? 0 : 1; closeSheet(); render(false);
      await api('/tasks', { method: 'POST', json: t }).catch((e) => toast(e.message));
      toast(t.done ? 'Fait' : 'Remis à faire');
    });
  });
}

function taskSheet(t) {
  const isNew = !t.id;
  const subs = subjects();
  openSheet(`<h2>${isNew ? 'Nouveau rappel' : 'Modifier'}</h2>
    <div class="seg" id="kind">${[['devoir', 'Devoir'], ['ds', 'DS'], ['autre', 'Autre']].map(([k, l]) => `<button data-k="${k}" class="${(t.kind || 'devoir') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="field"><span>Intitulé</span><input id="t-title" value="${esc(t.title || '')}" placeholder="Ex. exercices 3 à 7 page 42"></label>
    <label class="field"><span>Matière</span><select id="t-subject">${subs.map((s) => `<option ${s === t.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label class="field"><span>Pour le</span><input id="t-due" type="datetime-local" value="${esc(t.due || '')}"></label>
    <label class="field"><span>Note (rappelée dans les notifications)</span><textarea id="t-note" rows="2" placeholder="Ex. installer le logiciel SEB, apporter la calculatrice">${esc(t.note || '')}</textarea></label>
    <button class="btn" id="save">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
    ${isNew ? '' : `<button class="btn danger" id="del">${icon('trash')}Supprimer</button>`}
    <p class="note">Tu seras notifié 3 jours avant, la veille et le jour même.</p>`, (sh) => {
    let kind = t.kind || 'devoir';
    sh.querySelectorAll('#kind button').forEach((b) => (b.onclick = () => { kind = b.dataset.k; sh.querySelectorAll('#kind button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#save', sh).onclick = async () => {
      const title = $('#t-title', sh).value.trim(), due = $('#t-due', sh).value;
      if (!title && kind !== 'ds') return toast("Ajoute un intitulé");
      if (!due) return toast('Choisis une date');
      await api('/tasks', { method: 'POST', json: { ...t, title: title || 'DS', subject: $('#t-subject', sh).value, due, kind, note: $('#t-note', sh).value.trim() } });
      closeSheet(); toast(isNew ? 'Rappel ajouté' : 'Modifié'); refresh();
    };
    if (!isNew) $('#del', sh).onclick = async () => { await api('/tasks/' + t.id, { method: 'DELETE' }); closeSheet(); refresh(); };
  });
}

// ---------- App iPhone native (coque SideStore) : enregistreur intégré, haptique ----------
const NATIVE = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.EcamRecorder : null;
if (NATIVE) document.documentElement.classList.add('native');
const haptic = (style = 'light') => NATIVE?.haptic({ style }).catch(() => {});

async function recordNative(ev) {
  try {
    await api('/arm', { method: 'POST', json: ev }); // le cours qui recevra l'enregistrement
    await NATIVE.start({ course: ev.subject, uploadUrl: await linkFor('upload') });
    haptic('success');
    recSheet();
    recBar();
  } catch (e) { toast(e.message || 'Enregistrement impossible'); }
}

const fmtTime = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };

// Écran d'enregistrement : chrono, Pause / Reprendre, Arrêter et envoyer
function recSheet() {
  openSheet(`<div class="rec-sheet">
      <div class="rec-dot" id="r-dot"></div>
      <div class="rec-course" id="r-course"></div>
      <div class="rec-time" id="r-time">0:00</div>
      <p class="note" style="text-align:center">Tu peux verrouiller l’écran ou changer d’app : l’enregistrement continue (Dynamic Island).</p>
      <div class="rec-buttons">
        <button class="rec-btn" id="r-pause" aria-label="Pause">${icon('clock')}<span>Pause</span></button>
        <button class="rec-btn stop" id="r-stop" aria-label="Arrêter et envoyer"><i></i><span>Arrêter et envoyer</span></button>
      </div>
    </div>`, (sh) => {
    const update = async () => {
      if (sh.hidden) return clearInterval(tick);
      const s = await NATIVE.status();
      if (!s.active) { clearInterval(tick); return closeSheet(); }
      $('#r-course', sh).textContent = s.course;
      $('#r-time', sh).textContent = fmtTime(s.seconds);
      $('#r-dot', sh).classList.toggle('paused', !s.recording);
      $('#r-pause span', sh).textContent = s.recording ? 'Pause' : 'Reprendre';
    };
    const tick = setInterval(update, 500);
    update();
    $('#r-pause', sh).onclick = async () => { haptic('medium'); (await NATIVE.status()).recording ? await NATIVE.pause() : await NATIVE.resume(); update(); };
    $('#r-stop', sh).onclick = async () => {
      haptic('success'); clearInterval(tick);
      try { await NATIVE.stop(); toast('Envoi en cours — tu seras notifié'); } catch (e) { toast(e.message); }
      closeSheet(); recBar();
    };
  });
}

// Bandeau « enregistrement en cours » en haut de l'app (tant qu'un enregistrement tourne)
async function recBar() {
  if (!NATIVE) return;
  let bar = $('#rec-bar');
  const s = await NATIVE.status().catch(() => ({}));
  if (!s.active) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('button');
    bar.id = 'rec-bar';
    bar.onclick = () => { haptic(); recSheet(); };
    document.body.appendChild(bar);
    const t = setInterval(async () => {
      const st = await NATIVE.status().catch(() => ({}));
      if (!st.active) { clearInterval(t); bar.remove(); return; }
      bar.innerHTML = `<i class="${st.recording ? '' : 'paused'}"></i>${esc(st.course)} · ${fmtTime(st.seconds)}`;
    }, 1000);
  }
}
// Rappels programmés sur l'iPhone (comme ceux du serveur : J-3 et veille à 18 h, jour J à 7 h).
// Le Web Push n'existe pas dans l'app SideStore et l'APNs demande un compte Apple payant : l'app programme donc
// elle-même ses rappels, à chaque actualisation. Ils sonnent même app fermée.
let nativePerm = 'default';
function nativeReminders() {
  const items = [
    ...S.tasks.filter((t) => !t.done).map((t) => ({ key: 't-' + t.id, title: t.kind === 'ds' ? `DS — ${t.subject}` : t.title, sub: t.kind === 'ds' ? (t.title !== 'DS' ? t.title : '') : t.subject, due: t.due, note: t.note, url: t.event_uid ? '/#cours/' + encodeURIComponent(t.event_uid) : '/#devoirs' })),
    ...S.events.filter((e) => isDS(e) && !S.tasks.some((t) => t.event_uid === e.uid)).map((e) => ({ key: 'e-' + e.uid.replace(/\W+/g, ''), title: `DS — ${e.subject}`, due: e.start, place: e.room, url: '/#cours/' + encodeURIComponent(e.uid) })),
  ];
  const out = [];
  for (const it of items) for (const [n, label, hour] of [[3, 'Dans 3 jours', '18:00'], [1, 'Demain', '18:00'], [0, "Aujourd'hui", '07:00']]) {
    const time = it.due.slice(11, 16);
    out.push({ id: `${it.key}-${n}`, at: addDays(it.due, -n) + 'T' + hour, url: it.url, title: `${label} · ${it.title}`, body: [it.sub, time !== '00:00' ? time : '', it.place].filter(Boolean).join(' · ') + (it.note ? '\n' + it.note : '') });
  }
  return out.filter((x) => x.at > nowStr()).sort((a, b) => a.at.localeCompare(b.at));
}
async function scheduleNative(test) {
  if (nativePerm !== 'granted') return;
  const items = nativeReminders();
  if (test) items.unshift({ id: 'test', at: new Date(Date.now() + 70e3).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16).replace(' ', 'T'), title: 'Notifications activées', body: 'Tes DS et devoirs te seront rappelés ici.', url: '/#devoirs' });
  await NATIVE.schedule({ items }).catch(() => {});
}
async function enableNativeNotifs() {
  nativePerm = (await NATIVE.notifEnable().catch(() => ({ status: 'old' }))).status;
  if (nativePerm === 'granted') { await scheduleNative(true); toast('Notifications activées — test dans 1 minute', 4000); }
  render(false);
}
if (NATIVE) {
  NATIVE.notifStatus().then((r) => { nativePerm = r.status; scheduleNative(); if (location.hash === '#reglages') render(false); }).catch(() => { nativePerm = 'old'; });
  addEventListener('ecam-state', () => { scheduleNative(); syncPending(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => checkShared(), 600); });
  setTimeout(() => checkShared(), 1200);
  NATIVE.addListener?.('shared', () => checkShared()); // document reçu pendant que l'app est ouverte
  setTimeout(() => syncPending(true), 1500); // à l'ouverture : enregistrements restés sur le téléphone → renvoyés
  recBar();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recBar(); });
  // Petit retour haptique sur les éléments qu'on touche, comme une app iOS
  document.addEventListener('click', (e) => { if (e.target.closest('.btn, .action, .tabbar a, .day, .seg button, .seg a, .icon-btn, .pick, .switch, [data-done], .row, .card, .tile, .days-nav, .back')) haptic('medium'); }, true); // clics : vibration franche ; défilement des jours : légère
}

async function record(ev) {
  try { await api('/arm', { method: 'POST', json: ev }); } catch (e) { return toast(e.message); }
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT_REC);
}

function recGuide(ev) {
  const step = (n, html) => `<div class="row plain" style="align-items:flex-start"><b style="color:var(--accent);width:22px;flex:none">${n}</b><div class="grow" style="white-space:normal">${html}</div></div>`;
  openSheet(`<h2>Configurer l’enregistrement</h2>
    <p class="note">À faire une seule fois, dans l’app <b>Raccourcis</b> (l’icône aux carrés de couleur, déjà installée sur ta tablette).</p>

    <div class="section-title">Raccourci 1 · « ${SHORTCUT_REC} »</div>
    <p class="note">Il ouvre le Dictaphone quand tu touches « Enregistrer » dans l’app.</p>
    <div class="list">
      ${step(1, 'Ouvre <b>Raccourcis</b>, touche <b>+</b> (en haut à droite). Une page vide s’ouvre.')}
      ${step(2, 'Dans la barre <b>Rechercher des actions</b>, tape <b>Dictaphone</b>, puis touche <b>Enregistrer un nouveau mémo vocal</b>.<br><span class="s">Si cette action n’existe pas : tape <b>Ouvrir l’app</b>, touche-la, puis touche le mot bleu « App » et choisis <b>Dictaphone</b>.</span>')}
      ${step(3, `Tout en haut, touche le nom du raccourci → <b>Renommer</b> → écris exactement <b>${SHORTCUT_REC}</b>.`)}
      ${step(4, 'Touche <b>OK</b>. Terminé.')}
    </div>

    <div class="section-title">Raccourci 2 · « Envoyer à ECAM »</div>
    <p class="note">Il envoie l’enregistrement du Dictaphone vers l’app.</p>
    <div class="list">
      ${step(1, 'D’abord, copie ton lien d’envoi :<div style="margin-top:8px"><button class="btn secondary" id="g-url">Copier mon lien d’envoi</button></div>')}
      ${step(2, 'Dans Raccourcis, touche <b>+</b>. Dans <b>Rechercher des actions</b>, tape <b>URL</b> et touche <b>Obtenir le contenu de l’URL</b>. Un bloc apparaît.')}
      ${step(3, 'Dans ce bloc, touche le mot bleu <b>URL</b> (ou l’adresse grisée), efface, et <b>colle</b> ton lien.')}
      ${step(4, 'Touche la petite flèche <b>›</b> au bout du bloc. Des réglages s’ouvrent :<br>• <b>Méthode</b> : touche « GET » → choisis <b>POST</b>.<br>• <b>Corps de la requête</b> : touche « JSON » → choisis <b>Fichier</b>.<br>• Une ligne <b>Fichier</b> apparaît : touche-la → choisis <b>Entrée du raccourci</b>.<br>• <b>En-têtes</b> → Ajouter : clé <b>x-name</b>, valeur : touche-la → <b>Entrée du raccourci</b>, puis touche cette variable → <b>Nom</b>.<br><span class="s">Recommandé : le nom contient la date et l’heure de l’enregistrement, l’app retrouve alors le bon cours même si tu l’envoies des jours plus tard.</span>')}
      ${step(5, 'Tout en haut, touche le nom → <b>Renommer</b> → écris <b>Envoyer à ECAM</b>.')}
      ${step(6, 'Touche encore le nom en haut → <b>Détails</b> (ou le bouton <b>ⓘ</b>) → active <b>Afficher dans la feuille de partage</b> → <b>OK</b>.<br><span class="s">Ça fait apparaître « Envoyer à ECAM » quand tu touches le bouton Partager. En haut du raccourci, « Recevoir » doit accepter les <b>fichiers</b> et les <b>images</b> : tu pourras aussi y envoyer la photo du tableau ou un PDF.</span>')}
      ${step(7, 'Touche <b>OK</b>. Terminé.')}
    </div>

    <div class="section-title">Après chaque cours</div>
    <div class="list">
      ${step('→', 'Dictaphone → touche ton enregistrement → bouton <b>Partager</b> (le carré avec une flèche vers le haut) → fais défiler → <b>Envoyer à ECAM</b>.')}
    </div>
    <p class="note"><b>Trop compliqué ?</b> Sans aucun raccourci : Dictaphone → Partager → <b>Enregistrer dans Fichiers</b>. Puis dans l’app, ouvre le cours → <b>Document</b> → choisis l’audio. Ça marche pareil.</p>
    <button class="btn" id="g-done">${ev ? 'C’est fait — enregistrer' : 'C’est fait'}</button>`, (sh) => {
    $('#g-url', sh).onclick = async () => { await navigator.clipboard.writeText(await linkFor('upload')); toast('Lien copié — colle-le à l’étape 3'); };
    $('#g-done', sh).onclick = () => { store.set('recReady', '1'); closeSheet(); if (ev) record(ev); else render(false); };
  });
}

async function enablePush() {
  try {
    if ((await Notification.requestPermission()) !== 'granted') return render(false);
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(S.vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/subscribe', { method: 'POST', json: sub.toJSON() });
    await api('/test-push', { method: 'POST' });
    toast('Notifications activées');
  } catch (e) { toast('Impossible : ' + e.message); }
  render(false);
}

// ---------- Routage ----------
function render(animate = true, anim) {
  const tabbar = $('#tabbar');
  if (!KEY) {
    tabbar.hidden = true;
    view.innerHTML = vLogin();
    $('#go').onclick = async () => { KEY = $('#key').value.trim(); store.set('key', KEY); render(); refresh(); };
    return;
  }
  tabbar.hidden = false;
  const [route, arg] = location.hash.slice(1).split('/').map(decodeURIComponent);
  if (route === 'agenda' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) selDay = arg;
  const tab = { cours: 'agenda', matiere: 'devoirs', matieres: 'devoirs', rappels: 'devoirs', reglages: 'ecam', note: 'notes', fiche: null }[route] ?? (route || 'agenda');
  const wide = matchMedia('(min-width: 1024px)').matches;
  tabbar.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (wide && route === 'reglages' ? 'reglages' : tab)));
  moveIndicator();
  const prevScroll = view.scrollTop;
  if (route === 'fiche') { if (animate) { vFiche(arg); view.scrollTop = 0; play('push'); } return; }
  view.innerHTML = route === 'cours' ? vCours(arg) : route === 'matieres' ? vRappels('matieres') : route === 'assistant' ? vAssistant() : route === 'matiere' ? vMatiere(arg) : route === 'rappels' || route === 'devoirs' ? vRappels(arg) : route === 'notes' ? vNotes() : route === 'note' ? vNote(arg) : route === 'ecam' ? vEcam() : route === 'reglages' ? vReglages() : vAgenda();
  if (animate) { play(/^(cours|matiere|reglages|note)$/.test(route) ? 'push' : 'enter'); view.scrollTop = 0; } else { view.scrollTop = prevScroll; if (anim) play(anim); }
  bind(route, arg);
}

function moveIndicator() {
  const ind = $('.tab-ind'), a = $('#tabbar a.on');
  if (!ind) return;
  ind.style.opacity = a && a.offsetParent ? 1 : 0;
  if (!a || !a.offsetParent) return;
  if (!ind.dataset.ready) { ind.style.transition = 'none'; requestAnimationFrame(() => { ind.style.transition = ''; ind.dataset.ready = 1; }); } // pas de glissé au démarrage
  ind.style.transform = matchMedia('(min-width: 1024px)').matches
    ? `translateY(${a.offsetTop + a.offsetHeight / 2 - 10}px)`
    : `translateX(${a.offsetLeft + a.offsetWidth / 2 - 11}px)`;
}
addEventListener('resize', moveIndicator);

function play(cls) {
  view.classList.remove('enter', 'push', 'slide-l', 'slide-r');
  void view.offsetWidth; // relance l'animation
  view.classList.add(cls);
}

// Agenda : le contenu suit le doigt (comme Calendrier d'Apple) ; titre et bandeau restent en place
let sliding = false;
function goDay(day) {
  if (!day || day === selDay || sliding) return;
  const diff = Math.round((Date.parse(day) - Date.parse(selDay)) / 864e5);
  if (Math.abs(diff) === 1 && $('#track')) slideTo(diff);
  else setDay(day, diff > 0 ? 1 : -1, true);
}
// Titre de l'agenda (« Demain », date) : suit le doigt, puis s'efface vers le côté où part la journée
const agTitle = () => $('#ag-head .head > div');
function titleFollow(dx, width) {
  const t = agTitle();
  if (!t) return;
  t.style.transition = 'none';
  t.style.transform = `translateX(${dx * 0.35}px)`;
  t.style.opacity = Math.max(0.15, 1 - Math.abs(dx) / (width * 0.7));
}
function titleReset() {
  const t = agTitle();
  if (t) { t.style.transition = 'transform .32s cubic-bezier(.2, .8, .2, 1), opacity .32s'; t.style.transform = ''; t.style.opacity = ''; }
}
function slideTo(dir) {
  const track = $('#track'), t = agTitle();
  haptic('selection');
  sliding = true;
  if (t) { t.style.transition = 'transform .22s cubic-bezier(.4, 0, 1, 1), opacity .22s'; t.style.transform = `translateX(${dir > 0 ? -36 : 36}px)`; t.style.opacity = 0; }
  track.style.transition = 'transform .34s cubic-bezier(.2, .8, .2, 1)';
  track.style.transform = `translateX(${dir > 0 ? -66.6667 : 0}%)`;
  let done = false;
  const end = () => { if (done) return; done = true; sliding = false; setDay(addDays(selDay, dir), dir, false); };
  track.addEventListener('transitionend', end, { once: true });
  setTimeout(end, 450);
}
function setDay(day, dir, fade) {
  selDay = day;
  const head = $('#ag-head');
  if (!head) return render(false);
  head.innerHTML = agendaHead();
  head.querySelectorAll('h1, .sub').forEach((el) => el.classList.add(dir > 0 ? 'swap-l' : 'swap-r'));
  view.querySelectorAll('#days .day').forEach((b) => b.classList.toggle('sel', b.dataset.day === day));
  centerDay(true);
  const track = $('#track');
  track.style.transition = 'none';
  track.innerHTML = panes();
  track.style.transform = 'translateX(-33.3333%)';
  void track.offsetWidth;
  if (fade) { const pager = $('#pager'); pager.classList.remove('fadein'); void pager.offsetWidth; pager.classList.add('fadein'); }
  bindRows(view);
}
function pagerTouch() {
  const pager = $('#pager'), track = $('#track');
  if (!pager) return;
  let s = null;
  pager.ontouchstart = (e) => { if (!sliding && e.touches.length === 1) { const t = e.touches[0]; s = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, axis: null }; } };
  pager.addEventListener('touchmove', (e) => {
    if (!s) return;
    const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (s.axis === 'x') track.style.transition = 'none';
    }
    if (s.axis !== 'x') return;
    e.preventDefault();
    s.dx = dx;
    track.style.transform = `translateX(calc(-33.3333% + ${dx}px))`;
    titleFollow(dx, pager.clientWidth);
  }, { passive: false });
  pager.ontouchend = pager.ontouchcancel = () => {
    if (!s || s.axis !== 'x') { s = null; return; }
    const { dx } = s, speed = Math.abs(dx) / (Date.now() - s.t);
    s = null;
    if (Math.abs(dx) > pager.clientWidth * 0.25 || (Math.abs(dx) > 30 && speed > 0.45)) slideTo(dx < 0 ? 1 : -1);
    else { track.style.transition = 'transform .3s cubic-bezier(.2, .8, .2, 1)'; track.style.transform = 'translateX(-33.3333%)'; titleReset(); }
  };
}

// Éléments cliquables qui changent quand le jour change (en-tête, volets)
function bindRows(root) {
  root.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => goDay(b.dataset.day)));
  root.querySelectorAll('[data-week]').forEach((b) => (b.onclick = () => goDay(addDays(selDay, +b.dataset.week))));
  root.querySelectorAll('[data-href]').forEach((b) => (b.onclick = () => (location.hash = b.dataset.href)));
  root.querySelectorAll('[data-detail]').forEach((b) => (b.onclick = (ev) => { if (!ev.target.closest('[data-done]')) openDetail(b.dataset.detail); }));
  root.querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => {
    const t = S.tasks.find((x) => x.id === b.dataset.done);
    t.done = t.done ? 0 : 1; render(false);
    await api('/tasks', { method: 'POST', json: t }).catch((e) => toast(e.message));
    if (t.done) toast('Fait');
  }));
  const gotoDay = $('#goto-day', root);
  if (gotoDay) gotoDay.onchange = () => { if (gotoDay.value) goDay(gotoDay.value); };
}

function bind(route, arg) {
  bindRows(view);
  bindCharts(view);
  if (route === 'agenda' || !route) { centerDay(); wheelDays(); pagerTouch(); }
  view.querySelectorAll('[data-file]').forEach((b) => (b.onclick = () => openFile(b.dataset.file)));
  view.querySelectorAll('[data-prog]').forEach((b) => (b.onclick = () => askProgramme(b.dataset.prog)));
  view.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = async () => { await api(`/jobs/${b.dataset.retry}/pending`, { method: 'POST' }); toast('Relancé'); refresh(); }));
  view.querySelectorAll('[data-claude]').forEach((b) => (b.onclick = () => {
    const subject = b.dataset.subject || $('#ask-subject', view)?.value || arg;
    store.set('askSubject', subject);
    askSheet(b.dataset.claude, subject);
  }));
  view.querySelectorAll('[data-ask="cours"]').forEach((b) => (b.onclick = () => {
    const e = findEvent(arg);
    askSheet('expliquer', e.subject, { cours: e.start });
  }));
  const askSel = $('#ask-subject', view);
  if (askSel) askSel.onchange = () => store.set('askSubject', askSel.value);
  view.querySelectorAll('[data-rev]').forEach((b) => (b.onclick = async () => {
    await api('/jobs', { method: 'POST', json: { type: 'revision', subject: arg, params: { mode: b.dataset.rev } } });
    toast('Demandé — tu seras notifié quand c\'est prêt'); refresh();
  }));
  view.querySelectorAll('[data-unhide]').forEach((b) => (b.onclick = async () => { await api('/subjects', { method: 'POST', json: { name: b.dataset.unhide, hidden: 0 } }); refresh(); }));
  const on = (id, fn) => { const el = $('#' + id, view); if (el) el.onclick = fn; };

  const ev = route === 'cours' && findEvent(arg);
  on('rec', () => (NATIVE ? recordNative(ev) : store.get('recReady') ? record(ev) : recGuide(ev)));
  on('rec-guide', () => recGuide());
  on('fiche-now', async () => {
    try { await api('/courses/fiche', { method: 'POST', json: { uid: ev.uid } }); toast('C’est parti : la fiche se fait dès que ton PC est allumé'); refresh(); }
    catch (e) { toast(e.message); }
  });
  on('add-transcript', () => transcriptSheet(ev));
  on('share-notes', () => shareNotesSheet());
  on('file-shared', () => checkShared(true));
  on('retry-pending', async () => { await syncPending(); toast(nativePending.length ? 'Envoi relancé' : 'Tout est envoyé'); });
  on('add-doc', () => pickDocs(ev ? { subject: ev.subject, uid: ev.uid } : { subject: arg }));
  on('add-task', () => taskSheet(ev ? { subject: ev.subject, event_uid: ev.uid, due: ev.start } : { subject: subjects()[0], due: todayStr() + 'T08:00' }));
  on('hide-subject', async () => { await api('/subjects', { method: 'POST', json: { name: arg, hidden: 1 } }); location.hash = '#matieres'; refresh(); });
  on('toggle-done', () => { showDone = !showDone; render(false); });
  on('enable-push', NATIVE ? enableNativeNotifs : enablePush);
  on('test-push', async () => {
    if (NATIVE) { await scheduleNative(true); return toast('Notification de test dans 1 minute — tu peux verrouiller l’écran', 5000); }
    const r = await api('/test-push', { method: 'POST' }).catch((e) => [{ error: e.message }]);
    const bad = r.filter((x) => x.status !== 201 && x.status !== 200);
    toast(!r.length ? 'Aucun appareil abonné — réactive les notifications' : bad.length ? `Refusée : ${bad[0].error || bad[0].status}` : 'Envoyée — elle arrive dans quelques secondes', 5000);
  });
  on('e-save', async () => {
    const username = $('#e-user', view).value.trim(), password = $('#e-pass', view).value;
    if (!username || !password) return toast('Remplis les deux champs');
    toast('Connexion à l’ECAM…', 0);
    try { await api('/ecam/creds', { method: 'POST', json: { username, password } }); toast('Compte ECAM connecté'); }
    catch (e) { toast(e.message, 5000); }
    refresh();
  });
  on('e-sync', async () => {
    toast('Actualisation…', 0);
    const r = await api('/ecam/sync', { method: 'POST' }).catch((e) => ({ error: e.message }));
    toast(r.error || 'À jour'); refresh();
  });
  on('e-logout', async () => { if (confirm('Supprimer tes identifiants ECAM du serveur ?')) { await api('/ecam/creds', { method: 'DELETE' }); refresh(); } });
  on('ask-go', () => {
    const q = $('#ask-text', view).value.trim();
    if (!q) return toast('Écris ta question');
    askFree($('#ask-subject', view).value, q);
  });
  on('mcp-copy', async () => { await navigator.clipboard.writeText(await linkFor('mcp')); toast('Lien copié'); });
  on('mcp-done', () => { store.set('mcpReady', '1'); render(false); });
  on('mcp-copy2', async () => { await navigator.clipboard.writeText(await linkFor('mcp')); toast('Lien du connecteur copié'); });
  on('logout', () => { if (confirm('Se déconnecter de cet appareil ?')) { KEY = null; store.set('key', ''); render(); } });
}

function wheelDays() {
  const el = $('#days');
  if (el) el.onwheel = (ev) => { if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { el.scrollLeft += ev.deltaY; ev.preventDefault(); } };
}

function centerDay(smooth) {
  const sel = $('#days .sel');
  if (!sel) return;
  // Position relative au bandeau (offsetLeft dépend du parent positionné, faux avec les flèches)
  const strip = sel.parentElement, a = sel.getBoundingClientRect(), b = strip.getBoundingClientRect();
  strip.scrollTo({ left: strip.scrollLeft + a.left - b.left - (b.width - a.width) / 2, behavior: smooth ? 'smooth' : 'auto' });
}

addEventListener('hashchange', () => { closeSheet(); render(); });

// Comportement d'app native : pas de zoom au pincement (Safari iOS ignore user-scalable=no)
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
// Glisser depuis le bord gauche = retour, comme sur iOS (pages de détail uniquement)
let swipe = null;
addEventListener('touchstart', (e) => {
  if (NATIVE) return; // dans l'app iPhone, c'est le geste natif d'iOS qui fait le retour
  const t = e.touches[0];
  swipe = t.clientX < 24 && /^#(cours|matiere|fiche|reglages|note)/.test(location.hash) ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  if (swipe && t.clientX - swipe.x > 80 && Math.abs(t.clientY - swipe.y) < 60) history.back();
  swipe = null;
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') { openFromNotification(e.data.url); caches.delete('nav').catch(() => {}); } });
}
function openFromNotification(url) {
  const hash = new URL(url, location.origin).hash || '#agenda';
  closeSheet();
  if (hash !== location.hash) location.hash = hash;
}
async function pendingNav() { // l'app vient d'être ouverte par une notification
  try {
    const r = await (await caches.open('nav')).match('/__nav');
    if (!r) return;
    const { url, at } = await r.json();
    await caches.delete('nav');
    if (Date.now() - at < 120_000) openFromNotification(url);
  } catch {}
}
pendingNav();
document.addEventListener('visibilitychange', () => { if (!document.hidden) pendingNav(); });
render();
refresh();
setInterval(() => { if (!document.hidden && S.jobs.some((j) => j.status !== 'done' && j.status !== 'failed')) refresh(); }, 30_000);
