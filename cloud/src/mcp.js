// Connecteur MCP pour Claude (claude.ai / app Claude) : Claude lit les cours et enregistre ses fiches dans l'app.
// Protocole : JSON-RPC 2.0 en HTTP simple (« Streamable HTTP » sans flux).
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX = 60000; // caractères renvoyés par lecture

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
      description: "Documents d'une matière : supports du prof (doc), transcriptions des cours (transcript), fiches de révision (fiche), enregistrements (audio). Donne les id à passer à lire_document.",
      inputSchema: { type: 'object', properties: { matiere: { type: 'string' } }, required: ['matiere'] },
      async run({ matiere }) {
        const s = await findSubject(matiere);
        if (!s) return `Matière inconnue. Utilise lister_matieres.`;
        const { results } = await DB.prepare("SELECT f.*, (SELECT COUNT(*) FROM files t WHERE t.parent = f.id AND t.kind = 'text') AS has_text FROM files f WHERE f.subject = ? AND f.kind != 'text' ORDER BY COALESCE(f.event_uid, ''), f.name").bind(s).all();
        const lisible = (f) => ['transcript', 'fiche'].includes(f.kind) || f.has_text || /^text\//.test(f.mime || '');
        return `Matière : ${s}\n` + results.map((f) => `- id=${f.id} · ${f.kind} · ${f.name}${f.event_uid ? ` · séance ${session(f.event_uid)}` : ''} · ${Math.round(f.size / 1024)} Ko${f.kind === 'audio' ? '' : lisible(f) ? '' : ' · (texte non disponible)'}`).join('\n');
      },
    },
    {
      name: 'lire_document',
      description: `Texte d'un document (transcription, fiche, ou texte extrait d'un PDF/Word). Renvoie ${MAX} caractères max : utilise "debut" pour lire la suite.`,
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, debut: { type: 'number', description: 'position de départ (caractères)' } }, required: ['id'] },
      async run({ id, debut = 0 }) {
        const f = await DB.prepare('SELECT * FROM files WHERE id=?').bind(id).first();
        if (!f) return 'Document introuvable.';
        const textId = ['transcript', 'fiche', 'text'].includes(f.kind) || /^text\//.test(f.mime || '') ? f.id : (await DB.prepare("SELECT id FROM files WHERE parent=? AND kind='text'").bind(id).first())?.id;
        if (!textId) return `Pas de texte disponible pour « ${f.name} » (le PC n'a pas encore extrait son contenu).`;
        const all = await (await env.FILES.get(textId))?.text();
        if (all == null) return 'Contenu introuvable.';
        const part = all.slice(debut, debut + MAX);
        const rest = all.length - debut - part.length;
        return `# ${f.name} (${f.subject}${f.event_uid ? ', séance ' + session(f.event_uid) : ''})\n\n${part}${rest > 0 ? `\n\n[… ${rest} caractères restants : rappelle lire_document avec debut=${debut + part.length}]` : ''}`;
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
        return (e.notes || []).map((n) => `${n.date} · ${n.subject} · ${n.exam} · ${n.grade} (coef ${n.weight}, moyenne classe ${n.average})`).join('\n') || 'Aucune note (compte ECAM non connecté ?).';
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
          instructions: "Accès aux cours d'un étudiant de l'ECAM : emploi du temps, transcriptions, supports, fiches, notes, devoirs. Pour une fiche : lire consignes_fiche, lister_documents, lire les documents utiles, puis enregistrer_fiche.",
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
