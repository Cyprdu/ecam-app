"""Agent PC : récupère les tâches du cloud, transcrit avec Whisper (GPU), génère les fiches avec Claude Code.

Lancer : .venv\\Scripts\\python agent.py        (boucle)
         .venv\\Scripts\\python agent.py --once (un seul passage)
"""
import hashlib
import html
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
CFG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
ECAM = Path(CFG["ecam_dir"])
CACHE = HERE / "cache"
MANIFEST = HERE / "sync.json"  # chemin local → id cloud (fichiers déjà synchronisés)
IGNORE = set(CFG.get("ignore", [])) | {"_APP", ".claude"}
TEXT_EXT = {".pdf", ".docx", ".pptx", ".html", ".htm"}  # texte extrait pour l'assistant
AUDIO_EXT = {".m4a", ".mp3", ".wav", ".aac"}
MOIS = ["JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE"]


def app_key():
    if os.environ.get("APP_KEY"):
        return os.environ["APP_KEY"]
    for line in (HERE.parent / "cloud" / ".dev.vars").read_text(encoding="utf-8").splitlines():
        if line.startswith("APP_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("APP_KEY introuvable")


KEY = app_key()


def log(*a):
    line = " ".join([datetime.now().strftime("%d/%m %H:%M:%S"), *map(str, a)])
    print(line, flush=True)
    with open(HERE / "agent.log", "a", encoding="utf-8") as f:  # pythonw n'a pas de console
        f.write(line + "\n")


# ---------- Cloud ----------
def call(path, method="GET", data=None, ctype=None):
    req = urllib.request.Request(CFG["cloud_url"] + "/api" + path, data=data, method=method, headers={"x-key": KEY, "user-agent": "ecam-agent"})
    if ctype:
        req.add_header("content-type", ctype)
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
        return json.loads(body) if r.headers.get("content-type", "").startswith("application/json") else body


def download(file_id, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(call(f"/files/{file_id}"))
    tmp.replace(dest)


def upload(kind, subject, uid, name, data: bytes, ctype, **extra):
    q = urllib.parse.urlencode({"kind": kind, "subject": subject, "uid": uid or "", "name": name, **extra})
    return call(f"/files?{q}", "POST", data, ctype)


# ---------- Dossiers ----------
def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def safe(s):
    return re.sub(r'[<>:"/\\|?*]', "-", s).strip(" .")


def folder_name(subject):
    if subject in CFG["folders"]:
        return CFG["folders"][subject]
    existing = {norm(p.name): p.name for p in ECAM.iterdir() if p.is_dir()}
    return existing.get(norm(subject), safe(subject.upper()))


def subject_dir(subject):
    d = ECAM / folder_name(subject)
    d.mkdir(exist_ok=True)
    return d


def session_label(uid):
    start = (uid or "").split("|")[0]  # uid = "AAAA-MM-JJTHH:MM|Matière"
    return f"COURS {start[:10]} {start[11:13]}h{start[14:16]}" if start else "SANS COURS"


def session_dir(subject, uid):
    d = subject_dir(subject) / session_label(uid)
    d.mkdir(exist_ok=True)
    return d


# ---------- Synchronisation PC <-> cloud ----------
def load_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}


def remember(path: Path, file_id):
    m = load_manifest()
    st = path.stat()
    m[path.relative_to(ECAM).as_posix()] = {"id": file_id, "mtime": st.st_mtime, "size": st.st_size}
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=0), encoding="utf-8")


def mime_of(p: Path):
    ext = p.suffix.lower()
    if ext == ".txt":
        return "text/plain; charset=utf-8"
    if ext == ".md":
        return "text/markdown; charset=utf-8"
    return mimetypes.guess_type(p.name)[0] or "application/octet-stream"


def kind_of(p: Path):
    ext = p.suffix.lower()
    if ext == ".md":
        return "fiche"
    if ext in AUDIO_EXT:
        return "audio"
    if ext == ".txt" and re.search(r"transcri|cours|lundi|mardi|mercredi|jeudi|vendredi", p.name, re.I):
        return "transcript"
    return "doc"


def find_session(subject, inner: Path, events):
    """Séance d'un fichier : dossier « COURS AAAA-MM-JJ HHhMM » ou date écrite dans le nom (« 6 octobre »)."""
    path = " ".join(inner.parts)
    m = re.search(r"COURS (\d{4}-\d{2}-\d{2}) (\d{2})h(\d{2})", path)
    if m:
        return f"{m[1]}T{m[2]}:{m[3]}|{subject}"
    for m in re.finditer(r"\b(\d{1,2}) ([A-Za-zÀ-ÿ]+)", path):
        if norm(m[2]) not in MOIS:
            continue
        month = MOIS.index(norm(m[2])) + 1
        now = datetime.now()
        year = (now.year if now.month >= 8 else now.year - 1) + (0 if month >= 8 else 1)
        day = f"{year}-{month:02d}-{int(m[1]):02d}"
        ev = next((e for e in events if e["subject"] == subject and e["start"].startswith(day)), None)
        return ev and ev["uid"]
    return None


