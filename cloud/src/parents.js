// Page publique des notes, en lecture seule, pour la famille : /notes/<jeton> (jeton aléatoire, kv « share_notes »).
// N'affiche QUE les notes et les moyennes ; rien d'autre de l'app. Nouveau lien depuis l'app = l'ancien ne marche plus.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (g) => parseFloat(String(g).replace(',', '.'));
const fmt = (x) => x.toFixed(2).replace('.', ',');
const day = (d, o = { day: 'numeric', month: 'long' }) => new Date(d + 'T12:00').toLocaleDateString('fr-FR', o);
const tone = (g) => (isNaN(num(g)) ? '' : num(g) >= 12 ? 'ok' : num(g) < 10 ? 'low' : 'mid');

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

export function parentsPage(rep, at) {
  const g = rep.general;
  const row = (n) => `<li><span class="grade ${tone(n.grade)}">${esc(String(n.grade).replace('/20', '').replace('.', ','))}</span>
      <div><b>${esc(n.exam || n.label)}</b><small>${day(n.date)}${n.average ? ` · moyenne de la classe ${esc(String(n.average).replace('/20', '').replace('.', ','))}` : ''}</small></div></li>`;
  // toutes les matières notées : validé ou non ; sinon tendance
  const status = (u) => { const done = u.ecs.every((e) => e.avg != null); return u.avg >= 10 ? `<span class="ok-tag">${done ? 'validé' : 'en bonne voie'}</span>` : `<span class="low-tag">${done ? 'non validé' : 'sous 10'}</span>`; };
  const mods = rep.modules.filter((u) => u.ecs.some((e) => e.notes.length));
  const moduleHtml = (u) => `<section class="mod"><h2><span>${esc(u.ue)} <small>${u.ects} ECTS</small></span>${u.avg != null ? `<span>${fmt(u.avg)} ${status(u)}</span>` : ''}</h2>
    ${u.ecs.filter((e) => e.notes.length).map((e) => `<h3><span>${esc(e.ec)}</span>${e.avg != null ? `<span>${fmt(e.avg)}</span>` : ''}</h3><ul>${e.notes.map(row).join('')}</ul>`).join('')}</section>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Notes ECAM</title>
<style>
:root{--bg:#f7f5f2;--card:#fff;--text:#1a1714;--muted:#7a736b;--line:#e8e3dd;--accent:#e85d1c;--ok:#1e8a5a;--ok-soft:#e2f3ea;--mid:#9a6a00;--mid-soft:#fbf1d9;--low:#c43d2e;--low-soft:#fbe5e2}
@media (prefers-color-scheme:dark){:root{--bg:#0e0d0c;--card:#181716;--text:#f6f4f1;--muted:#9a938b;--line:#2a2724;--accent:#ff6a24;--ok:#4fca8d;--ok-soft:#12291d;--mid:#f0c35a;--mid-soft:#2e2510;--low:#ff7b6b;--low-soft:#331512}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:680px;margin:0 auto;padding:28px 16px 48px}h1{font-size:30px;letter-spacing:-.03em;margin:0}.sub{color:var(--muted);margin:4px 0 22px;font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:12px}
.k{color:var(--muted);font-size:13px;font-weight:600}.v{font-size:40px;font-weight:750;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.v small{font-size:17px;color:var(--muted);font-weight:600}
svg{width:100%;height:auto;display:block;margin-top:8px}.grid{stroke:var(--line)}.ax{fill:var(--muted);font-size:11px}.ln{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round}.pt{fill:var(--accent);stroke:var(--card);stroke-width:2}
h2{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 4px 8px}
h2 span:last-child{text-transform:none;letter-spacing:0;font-size:14px;color:var(--text);font-weight:700}
ul{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
li{display:flex;gap:14px;align-items:center;padding:12px 14px;border-top:1px solid var(--line)}li:first-child{border-top:0}
li b{display:block;font-weight:600}li small{color:var(--muted);font-size:13px}em{font-style:normal;color:var(--accent)}
.grade{min-width:58px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;padding:7px 8px;border-radius:11px;background:var(--line)}
.grade.ok{background:var(--ok-soft);color:var(--ok)}.grade.mid{background:var(--mid-soft);color:var(--mid)}.grade.low{background:var(--low-soft);color:var(--low)}
.note{color:var(--muted);font-size:12.5px;margin-top:22px;text-align:center}
.mod{margin-top:26px}.mod h2{margin-top:0;align-items:flex-start}.mod h2 span:last-child{white-space:nowrap}h2 small{display:block;font-size:11px;letter-spacing:.04em;opacity:.8;margin-top:2px}
h3{display:flex;justify-content:space-between;gap:12px;font-size:14.5px;font-weight:600;margin:14px 4px 6px}h3 span:last-child{font-variant-numeric:tabular-nums;color:var(--muted)}
.ok-tag,.low-tag{font-size:11px;font-weight:700;padding:2px 7px;border-radius:7px;margin-left:6px;text-transform:uppercase;letter-spacing:.04em}
.ok-tag{background:var(--ok-soft);color:var(--ok)}.low-tag{background:var(--low-soft);color:var(--low)}
</style></head><body><main>
<h1>Notes</h1><div class="sub">Bachelor CSIU — ECAM LaSalle Lyon${at ? ` · mis à jour le ${new Date(at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
${g != null ? `<div class="card"><div class="k">Moyenne générale · ${rep.ects} ECTS évalués sur 30</div><div class="v">${fmt(g)}<small> /20</small></div>${chart(rep.history)}</div>` : ''}
${mods.map(moduleHtml).join('') || '<p class="sub">Aucune note pour l’instant.</p>'}
${rep.other.length ? `<section class="mod"><h2><span>Autres</span></h2><ul>${rep.other.map(row).join('')}</ul></section>` : ''}
<p class="note">Page en lecture seule, mise à jour automatiquement depuis l’intranet de l’école.<br>Chaque module (UE) se valide avec 10 de moyenne ; la moyenne générale pondère les modules par leurs crédits ECTS.</p>
</main></body></html>`;
}
