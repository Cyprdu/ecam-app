// Bulletin par module (UE) : rattachement des matières de l'intranet à la maquette, moyennes pondérées par ECTS
import { ecOf, bulletin, report } from '../src/modules.js';
const eq = (x, y) => { if (x !== y) throw new Error(`${x} !== ${y}`); };
const near = (x, y) => { if (Math.abs(x - y) > 1e-6) throw new Error(`${x} ≠ ${y}`); };

for (const [s, ue] of [['Introduction aux méthodologies de gestion de projet', "Autour de l'Entreprise"], ['Gestion du capital humain', 'Durabilité et Environnement'],
  ["Structure de l'entreprise et vie de l'entreprise", "Autour de l'Entreprise"], ['Outils Mathématiques Appliquées', 'Systèmes Industriels'],
  ['SI industriels - architecture et production', 'Systèmes Industriels'], ['Introduction Réseau IT', 'Réseau'], ['Ethique et Droit en Cybersécurité 1', "Autour de l'Entreprise"],
  ['Anglais technique', 'Outils de Communication 1'], ["Introduction aux systèmes d'information", 'Réseau']]) eq(ecOf(s)?.ue.ue, ue);
eq(ecOf('Cuisine moléculaire'), null);

const n = (subject, grade, date, weight = '100%') => ({ subject, grade, date, weight, label: subject + date });
const notes = [n('Introduction aux méthodologies de gestion de projet', '16/20', '2026-09-30', '50%'), n('Introduction aux méthodologies de gestion de projet', '15/20', '2026-09-30', '50%'),
  n("Structure de l'entreprise et vie de l'entreprise", '14.80/20', '2026-09-23'), n('Gestion du capital humain', '14/20', '2026-09-30'), n('Gestion du capital humain', 'AJ/20', '2026-09-30')];
const b = bulletin(notes);
near(b.modules.find((u) => u.ue === "Autour de l'Entreprise").avg, (15.5 + 14.8) / 2); // 2 matières à poids égal
near(b.general, (((15.5 + 14.8) / 2) * 4 + 14 * 2) / 6); // UE pondérées par leurs ECTS (4 et 2)
eq(b.ects, 6);
const r = report(notes);
eq(r.history.length, 2); near(r.effects["Gestion du capital humain2026-09-30|2026-09-30"].general[0], (15.5 + 14.8) / 2);
console.log('modules OK');