def extract_text(p: Path):
    ext = p.suffix.lower()
    try:
        if ext == ".pdf":
            from pypdf import PdfReader

            return "\n\n".join((pg.extract_text() or "") for pg in PdfReader(p).pages)
        if ext == ".docx":
            return docx_text(p)
        if ext == ".pptx":
            z = zipfile.ZipFile(p)
            slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
            return "\n\n".join(f"--- Diapo {i + 1} ---\n" + re.sub(r"<[^>]+>", " ", z.read(n).decode("utf8").replace("</a:p>", "\n")) for i, n in enumerate(slides))
        if ext in (".html", ".htm"):
            h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", p.read_text(encoding="utf-8", errors="ignore"))
            return html.unescape(re.sub(r"<[^>]+>", " ", h))
    except Exception as e:
        log("texte non extrait :", p.name, e)
    return ""


IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def document_images(p: Path, out: Path):
    """Images contenues dans un document (ou le fichier lui-même si c'est une image), copiées dans out."""
    ext = p.suffix.lower()
    if ext in IMG_EXT:
        return [p]
    out.mkdir(parents=True, exist_ok=True)
    found = []
    try:
        if ext in (".docx", ".pptx"):
            z = zipfile.ZipFile(p)
            for n in sorted(n for n in z.namelist() if re.search(r"/media/", n) and Path(n).suffix.lower() in IMG_EXT):
                t = out / f"{len(found):02d}{Path(n).suffix.lower()}"
                t.write_bytes(z.read(n))
                found.append(t)
        elif ext == ".pdf":
            from pypdf import PdfReader

            for pg in PdfReader(p).pages:
                for im in pg.images:
                    if Path(im.name).suffix.lower() in IMG_EXT and len(im.data) > 20_000:  # pas les petits logos
                        t = out / f"{len(found):02d}{Path(im.name).suffix.lower()}"
                        t.write_bytes(im.data)
                        found.append(t)
    except Exception as e:
        log("images non extraites :", p.name, e)
    return found[:25]


def ocr_images(p: Path):
    """Claude lit les images du document et les retranscrit en texte."""
    imgs = document_images(p, CACHE / "ocr" / re.sub(r"\W+", "_", p.stem)[:60])
    if not imgs:
        return ""
    log(f"lecture des images par Claude ({len(imgs)}) :", p.name)
    prompt = f"""Ces images viennent du document « {p.name} » (cours d'un étudiant ingénieur). Lis-les toutes avec l'outil Read, dans l'ordre :
{chr(10).join('- ' + str(i) for i in imgs)}

Retranscris fidèlement tout leur contenu en texte : le texte exact, les formules, les tableaux en Markdown, et les schémas décrits en une ou deux phrases.
Indique « [Image N] » avant chaque image. Réponds UNIQUEMENT avec la transcription."""
    return claude(prompt, imgs[0].parent)


def send_text(p: Path, subject, uid, parent_id):
    text = extract_text(p) if p.suffix.lower() in TEXT_EXT else ""
    if len(text.strip()) <= 200:  # PDF scanné, Word plein de photos, image : on fait lire les images
        try:
            text = ocr_images(p) or text
        except Exception as e:
            log("lecture des images impossible :", p.name, e)
    if len(text.strip()) > 200:
        upload("text", subject, uid, p.name + ".txt", text.encode("utf-8"), "text/plain; charset=utf-8", parent=parent_id)
        return True
    return False


OCR_TRIED = HERE / "textes.json"  # documents déjà passés à la lecture (pour ne pas recommencer)


def backfill_text(state):
    """Documents déjà dans l'app mais sans texte lisible par l'assistant : on réessaie une fois (images comprises)."""
    tried = set(json.loads(OCR_TRIED.read_text())) if OCR_TRIED.exists() else set()
    by_id = {v["id"]: ECAM / rel for rel, v in load_manifest().items() if v.get("id")}
    for f in state["files"]:
        if f["kind"] != "doc" or f.get("has_text") or f["id"] in tried:
            continue
        path = by_id.get(f["id"])
        if not path or not path.exists() or path.suffix.lower() not in TEXT_EXT | IMG_EXT:
            continue
        tried.add(f["id"])
        OCR_TRIED.write_text(json.dumps(sorted(tried)))
        if send_text(path, f["subject"], f["event_uid"], f["id"]):
            log("texte ajouté pour l'assistant :", path.name)


