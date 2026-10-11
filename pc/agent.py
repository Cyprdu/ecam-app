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


# ---------- Analyse UNIQUE de chaque document (texte + schémas) ----------
# Chaque document est analysé une seule fois : son texte, et la description par Claude de chacun de ses schémas
# (pages de PDF rendues en image, images des Word/PowerPoint, photos). Le résultat est gardé (par contenu du
# fichier) et envoyé dans l'app : fiches, prépas DS, quiz et assistant le réutilisent sans jamais relire le fichier.
SCANS = CACHE / "scans"
SCAN_BATCH = 6  # images par message à Claude


def clean(t):
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t ]+", " ", t or "")).strip()


def jpeg(data: bytes, max_side=1400):
    """Image réduite en JPEG (moins de tokens, format accepté partout) ; None si illisible ou minuscule."""
    from io import BytesIO

    from PIL import Image

    try:
        im = Image.open(BytesIO(data))
        if im.width * im.height < 40_000:  # icône, puce, petit logo
            return None
        im.thumbnail((max_side, max_side))
        out = BytesIO()
        im.convert("RGB").save(out, "JPEG", quality=80)
        return out.getvalue()
    except Exception:
        return None


def pdf_pages(p: Path):
    """[(libellé, texte, image ou None)] : seules les pages qui ont un vrai visuel sont rendues en image
    (les images répétées sur beaucoup de pages — fond, logo du modèle de diapo — ne comptent pas)."""
    from collections import Counter

    import pymupdf

    doc = pymupdf.open(p)
    seen = Counter(x for pg in doc for x in {i[0] for i in pg.get_images(full=True)})
    template = {x for x, n in seen.items() if len(doc) > 3 and n > len(doc) * 0.3}
    texts = [pg.get_text() for pg in doc]
    lines = Counter(ln.strip() for t in texts for ln in set(t.splitlines()) if ln.strip())
    footer = {ln for ln, n in lines.items() if len(doc) > 3 and n > len(doc) * 0.3}  # pied de page, titre répété
    out = []
    for i, pg in enumerate(doc):
        text = "\n".join(ln for ln in texts[i].splitlines() if ln.strip() not in footer)
        text = clean(re.sub(r"(?<![.:;!?])\n(?![•▪➢\-–]|\n)", " ", re.sub(r"([•▪➢–-])\s*\n", r"\1 ", text)))  # un mot par ligne → phrases
        own = [im for im in pg.get_images(full=True) if im[0] not in template and im[2] * im[3] > 40_000]
        visual = own or len(pg.get_drawings()) > 10 or (len(text) < 200 and pg.get_images())  # schéma, figure, ou page scannée
        out.append((f"Page {i + 1}", text, jpeg(pg.get_pixmap(dpi=110).tobytes("png")) if visual else None))
    return out


