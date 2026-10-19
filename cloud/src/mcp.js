// Connecteur MCP pour Claude (claude.ai / app Claude) : Claude lit les cours et enregistre ses fiches dans l'app.
// Protocole : JSON-RPC 2.0 en HTTP simple (« Streamable HTTP » sans flux).
import { mergeManual } from './ecam.js';
import { PLAN } from './alternance.js';
import { report } from './modules.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX = 40000; // caractères renvoyés par lecture
const DOSSIER = 120000; // caractères max renvoyés par dossier_revision
const RESUME = 'Résumé'; // nom des résumés faits par le PC (enfants « text » des documents longs)

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ctx : { env, allEvents, storeFile, notifyAll, today } fourni par index.js
export function tools(ctx) {
  const { env } = ctx;
  const DB = env.DB;

  async function subjects() {
    const evs = await ctx.allEvents(env).catch(() => []);
    const { results } = await DB.prepare("SELECT DISTINCT subject FROM files WHERE kind != 'text'").all();
    return { evs, names: [...new Set([...evs.map((e) => e.subject), ...results.map((r) => r.subject)])].filter(Boolean).sort() };
  }
  async function findSubject(name) {
    const { names } = await subjects();
    const n = norm(name);
    const exact = names.find((s) => norm(s) === n) || names.find((s) => norm(s).includes(n) || n.includes(norm(s)));
    if (exact) return exact;
    // « maths » → « Outils Mathématiques Appliquées » : mots de la question = débuts de mots de la matière
    const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const score = (s) => words(name).filter((q) => words(s).some((w) => w.startsWith(q.replace(/s$/, '')))).length;
    const best = names.map((s) => [score(s), s]).sort((a, b) => b[0] - a[0])[0];
    return best?.[0] > 0 ? best[1] : null;
  }
  const session = (uid) => (uid ? uid.split('|')[0].replace('T', ' ') : '');

  return [
    {
      name: 'emploi_du_temps',
      description: "Cours de l'étudiant (matière, type CM/TD/TP/DS, salle, prof) entre deux dates. Par défaut : 7 jours avant à 14 jours après aujourd'hui.",
      inputSchema: { type: 'object', properties: { du: { type: 'string', description: 'AAAA-MM-JJ' }, au: { type: 'string', description: 'AAAA-MM-JJ' } } },
      async run({ du, au }) {
        const t = ctx.today();
        const from = du || new Date(Date.parse(t) - 7 * 864e5).toISOString().slice(0, 10);
        const to = au || new Date(Date.parse(t) + 14 * 864e5).toISOString().slice(0, 10);
        const evs = (await ctx.allEvents(env)).filter((e) => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to);
        return `Aujourd'hui : ${t}\n` + (evs.map((e) => `${e.start.replace('T', ' ')}-${(e.end || '').slice(11)} · ${e.subject} · ${e.type} · ${e.room || ''} · ${e.teacher || ''}`).join('\n') || 'Aucun cours.');
      },
    },
    {
      name: 'lister_matieres',
      description: 'Liste des matières avec le nombre de documents et de fiches de chacune.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const { names } = await subjects();
        const { results } = await DB.prepare("SELECT subject, kind, COUNT(*) AS n FROM files WHERE kind != 'text' GROUP BY subject, kind").all();
        return names.map((s) => `${s} : ${results.filter((r) => r.subject === s).map((r) => `${r.n} ${r.kind}`).join(', ') || 'aucun document'}`).join('\n');
      },
    },
    {
      name: 'lister_documents',
      description: "Liste des documents d'une matière (id, type, séance). Pour réviser, préfère dossier_revision qui donne directement leur contenu résumé en un seul appel.",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' } }, required: ['matiere'] },
      async run({ matiere }) {
        const s = await findSubject(matiere);
        if (!s) return `Matière inconnue. Utilise lister_matieres.`;
        const { results } = await DB.prepare("SELECT f.*, (SELECT COUNT(*) FROM files t WHERE t.parent = f.id AND t.kind = 'text' AND t.name != ?) AS has_text, (SELECT COUNT(*) FROM files t WHERE t.parent = f.id AND t.kind = 'text' AND t.name = ?) AS has_digest FROM files f WHERE f.subject = ? AND f.kind != 'text' ORDER BY COALESCE(f.event_uid, ''), f.name").bind(RESUME, RESUME, s).all();
        const lisible = (f) => ['transcript', 'fiche'].includes(f.kind) || f.has_text || /^text\//.test(f.mime || '');
        return `Matière : ${s}\n` + results.map((f) => `- id=${f.id} · ${f.kind} · ${f.name}${f.event_uid ? ` · séance ${session(f.event_uid)}` : ''} · ${Math.round(f.size / 1024)} Ko${f.has_digest ? ' · résumé dispo' : ''}${f.kind === 'audio' ? '' : lisible(f) ? '' : ' · (texte non disponible)'}`).join('\n');
      },
    },
    {
      name: 'lire_document',
      description: `Contenu d'un document. Par défaut son RÉSUMÉ s'il en a un (beaucoup plus court) ; complet=true pour le texte intégral (${MAX} caractères max par appel, "debut" pour la suite). N'utilise complet=true que si un point précis manque.`,
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, complet: { type: 'boolean', description: 'texte intégral au lieu du résumé' }, debut: { type: 'number', description: 'position de départ (caractères)' } }, required: ['id'] },
      async run({ id, complet = false, debut = 0 }) {
        const f = await DB.prepare('SELECT * FROM files WHERE id=?').bind(id).first();
        if (!f) return 'Document introuvable.';
        const digest = !complet && !debut && (await DB.prepare("SELECT id FROM files WHERE parent=? AND kind='text' AND name=?").bind(id, RESUME).first());
        if (digest) return `# ${f.name} — résumé (${f.subject}${f.event_uid ? ', séance ' + session(f.event_uid) : ''})\n\n${await (await env.FILES.get(digest.id))?.text()}\n\n[Texte intégral : lire_document avec complet=true, seulement si nécessaire]`;
        const textId = ['transcript', 'fiche', 'text'].includes(f.kind) || /^text\//.test(f.mime || '') ? f.id : (await DB.prepare("SELECT id FROM files WHERE parent=? AND kind='text' AND name != ?").bind(id, RESUME).first())?.id;
        if (!textId) return `Pas de texte disponible pour « ${f.name} » (le PC n'a pas encore extrait son contenu).`;
        const all = await (await env.FILES.get(textId))?.text();
        if (all == null) return 'Contenu introuvable.';
        const part = all.slice(debut, debut + MAX);
        const rest = all.length - debut - part.length;
        return `# ${f.name} (${f.subject}${f.event_uid ? ', séance ' + session(f.event_uid) : ''})\n\n${part}${rest > 0 ? `\n\n[… ${rest} caractères restants : rappelle lire_document avec debut=${debut + part.length}]` : ''}`;
      },
    },
    {
      name: 'dossier_revision',
      description: "À UTILISER EN PREMIER pour toute fiche, mémo, prépa DS, quiz ou explication : tout le contenu utile d'une matière en UN appel (fiches des cours en entier, puis résumé de chaque transcription, note et support). Avec seance=AAAA-MM-JJ : seulement ce cours, transcription complète comprise.",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' }, seance: { type: 'string', description: 'optionnel : AAAA-MM-JJ du cours' } }, required: ['matiere'] },
      async run({ matiere, seance }) {
        const s = await findSubject(matiere);
        if (!s) return 'Matière inconnue. Utilise lister_matieres.';
        const { results } = await DB.prepare("SELECT f.id, f.kind, f.name, f.mime, f.event_uid, (SELECT id FROM files t WHERE t.parent = f.id AND t.kind = 'text' AND t.name = ?) AS digest_id, (SELECT id FROM files t WHERE t.parent = f.id AND t.kind = 'text' AND t.name != ?) AS text_id FROM files f WHERE f.subject = ? AND f.kind IN ('fiche', 'transcript', 'doc') ORDER BY COALESCE(f.event_uid, ''), f.name").bind(RESUME, RESUME, s).all();
        const inSession = (f) => !seance || (f.event_uid || '').startsWith(seance);
        const read = async (id) => (id ? (await (await env.FILES.get(id))?.text()) || '' : '');
        // fiches des cours d'abord (elles couvrent leur transcription), puis les autres documents
        const courseFiches = results.filter((f) => f.kind === 'fiche' && f.event_uid && inSession(f));
        const covered = new Set(courseFiches.map((f) => f.event_uid));
        const others = results.filter((f) => f.kind !== 'fiche' && inSession(f) && !(f.kind === 'transcript' && covered.has(f.event_uid) && !seance));
        const out = [];
        let left = DOSSIER;
        const add = (title, text) => { if (!text || left < 500) return; const t = text.slice(0, left); out.push(`=== ${title} ===\n${t}`); left -= t.length; };
        for (const f of courseFiches) add(`Fiche du cours du ${session(f.event_uid)} — ${f.name}`, await read(f.id));
        for (const f of others) {
          const own = f.kind === 'transcript' || /^text\//.test(f.mime || '') ? f.id : f.text_id;
          // une séance précise : texte complet ; toute la matière : résumé (ou début du texte s'il n'y a pas encore de résumé)
          const text = seance || !f.digest_id ? (await read(own)).slice(0, seance ? 90000 : 6000) : await read(f.digest_id);
          add(`${f.kind === 'transcript' ? 'Transcription' : 'Document'} ${f.name}${f.event_uid ? ' (séance ' + session(f.event_uid) + ')' : ''}${!seance && f.digest_id ? ' — résumé' : ''} [id=${f.id}]`, text);
        }
        return out.length ? `Matière : ${s}${seance ? ' — séance du ' + seance : ''}\n\n` + out.join('\n\n') + (left < 500 ? '\n\n[Limite atteinte : le reste est accessible avec lire_document]' : '') : `Aucun contenu lisible pour ${s}${seance ? ' le ' + seance : ''}.`;
      },
    },
    {
      name: 'alternance',
      description: "Recherche d'alternance de l'étudiant (rentrée septembre 2027) : profil visé, entreprises cibles et où il en est avec chacune, plateformes, calendrier, attendus des recruteurs, conseils de CV. À lire avant de rédiger un CV, une lettre ou de préparer un entretien.",
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const st = JSON.parse((await DB.prepare("SELECT value FROM kv WHERE key='alternance'").first())?.value || '{}');
        const c = (x) => { const s = st.companies?.[x.id] || {}; return `- ${x.name} (${x.where}) — ${s.status || 'à faire'}${s.applied ? ', candidaté le ' + s.applied : ''}${s.note ? ' — note : ' + s.note : ''}\n  Pourquoi : ${x.why}\n  Quand : ${x.when}\n  Attendus : ${x.expect}\n  CV : ${x.cv}`; };
        return [`Objectif : ${PLAN.goal.title}, ${PLAN.goal.where}, à partir de ${PLAN.goal.start}. ${PLAN.goal.wish}.`, 'ENTREPRISES :', ...PLAN.companies.map(c),
          'CALENDRIER (estimations) :', ...PLAN.steps.map(([d, t]) => `- ${d} : ${t}`), 'ATTENDUS DES RECRUTEURS :', ...PLAN.expect.map((x) => '- ' + x), 'CONTENU DU CV :', ...PLAN.cv.map((x) => '- ' + x),
          'Règle : ne mettre dans un CV ou une lettre que ce qui est réel ; demander à l’étudiant ce qui manque (expériences, niveau d’anglais, projets perso).'].join('\n');
      },
    },
    {
      name: 'rechercher',
      description: "Cherche un mot ou une expression dans TOUS les cours de l'étudiant (transcriptions, fiches, textes des documents), éventuellement dans une seule matière. Renvoie les passages trouvés avec leur document et leur séance. Idéal pour retrouver ce que le prof a dit d'un sujet (« DS », « exercice 4 », « TCP ») sans tout relire.",
      inputSchema: { type: 'object', properties: { texte: { type: 'string' }, matiere: { type: 'string', description: 'optionnel' } }, required: ['texte'] },
      async run({ texte, matiere }) {
        const s = matiere ? await findSubject(matiere) : null;
        const { results } = await DB.prepare(`SELECT f.id, f.kind, f.name, f.subject, f.event_uid, p.name AS pname, p.event_uid AS puid FROM files f LEFT JOIN files p ON p.id = f.parent WHERE f.kind IN ('transcript', 'fiche', 'text') AND (f.kind != 'text' OR f.name != 'Résumé') ${s ? 'AND f.subject = ?' : ''} ORDER BY f.created DESC LIMIT 120`).bind(...(s ? [s] : [])).all();
        // minuscules et sans accents, caractère par caractère : les positions restent celles du texte original
        const flat = (x) => x.split('').map((c) => (c.normalize('NFD')[0] || c).toLowerCase()[0]).join('');
        const q = flat(texte.trim()), out = [];
        for (const f of results) {
          if (out.length >= 25) break;
          const t = (await (await env.FILES.get(f.id))?.text()) || '', n = flat(t);
          let i = n.indexOf(q), hits = 0;
          while (i >= 0 && hits < 3) { out.push(`[${f.subject} · ${f.kind === 'text' ? 'document ' + (f.pname || f.name) : f.kind === 'fiche' ? 'fiche ' + f.name : 'transcription'}${(f.event_uid || f.puid) ? ' · séance ' + session(f.event_uid || f.puid) : ''}] …${t.slice(Math.max(0, i - 220), i + q.length + 220).replace(/\s+/g, ' ')}…`); hits++; i = n.indexOf(q, i + q.length + 200); }
        }
        return out.length ? `${out.length} passage(s) pour « ${texte} »${s ? ' en ' + s : ''} :\n\n` + out.join('\n\n') : `Rien trouvé pour « ${texte} »${s ? ' en ' + s : ''}.`;
      },
    },
    {
      name: 'cours',
      description: "Tout sur une séance précise : date, salle, prof, ce qui a été envoyé (enregistrement, transcription, documents, fiche), les devoirs liés, les infos ajoutées par l'étudiant et si la fiche automatique est activée. Donne la date (AAAA-MM-JJ) et la matière.",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' }, date: { type: 'string', description: 'AAAA-MM-JJ' } }, required: ['matiere', 'date'] },
      async run({ matiere, date }) {
        const s = await findSubject(matiere);
        const evs = (await ctx.allEvents(env)).filter((e) => e.subject === s && e.start.startsWith(date));
        if (!evs.length) return `Pas de cours de ${s || matiere} le ${date}.`;
        const opts = JSON.parse((await DB.prepare("SELECT value FROM kv WHERE key='course_opts'").first())?.value || '{}');
        const out = [];
        for (const e of evs) {
          const { results: fs } = await DB.prepare("SELECT id, kind, name FROM files WHERE event_uid=? AND kind != 'text'").bind(e.uid).all();
          const { results: ts } = await DB.prepare('SELECT title, due, done, kind FROM tasks WHERE event_uid=? OR (subject=? AND substr(due, 1, 10) >= ?) ORDER BY due LIMIT 8').bind(e.uid, s, date).all();
          const o = opts[e.uid] || {};
          out.push(`${e.subject} — ${e.start.replace('T', ' ')} à ${(e.end || '').slice(11)} · ${e.type || ''} · salle ${e.room || '?'} · ${e.teacher || ''}
Fiche automatique : ${o.fiche === false ? 'désactivée' : 'activée'}${o.info ? '\nInfos ajoutées par l’étudiant : ' + o.info : ''}
Fichiers : ${fs.map((f) => `${f.kind} « ${f.name} » (id=${f.id})`).join(' ; ') || 'aucun'}
Devoirs et DS liés ou à venir : ${ts.map((t) => `${t.due.slice(0, 10)} ${t.kind} « ${t.title} »${t.done ? ' (fait)' : ''}`).join(' ; ') || 'aucun'}`);
        }
        return out.join('\n\n');
      },
    },
    {
      name: 'infos_cours',
      description: "Ajoute des informations à une séance (ce que le prof a annoncé, matériel à prévoir, chapitre traité…) et/ou active ou désactive la fiche de révision automatique de cette séance. Les infos servent ensuite aux fiches et à Claude.",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' }, date: { type: 'string', description: 'AAAA-MM-JJ' }, info: { type: 'string', description: 'texte ajouté aux infos existantes' }, fiche_auto: { type: 'boolean' } }, required: ['matiere', 'date'] },
      async run({ matiere, date, info, fiche_auto }) {
        const s = await findSubject(matiere);
        const e = (await ctx.allEvents(env)).find((x) => x.subject === s && x.start.startsWith(date));
        if (!e) return `Pas de cours de ${s || matiere} le ${date}.`;
        const all = JSON.parse((await DB.prepare("SELECT value FROM kv WHERE key='course_opts'").first())?.value || '{}');
        const o = (all[e.uid] ||= {});
        if (info) o.info = [o.info, info].filter(Boolean).join('\n');
        if (typeof fiche_auto === 'boolean') o.fiche = fiche_auto;
        o.at = new Date().toISOString();
        await DB.prepare("INSERT OR REPLACE INTO kv VALUES ('course_opts', ?)").bind(JSON.stringify(all)).run();
        return `Cours de ${s} du ${e.start.replace('T', ' ')} : ${info ? 'infos ajoutées' : ''}${info && typeof fiche_auto === 'boolean' ? ', ' : ''}${typeof fiche_auto === 'boolean' ? 'fiche automatique ' + (fiche_auto ? 'activée' : 'désactivée') : ''}.`;
      },
    },
    {
      name: 'marquer_fait',
      description: "Coche (ou décoche) un devoir ou un DS de l'étudiant, d'après les premiers mots de son titre (voir l'outil devoirs).",
      inputSchema: { type: 'object', properties: { titre: { type: 'string' }, fait: { type: 'boolean' } }, required: ['titre'] },
      async run({ titre, fait = true }) {
        const { results } = await DB.prepare('SELECT id, title, subject, due FROM tasks ORDER BY due').all();
        const t = results.find((x) => norm(x.title).startsWith(norm(titre))) || results.find((x) => norm(x.title).includes(norm(titre)));
        if (!t) return 'Devoir introuvable : utilise l’outil devoirs pour voir les titres exacts.';
        await DB.prepare('UPDATE tasks SET done=? WHERE id=?').bind(fait ? 1 : 0, t.id).run();
        return `« ${t.title} » (${t.subject}, ${t.due.slice(0, 10)}) : ${fait ? 'fait' : 'à faire'}.`;
      },
    },
    {
      name: 'consignes_fiche',
      description: "Consignes personnelles de l'étudiant pour rédiger une fiche de révision. À suivre pour toute fiche.",
      inputSchema: { type: 'object', properties: {} },
      async run() {
        return (await DB.prepare("SELECT value FROM kv WHERE key='prompt'").first())?.value || 'Fiche longue, exhaustive, structurée, avec définitions, pièges et questions probables.';
      },
    },
    {
      name: 'enregistrer_fiche',
      description: "Enregistre dans l'app de l'étudiant une fiche (révision, mémo, prépa DS, quiz…) en Markdown. Il reçoit une notification et la retrouve dans l'onglet Assistant.",
      inputSchema: {
        type: 'object',
        properties: { matiere: { type: 'string' }, titre: { type: 'string' }, contenu: { type: 'string', description: 'Markdown complet' }, seance: { type: 'string', description: 'optionnel : AAAA-MM-JJ du cours concerné' } },
        required: ['matiere', 'titre', 'contenu'],
      },
      async run({ matiere, titre, contenu, seance }) {
        const { evs } = await subjects();
        const s = (await findSubject(matiere)) || matiere;
        const ev = seance ? evs.find((e) => e.subject === s && e.start.startsWith(seance)) : null;
        const old = (await DB.prepare("SELECT id FROM files WHERE subject=? AND name=? AND kind='fiche'").bind(s, titre).all()).results;
        const f = await ctx.storeFile(env, contenu, { subject: s, event_uid: ev?.uid, name: titre, kind: 'fiche', mime: 'text/markdown; charset=utf-8' });
        for (const o of old) { await env.FILES.delete(o.id); await DB.prepare('DELETE FROM files WHERE id=?').bind(o.id).run(); } // nouvelle version
        await ctx.notifyAll(env, { title: 'Nouvelle fiche', body: `${s} — ${titre}`, url: `/#fiche/${f.id}` });
        return `Fiche « ${titre} » enregistrée dans l'app (matière ${s})${old.length ? ', elle remplace la version précédente' : ''}.`;
      },
    },
    {
      name: 'programme',
      description: "Notions (chapitres) d'une matière dans l'ordre du cours, avec les séances où elles ont été vues. Utile pour ne réviser que ce qui est au programme d'un DS (voir devoirs : « porte uniquement sur »).",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' } }, required: ['matiere'] },
      async run({ matiere }) {
        const s = await findSubject(matiere);
        const p = s && JSON.parse((await DB.prepare('SELECT value FROM kv WHERE key=?').bind('programme:' + s).first())?.value || 'null');
        if (!p) return `Pas encore de liste de notions pour ${s || matiere} : l'étudiant peut la générer depuis la page de la matière.`;
        return `${s} — notions :\n` + p.notions.map((n, i) => `${i + 1}. ${n.titre}${n.seances?.length ? ` (séances ${n.seances.join(', ')})` : ''}${n.resume ? ' — ' + n.resume : ''}`).join('\n');
      },
    },
    {
      name: 'notes_ecam',
      description: "Notes officielles de l'étudiant sur l'intranet ECAM (note, épreuve, coefficient, moyenne de la classe).",
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const e = JSON.parse((await DB.prepare("SELECT value FROM kv WHERE key='ecam'").first())?.value || '{}');
        const perso = JSON.parse((await DB.prepare("SELECT value FROM kv WHERE key='notes_perso'").first())?.value || '[]');
        const all = mergeManual(e.notes, perso), r = report(all);
        const head = r.general == null ? '' : `Moyenne générale ${r.general.toFixed(2)}/20 (${r.ects}/30 ECTS évalués ; modules pondérés par leurs ECTS, validés à 10)\n` + r.modules.filter((u) => u.avg != null).map((u) => `- Module ${u.ue} (${u.ects} ECTS) : ${u.avg.toFixed(2)} — ${u.ecs.filter((x) => x.avg != null).map((x) => `${x.ec} ${x.avg.toFixed(2)}`).join(', ')}`).join('\n') + '\n\nDétail :\n';
        return head + all.map((n) => `${n.date} · ${n.subject} · ${n.exam} · ${n.grade}${n.manual ? ' (saisie par l’étudiant, pas encore sur l’intranet)' : ` (coef ${n.weight}, moyenne classe ${n.average})`}`).join('\n') || 'Aucune note (compte ECAM non connecté ?).';
      },
    },
    {
      name: 'devoirs',
      description: 'Devoirs et DS à venir (y compris les DS du calendrier).',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const { results } = await DB.prepare('SELECT * FROM tasks WHERE done=0 ORDER BY due').all();
        const ds = (await ctx.allEvents(env)).filter((e) => /^(DS|Examen|Partiel|Contr)/i.test(e.type) && e.start >= ctx.today());
        const portee = (t) => { try { const sc = JSON.parse(t.scope || 'null'); return sc ? ` — PORTE UNIQUEMENT SUR : ${[...(sc.notions || []), sc.texte].filter(Boolean).join(' ; ')}` : ''; } catch { return ''; } };
        return [...results.map((t) => `${t.due.replace('T', ' ')} · ${t.subject} · ${t.kind} · ${t.title}${t.note ? ' — ' + t.note : ''}${portee(t)}`), ...ds.map((e) => `${e.start.replace('T', ' ')} · ${e.subject} · DS (calendrier) · salle ${e.room || '?'}`)].sort().join('\n') || 'Rien à faire.';
      },
    },
    {
      name: 'ajouter_devoir',
      description: "Ajoute un devoir ou un DS aux rappels de l'étudiant (notifié 3 jours avant, la veille et le jour même).",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' }, titre: { type: 'string' }, date: { type: 'string', description: 'AAAA-MM-JJ ou AAAA-MM-JJTHH:MM' }, type: { type: 'string', enum: ['devoir', 'ds', 'autre'] }, note: { type: 'string', description: 'optionnel : précision affichée dans les rappels (ex. matériel à prévoir)' } }, required: ['matiere', 'titre', 'date'] },
      async run({ matiere, titre, date, type = 'devoir', note }) {
        const s = (await findSubject(matiere)) || matiere;
        const due = date.length === 10 ? date + 'T08:00' : date.slice(0, 16);
        await DB.prepare('INSERT INTO tasks (id, subject, event_uid, due, title, kind, done, created, note) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), s, null, due, titre, type, 0, new Date().toISOString(), note || null).run();
        return `Ajouté : ${titre} (${s}) pour le ${due.replace('T', ' ')}.`;
      },
    },
  ];
}