def folder_subjects(events):
    """Dossier de matière → nom de la matière dans le calendrier."""
    out = {}
    for s in sorted({e["subject"] for e in events}):
        out.setdefault(folder_name(s), s)
    return out


def push_local(state, dry=False):
    """Envoie dans l'app les fichiers ajoutés ou modifiés sur le PC."""
    events = state.get("events") or []
    subjects = folder_subjects(events)
    man = load_manifest()
    for top in sorted(p for p in ECAM.iterdir() if p.is_dir() and p.name not in IGNORE and not p.name.startswith(".")):
        subject = subjects.get(top.name, top.name)
        for p in sorted(top.rglob("*")):
            inner = p.relative_to(top)
            if not p.is_file() or IGNORE & set(inner.parts) or p.name.startswith(("~$", ".")) or p.suffix.lower() in (".part", ".tmp"):
                continue
            st = p.stat()
            known = man.get(p.relative_to(ECAM).as_posix())
            if st.st_size == 0 or (known and known["mtime"] == st.st_mtime and known["size"] == st.st_size):
                continue
            uid = find_session(subject, inner, events)
            kind = kind_of(p)
            if dry:
                print(f"{subject[:40]:40} | {kind:10} | {(uid or '').split('|')[0]:16} | {inner.as_posix()}")
                continue
            if known and known.get("id"):
                try:
                    call(f"/files/{known['id']}", "DELETE")
                except Exception:
                    pass
            res = upload(kind, subject, uid, inner.as_posix(), p.read_bytes(), mime_of(p), created=datetime.fromtimestamp(st.st_mtime).isoformat())
            send_text(p, subject, uid, res["id"])
            remember(p, res["id"])
            log("envoyé dans l'app :", p.relative_to(ECAM))


def pull_cloud(state):
    """Copie sur le PC les documents et fiches ajoutés depuis l'app ou par Claude."""
    known = {v.get("id") for v in load_manifest().values()}
    for f in state["files"]:
        if f["kind"] not in ("doc", "fiche") or f["id"] in known:
            continue
        name = safe(f["name"].replace("/", " - "))
        if f["kind"] == "fiche":
            base = session_dir(f["subject"], f["event_uid"]) if f["event_uid"] else subject_dir(f["subject"]) / "FICHES"
            name += "" if name.lower().endswith(".md") else ".md"
        else:
            base = session_dir(f["subject"], f["event_uid"]) if f["event_uid"] else subject_dir(f["subject"]) / "DOCUMENTS"
        dest = base / name
        if dest.suffix.lower() in (".heic", ".heif"):  # photo d'iPhone : convertie en JPEG pour que Claude la lise
            dest = dest.with_suffix(".jpg")
        if not dest.exists():
            if dest.suffix == ".jpg" and Path(name).suffix.lower() in (".heic", ".heif"):
                heic = dest.with_suffix(Path(name).suffix.lower())
                download(f["id"], heic)
                from PIL import Image
                from pillow_heif import register_heif_opener

                register_heif_opener()
                Image.open(heic).convert("RGB").save(dest, "JPEG", quality=90)
                heic.unlink()
            else:
                download(f["id"], dest)
            log("copié sur le PC :", dest.relative_to(ECAM))
            if f["kind"] == "doc":
                send_text(dest, f["subject"], f["event_uid"], f["id"])
        remember(dest, f["id"])


SESSION_RE = re.compile(r"COURS \d{4}-\d{2}-\d{2} \d{2}h\d{2}|/FICHES/|/SANS COURS/")  # dossiers créés par l'agent


def relocate(state):
    """Fichier déplacé vers un autre cours dans l'app → déplacé aussi sur le PC.
    Uniquement dans les dossiers de séance créés par l'agent : tes propres dossiers ne sont jamais réorganisés."""
    by_id = {v["id"]: rel for rel, v in load_manifest().items() if v.get("id")}
    for f in state["files"]:
        rel = by_id.get(f["id"])
        if not rel or not SESSION_RE.search(rel) or not (ECAM / rel).exists():
            continue
        src = ECAM / rel
        base = ECAM / folder_name(f["subject"])
        want = base / session_label(f["event_uid"]) if f["event_uid"] else base / ("FICHES" if f["kind"] == "fiche" else "DOCUMENTS")
        if src.parent == want or (want / src.name).exists():
            continue
        want.mkdir(parents=True, exist_ok=True)
        src.rename(want / src.name)
        m = load_manifest()
        m.pop(rel, None)
        MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=0), encoding="utf-8")
        remember(want / src.name, f["id"])
        log("déplacé sur le PC :", rel, "→", (want / src.name).relative_to(ECAM))
        if not any(src.parent.iterdir()):
            src.parent.rmdir()


