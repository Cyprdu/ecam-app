// Page publique des notes, en lecture seule, pour la famille : /notes/<jeton> (jeton aléatoire, kv « share_notes »).
// N'affiche QUE les notes et les moyennes ; rien d'autre de l'app. Nouveau lien depuis l'app = l'ancien ne marche plus.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (g) => parseFloat(String(g).replace(',', '.'));
const fmt = (x) => x.toFixed(2).replace('.', ',');
const day = (d, o = { day: 'numeric', month: 'long' }) => new Date(d + 'T12:00').toLocaleDateString('fr-FR', o);

function chart(pts) {
  if (pts.length < 2) return '';
  const W = 360, H = 150, L = 28, R = 10, T = 10, B = 22; // ≈ largeur d’un téléphone : texte lisible
  const vs = pts.map((p) => p[1]);
  const lo = Math.max(0, Math.floor(Math.min(...vs) - 0.5)), hi = Math.min(20, Math.max(Math.ceil(Math.max(...vs) + 0.5), lo + 2));
  const t0 = Date.parse(pts[0][0]), t1 = Date.parse(pts[pts.length - 1][0]);
  const x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution de la moyenne générale, de ${fmt(pts[0][1])} à ${fmt(last[1])}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${[lo, (lo + hi) / 2, hi].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${String(+v.toFixed(1)).replace('.', ',')}</text>`).join('')}
    <text x="${L}" y="${H - 6}" class="ax">${day(pts[0][0], { day: 'numeric', month: 'short' })}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">${day(last[0], { day: 'numeric', month: 'short' })}</text>
    <path d="${line}L${x(last[0])},${H - B}L${L},${H - B}Z" fill="url(#g)"/>
    <path d="${line}" class="ln"/>
    ${pts.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3.5" class="pt"><title>${day(p[0])} : ${fmt(p[1])}</title></circle>`).join('')}
  </svg>`;
}

const sign = (x) => (x >= 0 ? '+' : '−') + fmt(Math.abs(x));
// Couleur d'une note : par rapport à la moyenne de la classe (vert au-dessus, orange en dessous, gris sans moyenne)
const vsClass = (n) => { const g = num(n.grade), c = num(n.average); return isNaN(g) || isNaN(c) ? '' : g >= c ? 'ok' : 'low'; };
// Statut d'un module : validé / non validé quand toutes ses matières sont notées, sinon « en cours de validation »
function status(u) {
  const graded = u.ecs.filter((e) => e.avg != null).length, all = u.ecs.length;
  if (graded < all) return ['run', 'En cours de validation', `${graded} matière${graded > 1 ? 's' : ''} notée${graded > 1 ? 's' : ''} sur ${all}`];
  return u.avg >= 10 ? ['ok', 'Module validé', 'Toutes les matières sont notées'] : ['low', 'Module non validé', 'Moyenne sous 10'];
}

export function parentsPage(rep, at) {
  const g = rep.general;
  const mods = rep.modules.filter((u) => u.ecs.some((e) => e.notes.length));
  const empty = rep.modules.filter((u) => !u.ecs.some((e) => e.notes.length));
  const count = (k) => mods.filter((u) => status(u)[0] === k).length;
  const row = (n) => {
    const c = num(n.average), d = num(n.grade) - c;
    return `<li><span class="grade ${vsClass(n)}">${esc(String(n.grade).replace('/20', '').replace('.', ','))}</span>
      <div class="grow"><b>${esc(n.exam || n.label)}</b><small>${day(n.date)}${n.weight ? ` · ${esc(n.weight)} de la matière` : ''}</small></div>
      ${isNaN(c) ? '' : `<div class="cls"><span>Classe ${fmt(c)}</span><b class="${d >= 0 ? 'ok' : 'low'}">${sign(d)}</b></div>`}</li>`;
  };
  const moduleHtml = (u) => {
    const [k, label, detail] = status(u);
    return `<section class="card mod">
      <div class="mod-head"><div><div class="mod-name">${esc(u.ue)}</div><div class="mod-sub">Module · ${u.ects} crédits ECTS</div></div>
        <div class="mod-avg"><b class="${u.avg >= 10 ? 'ok' : 'low'}">${fmt(u.avg)}</b><span>/20</span></div></div>
      <div class="bar" role="img" aria-label="Moyenne du module ${fmt(u.avg)} sur 20, validation à 10"><i class="${u.avg >= 10 ? 'ok' : 'low'}" style="width:${(u.avg / 20) * 100}%"></i><em style="left:50%"></em></div>
      <div class="pill ${k}">${label}<small>${detail}</small></div>
      ${u.ecs.filter((e) => e.notes.length).map((e) => `<h3><span>${esc(e.ec)}</span><span>${e.avg != null ? fmt(e.avg) : '—'}</span></h3><ul>${e.notes.map(row).join('')}</ul>`).join('')}
    </section>`;
  };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Relevé de notes</title>
<style>
:root{--bg:#f6f5f3;--card:#fff;--text:#1a1714;--muted:#76706a;--line:#e7e3de;--accent:#e85d1c;--ok:#1b7f52;--ok-soft:#e1f2e9;--low:#c2410c;--low-soft:#fdeadd;--run:#2f5f9e;--run-soft:#e6eef9}
@media (prefers-color-scheme:dark){:root{--bg:#0e0d0c;--card:#181716;--text:#f6f4f1;--muted:#9a938b;--line:#2a2724;--accent:#ff6a24;--ok:#4fca8d;--ok-soft:#12291d;--low:#ff9a5c;--low-soft:#33200f;--run:#8fb4ec;--run-soft:#16223a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto;padding:30px 16px 56px}
h1{font-size:28px;letter-spacing:-.03em;margin:0}.sub{color:var(--muted);margin:4px 0 0;font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:14px}
.summary{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px 18px}.v{white-space:nowrap}.summary .k{color:var(--muted);font-size:13px;font-weight:600}
.v{font-size:44px;font-weight:760;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1.05}.v small{font-size:17px;color:var(--muted);font-weight:600}
.facts{display:flex;flex-wrap:wrap;gap:8px}.facts span{font-size:13px;padding:5px 10px;border-radius:999px;background:var(--bg);border:1px solid var(--line);white-space:nowrap}
svg{width:100%;flex-basis:100%;height:auto;display:block;margin-top:4px}.grid{stroke:var(--line)}.ax{fill:var(--muted);font-size:11px}.ln{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round}.pt{fill:var(--accent);stroke:var(--card);stroke-width:2}
.legend{margin-top:14px;padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-size:13.5px;color:var(--muted);display:grid;gap:7px}
.legend b{color:var(--text)}.sw{display:inline-block;width:11px;height:11px;border-radius:3px;margin:0 5px -1px 0}.sw.ok{background:var(--ok)}.sw.low{background:var(--low)}.sw.run{background:var(--run)}
.mod-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.mod-name{font-size:18px;font-weight:700;letter-spacing:-.01em}.mod-sub{color:var(--muted);font-size:13px;margin-top:2px}
.mod-avg{white-space:nowrap;text-align:right}.mod-avg b{font-size:28px;font-weight:760;font-variant-numeric:tabular-nums;letter-spacing:-.03em}.mod-avg span{color:var(--muted);font-weight:600;margin-left:2px}
b.ok{color:var(--ok)}b.low{color:var(--low)}
.bar{position:relative;height:7px;border-radius:7px;background:var(--line);margin:12px 0 10px}.bar i{position:absolute;inset:0 auto 0 0;border-radius:7px}.bar i.ok{background:var(--ok)}.bar i.low{background:var(--low)}
.bar em{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--text);opacity:.35;border-radius:2px}
.pill{display:inline-flex;flex-direction:column;font-size:13px;font-weight:700;padding:6px 11px;border-radius:10px}.pill small{font-weight:500;font-size:12px;opacity:.85}
.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.low{background:var(--low-soft);color:var(--low)}.pill.run{background:var(--run-soft);color:var(--run)}
h3{display:flex;justify-content:space-between;gap:12px;font-size:14.5px;font-weight:650;margin:18px 2px 8px}h3 span:last-child{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:600}
ul{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
li{display:flex;gap:12px;align-items:center;padding:11px 12px;border-top:1px solid var(--line)}li:first-child{border-top:0}.grow{flex:1;min-width:0}
li b{display:block;font-weight:600}li small{color:var(--muted);font-size:12.5px}
.grade{min-width:56px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;padding:7px 6px;border-radius:10px;background:var(--line)}
.grade.ok{background:var(--ok-soft);color:var(--ok)}.grade.low{background:var(--low-soft);color:var(--low)}
.cls{text-align:right;font-size:12.5px;color:var(--muted);white-space:nowrap}.cls b{display:block;font-size:13.5px;font-variant-numeric:tabular-nums}
.empty-mods{display:grid;gap:6px;margin-top:8px}.empty-mods div{display:flex;justify-content:space-between;font-size:14px;color:var(--muted)}
h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:30px 4px 0}
</style></head><body><main>
<h1>Relevé de notes</h1>
<div class="sub">Bachelor Cybersécurité des Systèmes Industriels et Urbains · 1re année · ECAM LaSalle Lyon${at ? ` · à jour le ${new Date(at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
${g != null ? `<div class="card summary"><div><div class="k">Moyenne générale</div><div class="v">${fmt(g)}<small> /20</small></div></div>
  <div class="facts">${[`${rep.ects} / 30 crédits évalués`, count('ok') && `${count('ok')} module${count('ok') > 1 ? 's' : ''} validé${count('ok') > 1 ? 's' : ''}`, count('run') && `${count('run')} module${count('run') > 1 ? 's' : ''} en cours de validation`, count('low') && `${count('low')} non validé${count('low') > 1 ? 's' : ''}`].filter(Boolean).map((t) => `<span>${t}</span>`).join('')}</div>${chart(rep.history)}</div>` : ''}
<div class="legend">
  <div><b>Modules</b> — les matières sont regroupées en ${rep.modules.length} modules. Un module est validé quand sa moyenne atteint <b>10/20</b> (trait sur la barre) ; la moyenne générale tient compte des crédits de chaque module.</div>
  <div><b>Statut</b> — <span class="sw run"></span>en cours de validation (toutes les matières ne sont pas encore notées) · <span class="sw ok"></span>validé · <span class="sw low"></span>non validé</div>
  <div><b>Notes</b> — <span class="sw ok"></span>au-dessus de la moyenne de la classe · <span class="sw low"></span>en dessous</div>
</div>
${mods.map(moduleHtml).join('') || '<p class="sub" style="margin-top:20px">Aucune note pour l’instant.</p>'}
${rep.other.length ? `<section class="card mod"><div class="mod-name">Autres notes</div><ul style="margin-top:10px">${rep.other.map(row).join('')}</ul></section>` : ''}
${empty.length ? `<h2>Modules pas encore notés</h2><div class="card empty-mods">${empty.map((u) => `<div><span>${esc(u.ue)}</span><span>${u.ects} ECTS</span></div>`).join('')}</div>` : ''}
</main></body></html>`;
}
