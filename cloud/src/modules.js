// Maquette du Bachelor CSIU 1 (cursus.ecam.fr/LIBCys01A__24, semestre 1, codes LIBCys01U11_*) :
// les matières (EC) sont regroupées en modules (UE) ; une UE se valide avec 10 de moyenne ; la moyenne générale
// pondère les UE par leurs crédits ECTS. La maquette ne publie pas le poids de chaque matière dans son UE :
// ponytail: matières d'une même UE à poids égal ; mettre `poids` sur une matière si l'école en donne un.
export const MAQUETTE = [
  { ue: "Fondamentaux de l'OT", ects: 4, ecs: ['Fondements du Génie Électrique et Électronique', 'Inventaire et Identification des Actifs OT'] },
  { ue: 'Systèmes Industriels', ects: 4, ecs: ['Outils Mathématiques Appliquées', 'SI Industriels : Architecture et Production'] },
  { ue: 'Réseau', ects: 5, ecs: ['Administration et Services Réseaux', 'Introduction Réseau IT', "Introduction aux Systèmes d'Information"] },
  { ue: 'Informatique 1', ects: 6, ecs: ['Algorithmie et Langage Python', 'Architecture et Composants Matériels', 'Développement Front End'] },
  { ue: 'Outils de Communication 1', ects: 3, ecs: ['Anglais Technique', 'Techniques de Communication Orales et Écrites 1'] },
  { ue: 'Durabilité et Environnement', ects: 2, ecs: ['Écosystème et Pollution', 'Enjeux de la Transformation Climat', 'Gestion du Capital Humain'] },
  { ue: 'Fondamentaux OS', ects: 2, ecs: ['Linux : Shell et Services', 'Windows : Configuration et Diagnostic'] },
  { ue: "Autour de l'Entreprise", ects: 4, ecs: ["Approches vers l'Entreprise et les Métiers 1", 'Éthique et Droit en Cybersécurité 1', 'Introduction aux Méthodologies de Gestion de Projet', "Structure de l'Entreprise et Vie de l'Entreprise"] },
];

const key = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(1|de|du|des|la|le|les|l|d|et|aux|a|vers)\b/g, ' ').replace(/\s+/g, ' ').trim();
const num = (g) => parseFloat(String(g).replace(',', '.'));
const words = (s) => key(s).split(' ').filter((w) => w.length >= 3);

// Matière de l'intranet → matière de la maquette (nom exact sans accents, sinon le plus de mots en commun)
export function ecOf(subject) {
  const k = key(subject);
  for (const u of MAQUETTE) for (const ec of u.ecs) if (key(ec) === k) return { ue: u, ec };
  let best = null, score = 0;
  for (const u of MAQUETTE) for (const ec of u.ecs) {
    const w = words(ec), common = words(subject).filter((x) => w.some((y) => y.startsWith(x) || x.startsWith(y))).length;
    const s = common / Math.max(w.length, 1);
    if (common >= 2 && s > score) { best = { ue: u, ec }; score = s; }
  }
  return best;
}

// Moyenne d'une matière : notes pondérées par leur barème (%) ; AJ, ABS… ignorées
const ecAvg = (ns) => {
  const ok = ns.filter((n) => !isNaN(num(n.grade)));
  const w = ok.reduce((s, n) => s + (parseFloat(n.weight) || 100), 0);
  return ok.length ? ok.reduce((s, n) => s + num(n.grade) * (parseFloat(n.weight) || 100), 0) / w : null;
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Bulletin par module : { modules, other, general, ects } — seules les UE qui ont déjà une note comptent. */
export function bulletin(notes) {
  const modules = MAQUETTE.map((u) => ({ ue: u.ue, ects: u.ects, ecs: u.ecs.map((ec) => ({ ec, notes: [] })) }));
  const other = [];
  for (const n of notes || []) {
    const m = ecOf(n.subject);
    if (!m) { other.push(n); continue; }
    modules.find((x) => x.ue === m.ue.ue).ecs.find((x) => x.ec === m.ec).notes.push(n);
  }
  for (const u of modules) {
    for (const e of u.ecs) e.avg = ecAvg(e.notes);
    u.avg = mean(u.ecs.map((e) => e.avg).filter((a) => a != null));
  }
  const graded = modules.filter((u) => u.avg != null);
  const ects = graded.reduce((s, u) => s + u.ects, 0);
  const general = ects ? graded.reduce((s, u) => s + u.avg * u.ects, 0) / ects : null;
  return { modules, other, general, ects };
}

/** Évolution de la moyenne générale : recalculée à chaque date où une note est tombée. */
export function history(notes) {
  const days = [...new Set((notes || []).filter((n) => !isNaN(num(n.grade))).map((n) => n.date))].sort();
  return days.map((d) => [d, bulletin(notes.filter((n) => n.date <= d)).general]).filter((p) => p[1] != null).map(([d, v]) => [d, +v.toFixed(2)]);
}

/** Tout ce que l'app et la page « famille » affichent, plus l'effet de chaque note (avec / sans elle). */
export function report(notes) {
  const b = bulletin(notes);
  const effects = {};
  for (const n of notes || []) {
    if (isNaN(num(n.grade))) continue;
    const without = bulletin(notes.filter((x) => x !== n)), m = ecOf(n.subject);
    const ecA = (r) => r.modules.flatMap((u) => u.ecs).find((e) => e.ec === m?.ec)?.avg ?? null;
    const ueA = (r) => r.modules.find((u) => u.ue === m?.ue.ue)?.avg ?? null;
    effects[`${n.label}|${n.date}`] = { ec: [ecA(without), ecA(b)], ue: [ueA(without), ueA(b)], general: [without.general, b.general] };
  }
  return { ...b, history: history(notes), effects };
}
