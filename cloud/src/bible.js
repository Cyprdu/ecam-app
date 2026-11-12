// Lectures de la messe (API AELF) et chapitres de la Bible (pages aelf.org/bible). L'app les garde ensuite sur l'appareil.

const UA = { 'User-Agent': 'ECAM-app (lecture personnelle)' };

// Garde seulement la mise en forme simple (paragraphes, gras, italique) : jamais de script ni d'attribut venu d'ailleurs
export const cleanHtml = (h) => String(h || '').replace(/<(\/?)(p|br|strong|em|b|i|sup)\b[^>]*>|<[^>]*>/gi, (_, end, tag) => (tag ? `<${end}${tag.toLowerCase()}>` : ''));

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&#0*39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

const LABELS = { lecture_1: 'Première lecture', psaume: 'Psaume', lecture_2: 'Deuxième lecture', evangile: 'Évangile', cantique: 'Cantique' };

// Messe du jour : première lecture, psaume, deuxième lecture (dimanches et fêtes), évangile
export async function messesDuJour(day) {
  const r = await fetch(`https://api.aelf.org/v1/messes/${day}/france`, { headers: UA });
  if (!r.ok) throw new Error('AELF ' + r.status);
  const { informations: info, messes } = await r.json();
  const messe = messes.find((x) => /jour/i.test(x.nom)) || messes[0];
  const seen = new Set();
  const lectures = (messe?.lectures || []).filter((l) => !seen.has(l.type) && seen.add(l.type)) // forme longue seulement
    .map((l) => ({
      label: LABELS[l.type] || (/^lecture_(\d+)/.test(l.type) ? `Lecture ${l.type.slice(8)}` : 'Lecture'),
      ref: l.ref || '', intro: l.intro_lue || '', titre: l.titre || '',
      refrain: cleanHtml(l.refrain_psalmique), verset: cleanHtml(l.verset_evangile), html: cleanHtml(l.contenu),
    }));
  return { jour: info.ligne1 || info.jour_liturgique_nom || '', fete: info.fete || '', messe: messes.length > 1 ? messe.nom : '', lectures };
}

// Un chapitre : [[numéro, texte], …]. Psaumes en numérotation liturgique (118 = 119 de la Bible hébraïque)
export async function chapitre(book, chap) {
  const r = await fetch(`https://www.aelf.org/bible/${book}/${chap}`, { headers: UA });
  if (!r.ok) throw new Error('chapitre introuvable');
  const html = await r.text();
  const verses = [...html.matchAll(/<p>\s*<span class="(?:verse_number|text-danger)">([^<]*)<\/span>([\s\S]*?)<\/p>/g)]
    .map(([, n, t]) => [n.replace(/^0+(?=\d)/, ''), decode(t.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()]);
  if (!verses.length) throw new Error('chapitre vide');
  return { verses };
}