def push_prompt():
    p = ECAM / "PROMPT.txt"
    if p.exists() and load_manifest().get("PROMPT.txt", {}).get("mtime") != p.stat().st_mtime:
        call("/prompt", "POST", p.read_bytes(), "text/plain; charset=utf-8")
        remember(p, None)


# ---------- Transcription ----------
_model = None


def whisper():
    global _model
    if _model is None:
        # DLL CUDA fournies par les paquets pip nvidia-*
        import site

        for sp in site.getsitepackages():
            for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin"):
                p = Path(sp) / sub
                if p.exists():
                    os.add_dll_directory(str(p))
                    os.environ["PATH"] = str(p) + os.pathsep + os.environ["PATH"]
        from faster_whisper import WhisperModel

        try:
            _model = WhisperModel(CFG["whisper_model"], device="cuda", compute_type="float16")
            log("Whisper chargé sur la carte graphique")
        except Exception as e:  # pas de GPU : beaucoup plus lent mais fonctionne
            log("GPU indisponible, passage au processeur :", e)
            _model = WhisperModel(CFG["whisper_model"], device="cpu", compute_type="int8")
    return _model


def transcribe(audio: Path, subject, teacher):
    segments, info = whisper().transcribe(
        str(audio), language="fr", beam_size=5, vad_filter=True,
        initial_prompt=f"Cours de {subject} à l'ECAM{', par ' + teacher if teacher else ''}. Transcription fidèle en français.",
    )
    lines, last = [], -60
    for s in segments:
        if s.start - last >= 60:  # repère temporel toutes les minutes
            lines.append(f"\n[{int(s.start // 60):02d}:{int(s.start % 60):02d}]")
            last = s.start
        lines.append(s.text.strip())
    return " ".join(lines).strip() + "\n"


# ---------- Claude ----------
def docx_text(p: Path):
    xml = zipfile.ZipFile(p).read("word/document.xml").decode("utf8")
    xml = re.sub(r"</w:p>", "\n", xml)
    return re.sub(r"<[^>]+>", "", xml)


def readable(p: Path, root: Path):
    """Version lisible par Claude d'un fichier (les .docx sont convertis en texte dans le cache), ou None."""
    ext = p.suffix.lower()
    if ext in (".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg"):
        return p
    if ext != ".docx":
        return None
    t = CACHE / root.name / (p.relative_to(root).as_posix().replace("/", "__") + ".txt")
    t.parent.mkdir(parents=True, exist_ok=True)
    if not t.exists() or t.stat().st_mtime < p.stat().st_mtime:
        try:
            t.write_text(docx_text(p), encoding="utf-8")
        except Exception:
            return None
    return t


def readable_files(folder: Path):
    return [r for p in sorted(folder.rglob("*")) if p.is_file() and not p.name.endswith(".part") and (r := readable(p, folder))]


def readable_files_of(p: Path):
    r = readable(p, p.parent)
    return [r] if r else []


def claude(prompt, cwd: Path):
    cmd = ["claude", "-p", "--allowedTools", "Read", "Glob", "Grep", "--add-dir", str(CACHE), "--output-format", "text"]
    r = subprocess.run(cmd, input=prompt, cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=3600, shell=sys.platform == "win32")
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError((r.stderr or r.stdout or "Claude n'a rien renvoyé")[-500:])
    return r.stdout.strip()


BASE_PROMPT = (ECAM / "PROMPT.txt").read_text(encoding="utf-8") if (ECAM / "PROMPT.txt").exists() else ""
OUTPUT_RULE = "\n\nRÈGLE DE SORTIE : réponds UNIQUEMENT avec la fiche en Markdown, sans préambule ni commentaire sur ta démarche."


def file_list(paths, root):
    return "\n".join(f"- {p}" for p in paths)


def fiche_cours(subject, folder: Path, linked=()):
    session = [f for f in readable_files(folder) if f.name != "Fiche de révision.md"]
    session += [f for f in linked if f not in session]
    if not session:
        raise RuntimeError("rien à analyser pour ce cours (ni enregistrement, ni document)")
    subject_root = subject_dir(subject)
    others = [p for p in readable_files(subject_root) if folder not in p.parents and p not in session]
    prompt = f"""{BASE_PROMPT}

---
MATIÈRE : {subject}
SÉANCE : {folder.name}

Sources de CETTE séance (lis-les toutes avec l'outil Read) :
{file_list(session, folder)}

La transcription a été produite automatiquement par Whisper : elle peut contenir des mots mal reconnus.
Corrige-les d'après le contexte et les supports, sans inventer de contenu.

Pour le contexte uniquement (séances et documents précédents de la matière, à consulter si utile, sans les résumer) :
{file_list(others[:40], subject_root) or '- aucun'}
{OUTPUT_RULE}"""
    return claude(prompt, folder)


