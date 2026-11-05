// Budget : droit du jour, rythme, statut, saisie des montants
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const c = {}; vm.createContext(c);
vm.runInContext(readFileSync(new URL('../public/budget.js', import.meta.url), 'utf8') + '\nthis.budgetStats = budgetStats; this.parseCents = parseCents;', c);
const eq = (x, y) => { if (x !== y) throw new Error(`${x} !== ${y}`); };
const near = (x, y) => { if (Math.abs(x - y) > 1e-6) throw new Error(`${x} ≠ ${y}`); };
const S = { monthly: 65000, fixed: 45000 };
const e = (day, cents, category = 'Courses') => ({ day, cents, category });

// Mois de 30 jours, rien de dépensé : 200 € / 30
let s = c.budgetStats(S, [], '2026-11', '2026-11-01');
eq(s.days, 30); eq(s.budget, 20000); near(s.daily, 20000 / 30); near(s.todayLeft, 20000 / 30); eq(s.status, 'ok'); eq(s.daysLeft, 30);

// Février 2028 (bissextile) : 29 jours
eq(c.budgetStats(S, [], '2028-02', '2028-02-10').days, 29);

// Le 11 : 100 € dépensés avant, 5 € aujourd'hui → reste 95 € pour 20 jours ; droit du jour = 100 € / 20 = 5 €
s = c.budgetStats(S, [e('2026-11-02', 10000), e('2026-11-11', 500)], '2026-11', '2026-11-11');
near(s.todayAllowance, 500); near(s.todayLeft, 0); eq(s.spent, 10500); eq(s.left, 9500); eq(s.status, 'late'); // rythme : 73,33 € au 11
near(s.nextDaily, 9500 / 19); eq(s.cumul.length, 11); eq(s.cumul[10], 10500); eq(s.forecast, Math.round((10500 / 11) * 30));

// En avance sur le rythme
s = c.budgetStats(S, [e('2026-11-15', 1000)], '2026-11', '2026-11-15');
eq(s.status, 'ok'); near(s.margin, 10000 - 1000);

// Budget dépassé : droit du jour à 0, jamais négatif
s = c.budgetStats(S, [e('2026-11-03', 25000)], '2026-11', '2026-11-10');
eq(s.status, 'over'); eq(s.left, -5000); eq(s.todayAllowance, 0); eq(s.nextDaily, 0);

// Dernier jour du mois : pas de division par zéro
s = c.budgetStats(S, [e('2026-11-30', 100)], '2026-11', '2026-11-30');
eq(s.daysLeft, 1); eq(s.nextDaily, 0); near(s.todayAllowance, 20000);

// Mois passé : terminé, et les dépenses d'un autre mois ne comptent pas
s = c.budgetStats(S, [e('2026-10-05', 3000), e('2026-11-01', 999)], '2026-10', '2026-11-05');
eq(s.current, false); eq(s.day, 31); eq(s.spent, 3000); eq(s.byCat.Courses, 3000);

// Saisie
eq(c.parseCents('12,50'), 1250); eq(c.parseCents('12.5'), 1250); eq(c.parseCents('7'), 700); eq(c.parseCents(' 3,99 € '), 399); eq(c.parseCents('19,99'), 1999);
eq(c.parseCents('abc'), null); eq(c.parseCents(''), null); eq(c.parseCents('-4'), null); eq(c.parseCents('1,234'), null);
console.log('budget OK');
