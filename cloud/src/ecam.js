// Intranet ECAM : connexion CAS (sac.ecam.fr) puis lecture des notes, du solde PaperCut et du bar.
const UA = 'Mozilla/5.0 (ECAM-app)';
const enc = new TextEncoder();

// ---------- Identifiants chiffrés (AES-GCM, clé dans le secret CRED_KEY) ----------
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aesKey = (env) => crypto.subtle.importKey('raw', unb64(env.CRED_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function saveCreds(env, username, password) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify({ username, password })));
  await env.DB.prepare("INSERT OR REPLACE INTO kv VALUES ('creds', ?)").bind(JSON.stringify({ iv: b64(iv), data: b64(data) })).run();
}

async function loadCreds(env) {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key='creds'").first();
  if (!row) return null;
  const { iv, data } = JSON.parse(row.value);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(data))));
}

// ---------- Navigation avec cookies (un pot par site) ----------
function browser() {
  const jars = new Map();
  async function req(url, opts = {}) {
    const host = new URL(url).host;
    const jar = jars.get(host) || new Map();
    jars.set(host, jar);
    const res = await fetch(url, { ...opts, redirect: 'manual', headers: { 'user-agent': UA, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...opts.headers } });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0], i = kv.indexOf('=');
      jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
    return res;
  }
  // Suit les redirections ; renvoie la page finale et son adresse
  return async function go(url, opts) {
    let res = await req(url, opts);
    for (let n = 0; res.status >= 300 && res.status < 400 && n < 12; n++) {
      url = new URL(res.headers.get('location'), url).href;
      res = await req(url);
    }
    return { url, html: await res.text(), status: res.status };
  };
}

// Ouvre une page protégée ; se connecte au CAS si besoin (une seule fois par navigateur).
async function open(go, url, creds) {
  let page = await go(url);
  if (new URL(page.url).host === 'sac.ecam.fr') {
    const execution = page.html.match(/name="execution"\s+value="([^"]+)"/)?.[1];
    if (!execution) throw new Error('Page de connexion ECAM inattendue');
    page = await go(page.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: creds.username, password: creds.password, execution, _eventId: 'submit', geolocation: '' }),
    });
    if (new URL(page.url).host === 'sac.ecam.fr') throw new Error('Identifiants ECAM refusés');
  }
  return page.html;
}

// ---------- Lecture des pages ----------
const text = (h) => h.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ');
const cells = (row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]).trim());

export function parseNotes(html) {
  const notes = [];
  for (const [row] of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const c = cells(row);
    if (c.length !== 6 || !/\/\d+/.test(c[0])) continue;
    const [grade, label, weight, average, teacher, date] = c;
    const parts = label.split(' - ');
    notes.push({ grade, subject: parts[1] || label, exam: parts.slice(2).join(' - '), label, weight, average, teacher, date: date.split('/').reverse().join('-') });
  }
  return notes;
}

export const parsePapercut = (html) => text(html).match(/Solde\s*:\s*(-?[\d.,]+)\s*€/)?.[1]?.replace(',', '.') ?? null;

export function parseBar(html) {
  // La page aligne des paires <p>libellé</p><p>valeur</p>
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => text(m[1]).trim());
  const after = (label) => { const i = ps.findIndex((p) => p.startsWith(label)); return i >= 0 ? ps[i + 1] ?? null : null; };
  const history = [];
  for (const [row] of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const c = cells(row);
    if (c.length === 3 && /^\d{4}-\d{2}-\d{2}/.test(c[0])) history.push({ date: c[0], item: c[1], price: c[2] });
  }
  return { balance: after('Solde')?.match(/-?[\d.,]+/)?.[0] ?? null, favorite: after('Boisson préférée'), history: history.slice(0, 10) };
}

// ---------- Synchronisation ----------
export async function syncEcam(env, notify) {
  const creds = await loadCreds(env);
  if (!creds) return { error: 'Identifiants ECAM non renseignés' };
  const go = browser();
  const snap = { at: new Date().toISOString() };
  try {
    snap.notes = parseNotes(await open(go, 'https://espace.ecam.fr/group/education/notes', creds));
    snap.papercut = parsePapercut(await open(go, 'https://espace.ecam.fr/group/tools/accueil', creds));
    snap.bar = parseBar(await open(go, 'https://bar.ecam.fr/', creds));
  } catch (e) {
    snap.error = String(e.message || e);
  }
  const prevRow = await env.DB.prepare("SELECT value FROM kv WHERE key='ecam'").first();
  const prev = prevRow ? JSON.parse(prevRow.value) : null;
  const merged = { ...prev, ...Object.fromEntries(Object.entries(snap).filter(([, v]) => v != null)), error: snap.error || null };
  await env.DB.prepare("INSERT OR REPLACE INTO kv VALUES ('ecam', ?)").bind(JSON.stringify(merged)).run();

  // Nouvelles notes (jamais au tout premier passage)
  if (prev?.notes && snap.notes) {
    const known = new Set(prev.notes.map((n) => n.label + n.date + n.grade));
    for (const n of snap.notes.filter((n) => !known.has(n.label + n.date + n.grade)).slice(0, 5)) {
      await notify({ title: `Nouvelle note : ${n.grade}`, body: `${n.subject} — ${n.exam}${n.average ? ` · moyenne ${n.average}` : ''}`, url: '/#notes' });
    }
  }
  return merged;
}