def embedded_images(p: Path):
    """Images d'un Word / PowerPoint, dans l'ordre."""
    z = zipfile.ZipFile(p)
    names = sorted((n for n in z.namelist() if "/media/" in n and Path(n).suffix.lower() in IMG_EXT), key=lambda n: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", n)])
    return [d for n in names if (d := jpeg(z.read(n)))][:40]


SCHEMA_PROMPT = """Images extraites du document de cours « {name} » (matière : {subject} ; cursus cybersécurité des réseaux industriels et urbains).
Pour CHAQUE image, dans l'ordre, écris « ### Image k » puis décris ce qu'elle apporte au cours, pour qu'on puisse réviser SANS la voir :
- nature du visuel (architecture réseau, modèle en couches, topologie, zones et conduits, modèle de Purdue, chronogramme, trame, tableau, capture d'écran, photo de matériel…) ;
- tous les éléments avec leurs libellés exacts (équipements, zones, niveaux, adresses, protocoles, ports, champs, valeurs) ;
- les liaisons, le sens des flux et des flèches, ce qui est filtré ou protégé, et ce que le schéma démontre ;
- un tableau en Markdown si c'est un tableau.
Ne recopie pas le texte de la page déjà fourni ci-dessous, complète-le. Si l'image est décorative (logo, page de titre, illustration sans contenu), écris seulement « (décoratif) ».
Style dense, sans phrase d'introduction.
"""


SCHEMAS = CACHE / "schemas"  # une description par image (par contenu) : un même schéma n'est jamais analysé deux fois


def schema_file(im: bytes):
    return SCHEMAS / (hashlib.sha1(im).hexdigest()[:24] + ".md")


def describe(images, name, subject):
    """images : [(libellé, texte de la page, jpeg)] → descriptions, envoyées à Claude Haiku par paquets, en un seul message chacun."""
    todo = [x for x in images if not schema_file(x[2]).exists()]  # déjà décrite (même dans un autre document) : rien à refaire
    SCHEMAS.mkdir(parents=True, exist_ok=True)
    for k in range(0, len(todo), SCAN_BATCH):
        part = todo[k:k + SCAN_BATCH]
        ctx = "\n".join(f"Image {j + 1} = {label}. Texte de la page : {text[:600] or '(aucun)'}" for j, (label, text, _) in enumerate(part))
        res = claude(SCHEMA_PROMPT.format(name=name, subject=subject) + "\n" + ctx, HERE, model="haiku", images=[im for _, _, im in part])
        found = dict(re.findall(r"###\s*Image\s*(\d+)\s*\n(.*?)(?=\n###\s*Image\s*\d+|\Z)", res, re.S))
        for j, (_, _, im) in enumerate(part):
            schema_file(im).write_text(found.get(str(j + 1), "").strip(), encoding="utf-8")
    return [schema_file(im).read_text(encoding="utf-8") for _, _, im in images]


def scan(p: Path, subject=""):
    """Contenu complet d'un document : texte + description de ses schémas. Analysé UNE fois, puis lu dans le cache."""
    ext = p.suffix.lower()
    if ext in (".txt", ".md"):
        return clean(p.read_text(encoding="utf-8", errors="ignore"))
    data = p.read_bytes()
    c = SCANS / (hashlib.sha1(data).hexdigest()[:24] + ".md")  # par contenu : un doublon ou un fichier déplacé n'est pas réanalysé
    if c.exists():
        return c.read_text(encoding="utf-8")
    if ext == ".pdf":
        parts = pdf_pages(p)
    elif ext in IMG_EXT:
        parts = [("Image", "", jpeg(data, 1800))]
    elif ext in (".docx", ".pptx"):
        parts = [("Texte", clean(extract_text(p)), None)] + [(f"Image {i + 1} du document", "", im) for i, im in enumerate(embedded_images(p))]
    else:
        parts = [("Texte", clean(extract_text(p)), None)]
    visuals = [x for x in parts if x[2]]
    if visuals:
        log(f"analyse des schémas (une seule fois) : {p.name} — {len(visuals)} image(s)")
    descs = iter(describe(visuals, p.name, subject) if visuals else [])
    blocks = []
    for label, text, im in parts:
        d = next(descs) if im else ""
        d = "" if re.fullmatch(r"\(?décoratif\)?\.?", d, re.I) else d
        if text or d:
            blocks.append(f"--- {label} ---\n{text}" + (f"\n[Schéma] {d}" if d else ""))
    result = "\n\n".join(blocks)
    SCANS.mkdir(parents=True, exist_ok=True)
    c.write_text(result, encoding="utf-8")
    return result


def send_text(p: Path, subject, uid, parent_id):
    """Envoie dans l'app le contenu analysé du document, et son résumé s'il est long (l'assistant lit le résumé)."""
    text = scan(p, subject)
    if len(text) <= 200:
        return False
    upload("text", subject, uid, p.name + ".txt", text.encode("utf-8"), "text/plain; charset=utf-8", parent=parent_id)
    if len(text) > DIGEST_MIN:
        upload("text", subject, uid, "Résumé", digest(p, subject).encode("utf-8"), "text/plain; charset=utf-8", parent=parent_id)
    return True


SCANNED = HERE / "analyses.json"  # documents déjà analysés et envoyés dans l'app


def backfill_docs(state, n=2):
    """Documents déjà dans l'app : analyse unique (schémas compris) + résumé, quelques-uns par minute pour étaler."""
    done = set(json.loads(SCANNED.read_text())) if SCANNED.exists() else set()
    by_id = {v["id"]: ECAM / rel for rel, v in load_manifest().items() if v.get("id")}
    for f in state["files"]:
        path = by_id.get(f["id"])
        if n <= 0 or f["kind"] not in ("doc", "transcript") or f["id"] in done or not path or not path.exists():
            continue
        try:
            if f["kind"] == "doc" and readable(path):
                send_text(path, f["subject"], f["event_uid"], f["id"])
                n -= 1
            elif f["kind"] == "transcript" and len(scan(path)) > DIGEST_MIN:
                upload("text", f["subject"], f["event_uid"], "Résumé", digest(path, f["subject"]).encode("utf-8"), "text/plain; charset=utf-8", parent=f["id"])
                n -= 1
        except RuntimeError as e:  # Claude indisponible (limite atteinte…) : on réessaiera plus tard
            log("analyse reportée :", path.name, e)
            return
        except Exception as e:  # fichier abîmé : inutile de réessayer
            log("analyse impossible :", path.name, e)
        done.add(f["id"])
        SCANNED.write_text(json.dumps(sorted(done)))


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


READABLE = {".pdf", ".txt", ".md", ".docx", ".pptx", ".html", ".htm"} | IMG_EXT


def readable(p: Path, root: Path = None):
    """Le fichier s'il peut servir de source (texte, PDF, Word, PowerPoint, image), sinon None."""
    return p if p.suffix.lower() in READABLE and not p.name.endswith(".part") else None


def readable_files(folder: Path):
    return [p for p in sorted(folder.rglob("*")) if p.is_file() and readable(p)]


def readable_files_of(p: Path):
    return [p] if readable(p) else []


SYSTEM = "Assistant de revision d'un etudiant ingenieur (ECAM Lyon). Reponds en francais, avec rigueur, sans rien inventer."  # sans accents : passe par la ligne de commande Windows


def claude(prompt, cwd: Path, model="sonnet", images=()):
    """Un seul échange avec Claude, sans le contexte de Claude Code (≈ 3 000 tokens fixes au lieu de ≈ 40 000) :
    les sources sont collées dans le message, les images (JPEG) jointes au même message."""
    cmd = ["claude", "-p", "--model", model, "--system-prompt", SYSTEM, "--strict-mcp-config", "--no-session-persistence", "--tools", ""]
    if images:
        import base64

        content = [{"type": "text", "text": prompt}] + [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(im).decode()}} for im in images]
        cmd += ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
        prompt = json.dumps({"type": "user", "message": {"role": "user", "content": content}}) + "\n"
    else:
        cmd += ["--output-format", "text"]
    r = subprocess.run(cmd, input=prompt, cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=3600, shell=sys.platform == "win32")
    out = r.stdout
    if images:
        res = [json.loads(line) for line in out.splitlines() if line.startswith("{") and '"type":"result"' in line]
        out = res[-1].get("result", "") if res and not res[-1].get("is_error") else ""
    if r.returncode != 0 or not out.strip():
        raise RuntimeError((r.stderr or r.stdout or "Claude n'a rien renvoyé")[-500:])
    return out.strip()