export async function handleMcp(req, ctx) {
  if (req.method !== 'POST') return new Response(null, { status: req.method === 'DELETE' ? 204 : 405, headers: { allow: 'POST' } });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }, { status: 400 });
  const list = tools(ctx);
  const handle = async (m) => {
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    switch (m.method) {
      case 'initialize':
        return ok({
          protocolVersion: VERSIONS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'ECAM', version: '1.0.0' },
          instructions: "Accès aux cours d'un étudiant de l'ECAM : emploi du temps, transcriptions, supports, fiches, notes, devoirs. Pour retrouver ce qu'un prof a dit : rechercher. Pour une séance : cours. Pour une fiche : consignes_fiche, puis dossier_revision (UN appel, contenu déjà résumé), puis enregistrer_fiche. N'ouvre un document entier (lire_document complet=true) que s'il manque un point précis.",
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: list.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const t = list.find((x) => x.name === m.params?.name);
        if (!t) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Outil inconnu' } };
        try {
          return ok({ content: [{ type: 'text', text: await t.run(m.params.arguments || {}) }] });
        } catch (e) {
          return ok({ content: [{ type: 'text', text: 'Erreur : ' + (e.message || e) }], isError: true });
        }
      }
      default:
        return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Méthode inconnue' } };
    }
  };
  const msgs = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of msgs) if (m.id !== undefined && m.id !== null) out.push(await handle(m));
  if (!out.length) return new Response(null, { status: 202 }); // notifications
  return Response.json(Array.isArray(body) ? out : out[0]);
}