DS_PROMPT = """Tu prépares un étudiant à son prochain DS dans cette matière.
Lis toutes les sources listées (fiches, transcriptions, supports, DS blancs, annales, TD).

Produis en Markdown :
# PRÉPARATION AU DS — {subject}
1. Ce qui va très probablement tomber : classement des notions/exercices du plus probable au moins probable, avec la justification tirée des sources (insistance du prof, répétitions, annales, TD).
2. Types d'exercices et méthodes : pour chaque type, la méthode pas à pas et un exemple corrigé.
3. Formules, définitions et chiffres à connaître par cœur.
4. Pièges classiques.
5. Un DS blanc complet dans le style des annales, puis son corrigé détaillé.
6. Check-list de révision la veille.
Marque 🔥 TRÈS PROBABLE EN EXAMEN, ✅ À SAVOIR PAR CŒUR, ⚠️ PIÈGE CLASSIQUE."""


def fiche_revision(subject, mode):
    root = subject_dir(subject)
    files = readable_files(root)
    head = DS_PROMPT.format(subject=subject) if mode == "ds" else BASE_PROMPT + "\n\nIci, fusionne TOUTES les séances de la matière en une seule fiche de synthèse globale."
    prompt = f"""{head}

---
MATIÈRE : {subject}
Sources (lis-les toutes avec l'outil Read) :
{file_list(files, root)}
{OUTPUT_RULE}"""
    return claude(prompt, root)


# ---------- Annonces de DS / devoirs dans les transcriptions ----------
ANNONCES = HERE / "annonces.json"  # transcriptions déjà analysées
ANNONCE_RE = re.compile(r"\b(DS|contr[ôo]les?|examens?|partiels?|interros?|[ée]valuations?|QCM|devoirs?|rendre|pr[ée]parer|pr[ée]parez|lire|lisez|faire|faites|r[ée]viser|r[ée]visez|exercices?|prochain cours|prochaine fois|pour (lundi|mardi|mercredi|jeudi|vendredi|la semaine))\b", re.I)
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def find_announcements(text, subject, day, approx, next_sessions=()):
    d = datetime.fromisoformat(day)
    nexts = "\n".join(f"- {JOURS[datetime.fromisoformat(e['start'][:10]).weekday()]} {e['start'].replace('T', ' ')} ({e.get('type') or 'cours'})" for e in next_sessions) or "- inconnus"
    prompt = f"""Transcription automatique d'un cours de « {subject} » du {JOURS[d.weekday()]} {day}{" (date approximative)" if approx else ""}.
Prochains cours de cette matière (pour résoudre « pour le prochain cours », « pour le TD de mardi »…) :
{nexts}

Repère les consignes du professeur pour une date future :
- type "ds" : DS, contrôle, examen, partiel, interro, QCM noté ;
- type "devoir" : tout travail à faire pour un cours ou une date (préparer, lire, faire des exercices, réviser une partie, rendre un document, venir avec quelque chose…).
Il faut une échéance identifiable : une date, un jour (« jeudi »), « la semaine prochaine », « dans 15 jours », « pour le prochain cours » (= date du prochain cours ci-dessus).
Calcule la date réelle à partir de la date du cours.{" La date du cours étant approximative, ignore les échéances relatives." if approx else ""}
Ignore : les DS déjà passés, les conseils généraux sans échéance (« révisez régulièrement »), les exemples, « devoir » au sens d'obligation.
Réponds UNIQUEMENT par un tableau JSON, sans texte autour :
[{{"type": "ds" ou "devoir", "titre": "court et concret, ex. DS chapitres 1 à 3 / Faire l'exercice 4 du TD2", "date": "AAAA-MM-JJ", "heure": "HH:MM" ou null, "portee": "pour un DS : ce que le prof dit qu'il couvrira (chapitres, notions), sinon null", "citation": "phrase du prof"}}]
Tableau vide [] si rien de clair.

TRANSCRIPTION :
{text[:150000]}"""
    out = claude(prompt, HERE)
    m = re.search(r"\[.*\]", out, re.S)
    items = json.loads(m.group(0)) if m else []
    today = datetime.now().strftime("%Y-%m-%d")
    return [a for a in items if a.get("type") in ("ds", "devoir") and a.get("titre") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.get("date") or "") and a["date"] >= today]