BASE_PROMPT = (ECAM / "PROMPT.txt").read_text(encoding="utf-8") if (ECAM / "PROMPT.txt").exists() else ""
OUTPUT_RULE = "\n\nRÈGLE DE SORTIE : réponds UNIQUEMENT avec la fiche en Markdown, sans préambule ni commentaire sur ta démarche."
SCHEMA_RULE = """
Les lignes « [Schéma] » décrivent les images des supports (architectures, modèles en couches, zones, trames…) : ce sont des informations de cours à part entière.
Reprends dans la fiche chaque schéma important, reconstruit en texte (tableau, liste hiérarchique, ou schéma dans un bloc de code), avec ce qu'il faut en retenir."""


# ---------- Résumés (faits une fois, à partir de l'analyse unique du document) ----------
DIGEST_MIN = 6000  # en dessous, le contenu complet sert de résumé
DIGEST_PROMPT = """Résume ce document de cours (« {name} », matière {subject}) pour qu'il serve ensuite de source à une fiche de révision.
Garde TOUT ce qui peut tomber en examen, en style télégraphique : plan, définitions exactes, formules (avec unités), chiffres, dates, méthodes pas à pas, exemples et exercices types, points sur lesquels le prof insiste.
Garde aussi chaque schéma important (lignes « [Schéma] ») : ses éléments, leurs liens et ce qu'il montre, en quelques lignes.
Supprime le reste (bavardages, répétitions, logistique, images décoratives). 500 à 1200 mots. Réponds UNIQUEMENT avec le résumé en Markdown.

DOCUMENT :
"""


