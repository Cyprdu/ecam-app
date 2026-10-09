// Parseurs de l'intranet, sur du HTML fictif reproduisant la structure réelle des pages.
import { parseNotes, parsePapercut, parseBar } from '../src/ecam.js';
const eq = (x, y) => { if (x !== y) throw new Error(`${x} !== ${y}`); };

const notes = parseNotes(`<table><tbody><tr><td>Note</td><td>Libellé</td><td>Barême</td><td>Moyenne</td><td>Professeur(s)</td><td>Date</td></tr>
<tr><td colspan="6"><div class="datePubli">Le mois dernier</div></td></tr>
<tr><td>12.50/20</td><td>Parcours X / SEMESTRE 1 - Matière A - Controle Continue - Evaluation1</td><td>50%</td><td>10.00/20</td><td>DUPONT Jean</td><td>01/10/2026</td></tr>
<tr><td>AJ/20</td><td>Parcours X / SEMESTRE 1 - Matière B - Oral</td><td>100%</td><td>11.15/20</td><td>MARTIN Ana</td><td>30/09/2026</td></tr></tbody></table>`);
eq(notes.length, 2);
eq(notes[0].grade, '12.50/20'); eq(notes[0].subject, 'Matière A'); eq(notes[0].exam, 'Controle Continue - Evaluation1'); eq(notes[0].date, '2026-10-01');
eq(notes[1].grade, 'AJ/20');

eq(parsePapercut('<div><span>PaperCut</span><span>9€</span><span>Solde : 8.90€</span></div>'), '8.90');

const bar = parseBar(`<main><div><p class="txt s7 bold">Accès au bar :</p> <p class="txt bold">Autorisé</p></div>
<div><p class="txt s8 bold">Solde</p> <p class="txt">12.50 €</p></div>
<div><p class="txt s7 bold">Boisson préférée :</p> <p class="txt">Ice tea</p></div>
<table><tbody><tr> <td class="dt-type-date">2026-09-10 17:54:29</td> <td>Coca</td> <td class="dt-type-numeric">1.00 €</td> </tr></tbody></table></main>`);
eq(bar.balance, '12.50'); eq(bar.favorite, 'Ice tea'); eq(bar.history.length, 1); eq(bar.history[0].item, 'Coca');
console.log('ecam OK');
