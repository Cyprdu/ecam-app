// Fête du jour : un nom pour chaque jour de l'année, prénom à souhaiter correct
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const c = {}; vm.createContext(c);
vm.runInContext(readFileSync(new URL('../public/saints.js', import.meta.url), 'utf8') + '\nthis.S = SAINTS; this.saintOf = saintOf;', c);
const eq = (x, y) => { if (x !== y) throw new Error(`${x} !== ${y}`); };
eq(c.S.length, 12);
[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].forEach((n, i) => eq(c.S[i].length, n));
for (const [day, saint, name] of [
  ['2026-11-06', 'Ste Bertille', 'Bertille'], ['2026-12-31', 'St Sylvestre', 'Sylvestre'], ['2028-02-29', 'St Auguste', 'Auguste'],
  ['2026-04-07', 'St Jean-Baptiste de la Salle', 'Jean-Baptiste'], ['2026-01-28', 'St Thomas d’Aquin', 'Thomas'], ['2026-03-02', 'St Charles le Bon', 'Charles'],
  ['2026-06-29', 'Sts Pierre et Paul', 'Pierre et Paul'], ['2026-12-25', 'Noël', ''], ['2026-11-01', 'Toussaint', ''], ['2026-12-28', 'Saints Innocents', ''],
]) { const s = c.saintOf(day); eq(s.saint, saint); eq(s.name, name); }
console.log('saints OK');