def digest(p: Path, subject=""):
    """Résumé dense d'un long document, fait une seule fois par Claude Haiku puis gardé en cache."""
    t = scan(p, subject)
    if len(t) <= DIGEST_MIN:
        return t
    c = CACHE / "resumes" / ("v2-" + hashlib.sha1(t.encode()).hexdigest()[:20] + ".md")
    if not c.exists():
        log("résumé (une seule fois) :", p.name)
        c.parent.mkdir(parents=True, exist_ok=True)
        c.write_text(claude(DIGEST_PROMPT.format(name=p.name, subject=subject) + t[:60000], HERE, model="haiku"), encoding="utf-8")
    return c.read_text(encoding="utf-8")


def bundle(items, budget):
    """Colle les sources (titre, texte) dans le prompt, dans l'ordre, jusqu'au budget de caractères."""
    out = []
    for title, text in items:
        if text and budget > 500:
            out.append(f"=== {title} ===\n{text[:budget]}")
            budget -= len(out[-1])
    return "\n\n".join(out) or "(aucune source lisible)"


def fiche_cours(subject, folder: Path, linked=()):
    session = [f for f in readable_files(folder) if f.name != "Fiche de révision.md"]
    session += [f for f in linked if f not in session]
    if not session:
        raise RuntimeError("rien à analyser pour ce cours (ni enregistrement, ni document)")
    items = []
    for f in sorted(session, key=lambda f: not f.name.startswith("Transcription")):  # la transcription d'abord
        t = scan(f, subject)  # déjà analysé à l'arrivée du document : lu dans le cache
        items.append((f.name, t if len(t) <= 40000 or f.name.startswith("Transcription") else digest(f, subject)))
    prompt = f"""{BASE_PROMPT}

---
MATIÈRE : {subject}
SÉANCE : {folder.name}

La transcription a été produite automatiquement par Whisper : elle peut contenir des mots mal reconnus.
Corrige-les d'après le contexte et les supports, sans inventer de contenu.
{SCHEMA_RULE}
{OUTPUT_RULE}

SOURCES DE CETTE SÉANCE :
{bundle(items, 200000)}"""
    return claude(prompt, HERE)


def session_day(p: Path):
    m = re.search(r"COURS (\d{4}-\d{2}-\d{2})", p.as_posix())
    return m and m.group(1)


def subject_sources(subject, days=None):
    """La matière en compact : fiches des cours en entier, puis résumé des autres documents
    (une transcription déjà couverte par la fiche de son cours est ignorée).
    days : seulement ces séances (+ les documents hors séance : TD, annales, supports)."""
    files = [f for f in readable_files(subject_dir(subject)) if not re.match(r"(Synthèse|Prépa DS) ", f.name)]
    if days is not None:
        files = [f for f in files if not session_day(f) or session_day(f) in days]
    covered = {f.parent for f in files if f.name == "Fiche de révision.md"}
    fiches = [(f"Fiche du cours {f.parent.name}", scan(f)) for f in files if f.name == "Fiche de révision.md"]
    others = [(f"{f.parent.name} / {f.name}", digest(f, subject)) for f in files if f.name != "Fiche de révision.md" and not (f.parent in covered and f.name.startswith("Transcription"))]
    return fiches + others


