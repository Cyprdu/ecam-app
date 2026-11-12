// Plan de lecture : chaque étape se lit en chapitres aelf.org valides, et le décalage est bien calculé
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const c = {}; vm.createContext(c);
vm.runInContext(readFileSync(new URL('../public/bible.js', import.meta.url), 'utf8') + '\nthis.P = BIBLE_PLAN; this.ch = bibleChapters; this.due = bibleDue; this.B = BIBLE_BOOKS;', c);
const eq = (x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`${JSON.stringify(x)} !== ${JSON.stringify(y)}`); };
eq(c.P.length, 365);
for (const r of c.P) for (const { book, chap } of c.ch(r)) {
  const count = Object.values(c.B).find(([b]) => b === book)[1];
  if (!(chap === 0 || /^\d+[AB]?$/.test(chap)) || parseInt(chap) > count) throw new Error(r + ' → ' + book + ' ' + chap);
}
eq(c.ch('Actes 6-7').map((x) => x.book + '/' + x.chap + ' ' + x.title), ['Ac/6 Actes 6', 'Ac/7 Actes 7']);
eq(c.ch('2 Jean, 3 Jean, Jude').map((x) => x.book + '/' + x.chap + ' ' + x.title), ['2Jn/1 2 Jean', '3Jn/1 3 Jean', 'Jude/1 Jude']);
eq(c.ch('Abdias & Jonas').map((x) => x.book + '/' + x.chap), ['Ab/0', 'Jon/1', 'Jon/2', 'Jon/3', 'Jon/4']);
eq(c.ch('Psaumes 119').map((x) => x.chap + ' ' + x.title), ['118 Psaume 119 (118)']);
eq(c.ch('Psaumes 110-118').map((x) => x.chap).join(), '109,110,111,112,113A,113B,114,115,116,117');
eq(c.ch('1 Rois 8').length, 1);
eq(c.ch('Galates').length, 6);
eq([c.due('2026-09-01'), c.due('2026-09-09'), c.due('2026-11-09'), c.due('2028-01-01')], [0, 1, 62, 365]);
eq(c.P[61], 'Actes 6-7'); // étape du 9 novembre 2026
console.log('bible OK');