def scan_announcements(state):
    """Ajoute aux devoirs les DS et devoirs annoncés oralement par les profs."""
    done = set(json.loads(ANNONCES.read_text())) if ANNONCES.exists() else set()
    events = state.get("events") or []
    for f in state["files"]:
        if f["kind"] != "transcript" or f["id"] in done:
            continue
        text = call(f"/files/{f['id']}").decode("utf-8", "ignore")
        found = []
        if ANNONCE_RE.search(text):
            log("recherche d'annonces de DS :", f["subject"])
            day = (f["event_uid"] or f["created"])[:10]
            nexts = [e for e in events if e["subject"] == f["subject"] and e["start"][:10] > day][:4]
            found = find_announcements(text, f["subject"], day, approx=not f["event_uid"], next_sessions=nexts)
        for a in found:
            if a["type"] == "ds" and any(e["subject"] == f["subject"] and e["start"].startswith(a["date"]) and re.match(r"(DS|Examen|Partiel|Contr)", e.get("type") or "", re.I) for e in events):
                continue  # déjà dans le calendrier ECAM
            tid = hashlib.sha1(f"{f['subject']}|{a['type']}|{a['date']}|{a['titre'] if a['type'] == 'devoir' else ''}".encode()).hexdigest()[:20]
            body = {"id": tid, "subject": f["subject"], "due": f"{a['date']}T{a.get('heure') or '08:00'}", "title": a["titre"], "kind": a["type"], "notify": True}
            if a.get("portee"):
                body["scope"] = {"texte": f"Annoncé par le prof : {a['portee']}"}
            call("/tasks", "POST", json.dumps(body).encode(), "application/json")
            log("annonce ajoutée aux devoirs :", f["subject"], "—", a["titre"], a["date"])
        done.add(f["id"])
        ANNONCES.write_text(json.dumps(sorted(done)))


# ---------- Tâches ----------
def local_path(file_id):
    """Fichier local déjà synchronisé pour cet id cloud (ou None)."""
    for rel, v in load_manifest().items():
        if v.get("id") == file_id and (ECAM / rel).exists():
            return ECAM / rel
    return None


def transcribe_audios(job, state):
    """Transcrit chaque enregistrement du cours qui ne l'est pas encore (sur le PC, ou récupère la transcription cloud)."""
    p = json.loads(job["params"] or "{}")
    subject = job["subject"]
    folder = session_dir(subject, job["event_uid"])
    for aid in p.get("audios") or ([p["audio"]] if p.get("audio") else []):  # fiche faite de documents seuls : aucun audio
        transcript = folder / f"Transcription {aid[:8]}.txt"
        if transcript.exists():
            continue
        cloud = next((f["id"] for f in state["files"] if f["kind"] == "transcript" and f.get("parent") == aid), None)
        cloud = cloud or (p.get("transcript") if aid == p.get("audio") else None)
        if cloud:
            log("transcription déjà faite par le cloud, récupération…")
            download(cloud, transcript)
            remember(transcript, cloud)
            continue
        audio = next((f for f in state["files"] if f["id"] == aid), None)
        if not audio:
            continue  # supprimé dans l'app : on ne le traite plus, même s'il en reste une copie sur le PC
        audio_path = local_path(aid) or folder / f"Enregistrement {aid[:8]}{audio_ext(audio)}"
        if not audio_path.exists():
            log("téléchargement de l'audio…")
            download(aid, audio_path)
            remember(audio_path, aid)
        log("transcription…", audio_path.name)
        t0 = time.time()
        transcript.write_text(transcribe(audio_path, subject, p.get("teacher")), encoding="utf-8")
        log(f"transcrit en {time.time() - t0:.0f} s")
        res = upload("transcript", subject, job["event_uid"], "Transcription", transcript.read_bytes(), "text/plain; charset=utf-8", parent=aid)
        remember(transcript, res["id"])
    return folder