# ---------- Prépa DS : chaque notion au programme traitée, rien de plus ----------
def ds_scope(subject, state):
    """(notions au programme du prochain DS, précision du prof) : les notions cochées dans l'app, sinon tout le programme."""
    notions = ((state.get("programmes") or {}).get(subject) or {}).get("notions") or []
    today = datetime.now().strftime("%Y-%m-%d")
    tasks = sorted((t for t in state.get("tasks") or [] if t["subject"] == subject and not t["done"] and t["due"][:10] >= today and t.get("scope")), key=lambda t: t["due"])
    scope = json.loads(tasks[0]["scope"]) if tasks else {}
    chosen = [n for n in notions if n["titre"] in (scope.get("notions") or [])] or notions
    return chosen, scope.get("texte")


DS_PROMPT = """Tu prépares un étudiant à son prochain DS de « {subject} ».
Appuie-toi sur les sources ci-dessous (fiches des cours, résumés des transcriptions et des supports, TD, annales).

Produis en Markdown :
# PRÉPARATION AU DS — {subject}
## Ce qui va tomber
Classement des notions du plus probable au moins probable, justifié par les sources (insistance du prof, répétitions, TD, annales).
{notions_part}
## À savoir par cœur
Formules, définitions, chiffres, acronymes, en tableau.
## DS blanc
Un DS blanc dans le style des annales et des TD, puis son corrigé détaillé.
## Check-list de la veille
Marque 🔥 TRÈS PROBABLE EN EXAMEN, ✅ À SAVOIR PAR CŒUR, ⚠️ PIÈGE CLASSIQUE."""

NOTION_PART = """Puis UNE section par notion au programme, TOUTES, dans cet ordre, sans en sauter ni en fusionner aucune :
{liste}
Chaque section a pour titre exact « ## Notion N — titre » et contient : l'essentiel à comprendre, les définitions et formules exactes, le ou les schémas clés reconstruits en texte et expliqués, la méthode pas à pas avec un exemple corrigé, les pièges, et 2 questions types de DS avec leur réponse."""


def notion_list(notions, start=1):
    return "\n".join(f"{start + i}. {n['titre']}" + (f" — {n['resume']}" if n.get("resume") else "") + (f" (séances {', '.join(n['seances'])})" if n.get("seances") else "") for i, n in enumerate(notions))


def fiche_ds(subject, state):
    notions, texte = ds_scope(subject, state)
    days = None if not notions or any(not n.get("seances") for n in notions) else {d for n in notions for d in n["seances"]}
    head = DS_PROMPT.format(subject=subject, notions_part=NOTION_PART.format(liste=notion_list(notions)) if notions else "## Notions\nUne section par notion du cours, avec méthode, exemple corrigé, schémas clés et pièges.")
    if texte:
        head += f"\n\nPÉRIMÈTRE ANNONCÉ : {texte}"
    sources = bundle(subject_sources(subject, days), 220000)
    md = claude(f"{head}\n{SCHEMA_RULE}\n{OUTPUT_RULE}\n\nSOURCES :\n{sources}", HERE)
    # Vérification : chaque notion a sa section ; sinon un complément, seulement pour celles qui manquent
    found = {int(k) for k in re.findall(r"^##\s*Notion\s*(\d+)", md, re.M)}
    missing = [(i + 1, n) for i, n in enumerate(notions) if i + 1 not in found]
    if missing:
        log(f"prépa DS : {len(missing)} notion(s) manquante(s), complément…")
        days = {d for _, n in missing for d in n.get("seances") or []} or None
        extra = claude(f"""Complète la préparation au DS de « {subject} » : écris UNIQUEMENT les sections des notions suivantes, avec le titre exact « ## Notion N — titre » :
{chr(10).join(f"{i}. {n['titre']}" + (f" — {n['resume']}" if n.get('resume') else '') for i, n in missing)}
Chaque section : l'essentiel, définitions et formules exactes, schémas clés reconstruits en texte, méthode avec exemple corrigé, pièges, 2 questions types avec réponse.
{SCHEMA_RULE}
{OUTPUT_RULE}

SOURCES :
{bundle(subject_sources(subject, days), 120000)}""", HERE)
        at = md.find("\n## À savoir par cœur")  # avec les autres notions, avant la fin de la fiche
        md = md[:at] + "\n\n" + extra + "\n" + md[at:] if at >= 0 else md + "\n\n" + extra
    return md


