// Calculs du budget (montants en centimes) : séparés de l'interface pour être testés (test/budget.test.mjs).
const BUDGET_DEFAULT = { monthly: 65000, fixed: 45000, alerts: true, evening: false };

// month : « AAAA-MM » ; today : « AAAA-MM-JJ ». Un mois passé est vu comme terminé (aujourd'hui = son dernier jour).
function budgetStats(settings, expenses, month, today) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const current = today.slice(0, 7) === month;
  const day = current ? Number(today.slice(8, 10)) : days;
  const budget = Math.max(0, settings.monthly - settings.fixed);
  const list = expenses.filter((e) => e.day.slice(0, 7) === month);
  const byDay = Array(days).fill(0), byCat = {};
  for (const e of list) { byDay[Number(e.day.slice(8, 10)) - 1] += e.cents; byCat[e.category] = (byCat[e.category] || 0) + e.cents; }
  const upTo = (n) => byDay.slice(0, n).reduce((a, b) => a + b, 0);
  const spent = upTo(days), spentToday = byDay[day - 1], daily = budget / days;
  const left = budget - spent, daysLeft = days - day + 1;
  // Ce qui reste, réparti sur les jours restants (aujourd'hui compris) : une dépense d'hier change le droit d'aujourd'hui
  const todayAllowance = Math.max(0, budget - (spent - spentToday)) / daysLeft;
  const margin = daily * day - spent; // positif : en avance sur le rythme
  return {
    days, day, current, budget, spent, spentToday, daily, left, daysLeft, margin, byDay, byCat, list, todayAllowance,
    todayLeft: todayAllowance - spentToday,
    // ponytail: prévision au rythme moyen du mois, peu fiable les premiers jours (masquée avant le 5)
    forecast: day >= 5 ? Math.round((spent / day) * days) : null,
    nextDaily: days > day ? Math.max(0, left) / (days - day) : 0, // à viser par jour à partir de demain
    status: left < 0 ? 'over' : margin < 0 ? 'late' : 'ok',
    cumul: byDay.slice(0, day).map((_, i) => upTo(i + 1)),
  };
}

// « 12,50 » ou « 12.5 » → 1250 ; null si ce n'est pas un montant
function parseCents(text) {
  const t = String(text).trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