def classify_job(job, state):
    """Enregistrement sans cours identifié : Claude lit le début de la transcription et choisit le cours."""
    p = json.loads(job["params"] or "{}")
    aid = p.get("audio")
    audio = next((f for f in state["files"] if f["id"] == aid), None)
    if not audio:
        call(f"/jobs/{job['id']}", "DELETE")
        return
    folder = transcribe_audios(job, state)
    tr = folder / f"Transcription {aid[:8]}.txt"
    text = tr.read_text(encoding="utf-8") if tr.exists() else ""
    sent = audio["created"][:10]
    since = (datetime.fromisoformat(sent) - timedelta(days=45)).strftime("%Y-%m-%d")
    cands = [e for e in state.get("events") or [] if re.match(r"(CM|TD|TP|Projet)", e.get("type") or "") and since <= e["start"][:10] <= sent][-60:]
    liste = "\n".join(f"- {e['uid']} | {JOURS[datetime.fromisoformat(e['start'][:10]).weekday()]} {e['start'].replace('T', ' ')}-{(e.get('end') or '')[11:]} | {e['subject']} | {e.get('teacher') or ''}" for e in cands)
    middle = len(text) // 2
    prompt = f"""Un étudiant a envoyé un enregistrement de cours sans indiquer de quel cours il s'agit.
Nom du fichier : « {audio['name']} » (peut contenir une matière, une date, ou rien d'utile)
Envoyé le : {audio['created'][:16].replace('T', ' ')} (l'enregistrement date de ce jour ou d'avant)

Extraits de la transcription automatique :
--- début ---
{text[:5000]}
--- milieu ---
{text[middle:middle + 2000]}

Cours possibles (identifiant | date | matière | professeur) :
{liste or '- aucun'}

Choisis le cours enregistré, d'après le sujet abordé, le vocabulaire, le nom du professeur, les dates évoquées et le nom du fichier.
Réponds UNIQUEMENT en JSON, sans texte autour : {{"uid": "identifiant exact ou null", "confiance": 0 à 100, "raison": "courte"}}
Mets null si tu n'es pas raisonnablement sûr."""
    out = claude(prompt, HERE)
    m = re.search(r"\{.*\}", out, re.S)
    ans = json.loads(m.group(0)) if m else {}
    ev = next((e for e in cands if e["uid"] == ans.get("uid")), None)
    if ev and (ans.get("confiance") or 0) >= 70:
        call(f"/files/{aid}", "PATCH", json.dumps({"subject": ev["subject"], "event_uid": ev["uid"]}).encode(), "application/json")
        log("enregistrement classé par Claude :", audio["name"], "→", ev["subject"], ev["start"], f"({ans.get('confiance')} %)", ans.get("raison", ""))
        call("/notify", "POST", json.dumps({"title": "Enregistrement classé", "body": f"{audio['name']} → {ev['subject']}, {ev['start'][8:10]}/{ev['start'][5:7]} ({ans.get('raison', '')})", "url": "/#cours/" + urllib.parse.quote(ev["uid"])}).encode(), "application/json")
    else:
        log("enregistrement non classé :", audio["name"], ans)
        call(f"/jobs/{job['id']}/failed", "POST", b"")
        call("/notify", "POST", json.dumps({"title": "À quel cours correspond cet enregistrement ?", "body": f"« {audio['name']} » : ouvre-le dans « Non classé » et touche Déplacer.", "url": "/#matiere/Non%20class%C3%A9"}).encode(), "application/json")


def fiche_ready(job):
    """Le serveur décide : cours terminé et rien de nouveau depuis 3 h, ou bouton « Faire la fiche maintenant »."""
    return bool(json.loads(job["params"] or "{}").get("ready")) or not job.get("event_uid")


def audio_ext(f):
    """Extension sûre pour le fichier audio (le nom « 9 oct. 2026 à 08:03 » n'en a pas : « . 2026… » n'en est pas une)."""
    ext = Path(f["name"]).suffix.lower()
    if ext in AUDIO_EXT:
        return ext
    return {"audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3", "audio/aac": ".aac"}.get((f.get("mime") or "").split(";")[0], ".m4a")


def course_files(job, state):
    """Documents rattachés à ce cours dans l'app, où qu'ils soient rangés sur le PC."""
    by_id = {v["id"]: ECAM / rel for rel, v in load_manifest().items() if v.get("id")}
    out = []
    for f in state["files"]:
        path = by_id.get(f["id"])
        if f.get("event_uid") == job["event_uid"] and f["kind"] in ("doc", "transcript") and path and path.exists():
            out += readable_files_of(path)
    return out


