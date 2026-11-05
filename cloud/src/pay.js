// Paiements Apple Pay : l'automatisation « Transaction » de Raccourcis envoie le montant et le commerçant ici.

// « 12,50 € », « 12.5 », « 1 234,50 € », « €1,234.50 » → centimes ; null si illisible, négatif ou dans une autre devise
export function parseAmount(raw) {
  const s = String(raw ?? '');
  if (s.includes('-') || /[$£¥]|\b(USD|GBP|CHF|JPY|CAD)\b/i.test(s)) return null;
  const t = s.replace(/[^\d.,]/g, '');
  const m = t.match(/^(.*)[.,](\d{1,2})$/); // séparateur suivi de 1 ou 2 chiffres : ce sont les centimes
  const whole = (m ? m[1] : t).replace(/[.,]/g, '');
  if (!/^\d*$/.test(whole) || (!whole && !m)) return null;
  const cents = Number(whole || 0) * 100 + (m ? Number(m[2].padEnd(2, '0')) : 0);
  return cents > 0 && cents <= 1e7 ? cents : null;
}

const CATS = [
  ['Resto', /uber ?eats|deliveroo|mc ?do|burger|kfc|subway|domino|pizza|sushi|kebab|tacos|restaurant|brasserie|bistro|boulangerie|patisserie|starbucks|crous|\bcafe\b/],
  ['Courses', /carrefour|auchan|leclerc|lidl|aldi|intermarche|casino|monoprix|franprix|super ?u\b|hyper ?u\b|netto|picard|biocoop|naturalia|\bspar\b|supermarche/],
  ['Transport', /\btcl\b|sncf|blablacar|\buber\b|velo ?v|\bbolt\b|autoroute|peage|totalenergies|\besso\b|\bshell\b/],
  ['Sorties', /cinema|pathe|\bugc\b|\bbar\b|\bpub\b|bowling|concert|billetterie|\bfnac\b|musee/],
];
export const categoryOf = (merchant) => {
  const m = String(merchant || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return CATS.find(([, re]) => re.test(m))?.[0] || 'Autre';
};

export async function recordPayment(req, { DB, nowParis, created, notify }) {
  const body = await req.json().catch(() => ({}));
  const cents = parseAmount(body.montant), label = String(body.commercant || '').trim().slice(0, 80);
  // Raccourcis ne montre pas les erreurs du serveur : sans ce message, le paiement serait perdu en silence
  if (cents === null) {
    await notify({ title: 'Paiement à noter à la main', body: 'Montant illisible : ' + String(body.montant ?? 'vide').slice(0, 40) + (label ? ' · ' + label : ''), url: '/#budget' });
    return { status: 400, error: 'montant illisible' };
  }
  // ponytail: même commerçant, même montant, même minute = un seul paiement (l'automatisation peut se lancer deux fois)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nowParis.slice(0, 16) + '|' + cents + '|' + label));
  const id = 'pay-' + [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  // Une catégorie corrigée à la main sert pour les paiements suivants chez ce commerçant
  const known = label && (await DB.prepare('SELECT category FROM expenses WHERE label=? ORDER BY created DESC LIMIT 1').bind(label).first())?.category;
  const category = known || categoryOf(label);
  // OR IGNORE : un renvoi n'écrase pas une correction déjà faite
  await DB.prepare('INSERT OR IGNORE INTO expenses (id, day, cents, category, label, created) VALUES (?,?,?,?,?,?)').bind(id, nowParis.slice(0, 10), cents, category, label, created).run();
  return { status: 200, ok: true, cents, category };
}