def fiche_revision(subject, mode, state):
    if mode == "ds":
        return fiche_ds(subject, state)
    prompt = f"""{BASE_PROMPT}

Ici, fusionne TOUTES les séances de la matière en une seule fiche de synthèse globale.
{SCHEMA_RULE}

---
MATIÈRE : {subject}
{OUTPUT_RULE}

SOURCES :
{bundle(subject_sources(subject), 220000)}"""
    return claude(prompt, HERE)


# ---------- Annonces de DS / devoirs dans les transcriptions ----------
ANNONCES = HERE / "annonces.json"  # transcriptions déjà analysées
ANNONCE_RE = re.compile(r"\b(DS|contr[ôo]les?|examens?|partiels?|interros?|[ée]valuations?|QCM|devoirs?|rendre|pr[ée]parer|pr[ée]parez|lire|lisez|faire|faites|r[ée]viser|r[ée]visez|exercices?|prochain cours|prochaine fois|pour (lundi|mardi|mercredi|jeudi|vendredi|la semaine))\b", re.I)
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def passages(text, rx, around=600):
    """Seulement les passages autour des mots qui comptent (fusionnés s'ils se chevauchent)."""
    spans = []
    for m in rx.finditer(text):
        a, b = max(0, m.start() - around), m.end() + around
        if spans and a <= spans[-1][1]:
            spans[-1][1] = b
        else:
            spans.append([a, b])
    return "\n[…]\n".join(text[a:b] for a, b in spans)


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

PASSAGES DE LA TRANSCRIPTION (seuls ceux qui parlent de travail, de DS ou d'échéances) :
{passages(text, ANNONCE_RE)[:40000]}"""
    out = claude(prompt, HERE, model="haiku")
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
    dated = "\n".join(f"- {f['name']} : cours du {f['event_uid'][:10]}" for f in state["files"] if f["subject"] == subject and f.get("event_uid") and f["kind"] in ("doc", "transcript"))
    sessions = sorted({e["start"][:10] for e in state.get("events") or [] if e["subject"] == subject and e["start"][:10] <= datetime.now().strftime("%Y-%m-%d")})
    prompt = f"""Matière : « {subject} ». Séances déjà passées : {', '.join(sessions) or 'inconnues'}.
Dates des documents rattachés à un cours :
{dated or '- aucune'}

Établis la liste des NOTIONS enseignées, dans l'ordre chronologique du cours :
- 6 à 25 notions, assez précises pour qu'on puisse dire « elle est au programme du DS ou non » (ex. « Les 5 missions de l'ANSSI », pas « Cybersécurité ») ;
- pour chacune : un titre court (60 caractères max), un résumé d'une phrase, les dates des séances où elle a été vue (parmi les séances ci-dessus, d'après les dates des documents ou leur contenu), et une importance de 1 (secondaire) à 3 (essentielle).
Réponds UNIQUEMENT en JSON, sans texte autour :
[{{"titre": "...", "resume": "...", "seances": ["AAAA-MM-JJ"], "importance": 1}}]

DOCUMENTS DE L'ÉTUDIANT (fiches des cours, puis résumés des transcriptions, notes et supports) :
{bundle(subject_sources(subject), 150000)}"""
    out = claude(prompt, HERE)
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
    md = fiche_revision(subject, mode, state)
    name = ("Prépa DS" if mode == "ds" else "Synthèse") + f" {datetime.now():%d-%m}"
    path = subject_dir(subject) / "FICHES" / f"{name}.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text(md, encoding="utf-8")
    return md, name, path


FIRST = True


TICKS = 0


def tick():
    global FIRST, TICKS
    jobs = call("/jobs")
    TICKS += 1
    if not jobs and not FIRST and TICKS % 5:
        return  # ponytail: synchro complète toutes les 5 min quand rien n'attend (quota gratuit de lectures D1) ; les tâches restent vues chaque minute
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
    backfill_docs(state)  # analyse unique des nouveaux documents (texte + schémas) et résumé
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