def analyse_programme(subject, state):
    """Liste des notions de la matière, dans l'ordre du cours, avec les séances où elles ont été vues."""
    by_id = {v["id"]: ECAM / rel for rel, v in load_manifest().items() if v.get("id")}
    dated = {}
    for f in state["files"]:
        path = by_id.get(f["id"])
        if f["subject"] == subject and path and path.exists() and f.get("event_uid"):
            for r in readable_files_of(path):
                dated[r] = f["event_uid"][:10]
    root = subject_dir(subject)
    files = list(dict.fromkeys([*readable_files(root), *dated]))
    sessions = sorted({e["start"][:10] for e in state.get("events") or [] if e["subject"] == subject and e["start"][:10] <= datetime.now().strftime("%Y-%m-%d")})
    liste = "\n".join(f"- {p}" + (f" (cours du {dated[p]})" if p in dated else "") for p in files)
    prompt = f"""Matière : « {subject} ». Séances déjà passées : {', '.join(sessions) or 'inconnues'}.
Voici les documents de l'étudiant (transcriptions de cours, notes, supports, fiches). Lis-les avec l'outil Read : en priorité les fiches, transcriptions et notes, puis les supports pour compléter.
{liste}

Établis la liste des NOTIONS enseignées, dans l'ordre chronologique du cours :
- 6 à 25 notions, assez précises pour qu'on puisse dire « elle est au programme du DS ou non » (ex. « Les 5 missions de l'ANSSI », pas « Cybersécurité ») ;
- pour chacune : un titre court (60 caractères max), un résumé d'une phrase, les dates des séances où elle a été vue (parmi les séances ci-dessus, d'après les dates des documents ou leur contenu), et une importance de 1 (secondaire) à 3 (essentielle).
Réponds UNIQUEMENT en JSON, sans texte autour :
[{{"titre": "...", "resume": "...", "seances": ["AAAA-MM-JJ"], "importance": 1}}]"""
    out = claude(prompt, root)
    m = re.search(r"\[.*\]", out, re.S)
    notions = [n for n in (json.loads(m.group(0)) if m else []) if n.get("titre")]
    if not notions:
        raise RuntimeError("aucune notion trouvée")
    call("/programme/save", "POST", json.dumps({"subject": subject, "notions": notions}).encode(), "application/json")
    log(f"programme de {subject} : {len(notions)} notions")


def run_job(job, state):
    """Renvoie (markdown, nom de la fiche, chemin local de la fiche), ou None pour une tâche sans fiche."""
    p = json.loads(job["params"] or "{}")
    subject = job["subject"]
    if job["type"] == "programme":
        analyse_programme(subject, state)
        return None
    if job["type"] == "cours":
        folder = transcribe_audios(job, state)
        log("génération de la fiche avec Claude…")
        md = fiche_cours(subject, folder, course_files(job, state))
        path = folder / "Fiche de révision.md"
        path.write_text(md, encoding="utf-8")
        return md, "Fiche du cours", path
    mode = p.get("mode", "synthese")
    log(f"{'prépa DS' if mode == 'ds' else 'synthèse'} de {subject} avec Claude…")
    md = fiche_revision(subject, mode)
    name = ("Prépa DS" if mode == "ds" else "Synthèse") + f" {datetime.now():%d-%m}"
    path = subject_dir(subject) / "FICHES" / f"{name}.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text(md, encoding="utf-8")
    return md, name, path


FIRST = True


def tick():
    global FIRST
    jobs = call("/jobs")
    state = call("/state")
    relocate(state)
    pull_cloud(state)
    push_local(state)
    push_prompt()
    for job in jobs:
        if job["status"] == "running" and not FIRST:
            continue  # au démarrage, on reprend aussi les tâches interrompues
        if job["type"] == "cours" and not job["event_uid"] and json.loads(job["params"] or "{}").get("classify"):
            try:
                classify_job(job, state)
            except Exception as e:
                log("ÉCHEC classement :", e)
            state = call("/state")
            continue
        if job["type"] == "cours" and not fiche_ready(job):
            try:  # tout n'est peut-être pas encore envoyé : on transcrit déjà, la fiche attendra
                transcribe_audios(job, state)
            except Exception as e:
                log("ÉCHEC transcription :", e)
            continue
        call(f"/jobs/{job['id']}/running", "POST", b"")
        try:
            out = run_job(job, state)
            if out is None:
                call(f"/jobs/{job['id']}/done?nofile=1", "POST", b"")
                continue
            md, name, path = out
            res = call(f"/jobs/{job['id']}/done?" + urllib.parse.urlencode({"name": name}), "POST", md.encode("utf-8"), "text/markdown")
            remember(path, res["file"])
            log("terminé :", job["subject"], "—", name)
        except Exception as e:
            log("ÉCHEC :", e)
            call(f"/jobs/{job['id']}/failed", "POST", b"")
        state = call("/state")
    scan_announcements(state)
    backfill_text(state)
    FIRST = False


if __name__ == "__main__":
    import socket

    _lock = socket.socket()
    try:
        _lock.bind(("127.0.0.1", 47321))  # port réservé = verrou
    except OSError:
        if "--dry-run" not in sys.argv:
            sys.exit("agent déjà lancé")
    if "--dry-run" in sys.argv:  # aperçu de ce que la synchro enverrait dans l'app
        push_local(call("/state"), dry=True)
        sys.exit()
    once = "--once" in sys.argv
    log("agent ECAM démarré →", CFG["cloud_url"])
    while True:
        try:
            tick()
        except Exception as e:  # cloud injoignable, pas d'internet… on réessaie plus tard
            log("pause :", e)
        if once:
            break
        time.sleep(60)
