"""Book metadata helpers for the Shelf library — added 2026-07-21.

Pure-ish functions the Shelf blueprint (api/shelf.py) leans on to turn a raw
file on disk into a presentable "book": a cleaned title, a best-effort author,
and a cover image. Kept separate from the blueprint so each piece is unit-
testable and the heavy libraries (PyMuPDF) stay optional.

Sources, in order of trust, per Samuel's ask ("name cleaner ... auto grab
author and ... high confidence covers from internet or pdf metadata"):
  title/author : embedded PDF/EPUB metadata  ->  cleaned filename
  cover        : embedded EPUB cover / PDF first-page render  ->  Open Library

Everything degrades gracefully: if PyMuPDF isn't installed or a file is
malformed, we still return a cleaned filename title and simply skip the cover.
"""
import os, re, zipfile, hashlib, xml.etree.ElementTree as ET

# PyMuPDF is optional. Without it we lose PDF metadata + PDF cover rendering,
# but the shelf still works from filenames + EPUB covers.
try:
    import fitz  # PyMuPDF
    _HAVE_FITZ = True
except Exception:  # pragma: no cover - env without the wheel
    _HAVE_FITZ = False

try:
    import requests
    _HAVE_REQUESTS = True
except Exception:  # pragma: no cover
    _HAVE_REQUESTS = False


BOOK_EXTS = {".pdf", ".epub", ".cbz", ".mobi", ".azw3", ".djvu", ".fb2"}

# ── filename cleaning ─────────────────────────────────────────────────────
# Junk tokens the pirate-library ecosystem staples onto filenames. Removed
# case-insensitively before we title-case what's left.
_JUNK = [
    r"z-?lib(?:rary)?(?:\.org)?", r"libgen(?:\.\w+)?", r"lib\.gen",
    r"anna'?s?[-_ ]?archive", r"pdf ?drive(?:\.com)?", r"www\.\S+",
    r"\bepub\b", r"\bpdf\b", r"\bretail\b", r"\bebook\b", r"\bmobi\b",
    r"\bocr\b", r"\bscan(?:ned)?\b", r"\bv\d+(?:\.\d+)?\b",
]
_JUNK_RE = re.compile("|".join(_JUNK), re.IGNORECASE)
# ISBN-ish digit runs and long bare numbers.
_ISBN_RE = re.compile(r"\b97[89][\d\-]{9,}\b|\b\d{9,}\b")
# Bracketed/parenthetical groups that are pure junk (source tags, ids). We keep
# meaningful parentheticals like "(2nd Edition)" — only strip groups that end up
# empty or numeric after junk removal.
_GROUP_RE = re.compile(r"[\[(]([^\])]*)[\])]")

_STOP_TITLES = {"untitled", "title", "document", "unknown", "microsoft word",
                "book", "ebook", "cover", "final", "draft"}


def _strip_groups(s: str) -> str:
    def repl(m):
        inner = _JUNK_RE.sub("", m.group(1))
        inner = _ISBN_RE.sub("", inner).strip(" -_.,")
        # keep things that still read like words (edition, year, vol); drop junk
        if not inner or inner.isdigit():
            return " "
        if re.fullmatch(r"[\d\W]+", inner):
            return " "
        return f"({inner})"
    return _GROUP_RE.sub(repl, s)


def clean_title(filename: str) -> str:
    """Turn 'the_pragmatic_programmer (z-lib.org).pdf' -> 'The Pragmatic Programmer'."""
    name = os.path.splitext(os.path.basename(filename))[0]
    # Underscores are always separators — flatten them first so word boundaries
    # exist for the ISBN/number regexes. Keep DOTS intact through junk-stripping
    # so 'z-lib.org' / 'www.pdfdrive.com' still match, then flatten dots too.
    name = name.replace("_", " ")
    name = _strip_groups(name)
    name = _JUNK_RE.sub(" ", name)
    name = _ISBN_RE.sub(" ", name)
    name = name.replace(".", " ")
    name = _ISBN_RE.sub(" ", name)                     # catch dot-separated ISBNs
    name = re.sub(r"\s*[-–—]\s*$", "", name)           # trailing dash
    name = re.sub(r"^\s*[-–—]\s*", "", name)           # leading dash
    name = re.sub(r"\s{2,}", " ", name).strip(" -_.,")
    if not name:
        return os.path.splitext(os.path.basename(filename))[0]
    # Title-case only when the source is all one case (leave MixedCase alone).
    if name.islower() or name.isupper():
        name = _smart_title(name)
    return name


def _strip_author_suffix(title: str, author: str) -> str:
    """Drop a 'Title - Author' / 'Author - Title' tail when the author is known,
    e.g. clean_title('Dune - Frank Herbert') + author 'Frank Herbert' -> 'Dune'."""
    if not (title and author):
        return title
    a = re.escape(author.strip())
    for pat in (rf"\s*[-–—:]\s*{a}\s*$", rf"^\s*{a}\s*[-–—:]\s*"):
        stripped = re.sub(pat, "", title, flags=re.IGNORECASE)
        if stripped and stripped != title:
            return stripped.strip(" -–—:")
    return title


_MINOR = {"a", "an", "and", "the", "of", "or", "in", "on", "to", "for",
          "with", "at", "by", "from", "as", "vs"}


def _smart_title(s: str) -> str:
    # Only called when the whole source is one case (all-lower or all-upper), so
    # normalising each word to Capitalised is safe — 'thinking fast and slow' and
    # 'THINKING FAST AND SLOW' both land on 'Thinking Fast and Slow'.
    words = s.split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if 0 < i < len(words) - 1 and lw in _MINOR:
            out.append(lw)
        else:
            out.append(w.capitalize() if w else w)
    return " ".join(out)


def _good_title(s) -> bool:
    if not s:
        return False
    s = str(s).strip()
    return len(s) > 2 and s.lower() not in _STOP_TITLES and not s.isdigit()


# ── embedded metadata ─────────────────────────────────────────────────────
def extract_meta(disk_path: str, ext: str):
    """Return (title, author) from embedded metadata, or (None, None)."""
    try:
        if ext == ".pdf" and _HAVE_FITZ:
            with fitz.open(disk_path) as doc:
                md = doc.metadata or {}
                t = md.get("title")
                a = md.get("author")
                return (t.strip() if _good_title(t) else None,
                        a.strip() if a and a.strip() else None)
        if ext == ".epub":
            return _epub_meta(disk_path)
    except Exception:
        pass
    return (None, None)


def _epub_meta(disk_path: str):
    with zipfile.ZipFile(disk_path) as z:
        opf = _opf_path(z)
        if not opf:
            return (None, None)
        root = ET.fromstring(z.read(opf))
        ns = {"dc": "http://purl.org/dc/elements/1.1/"}
        t = root.find(".//dc:title", ns)
        a = root.find(".//dc:creator", ns)
        title = t.text.strip() if t is not None and t.text else None
        author = a.text.strip() if a is not None and a.text else None
        return (title if _good_title(title) else None, author)


def _opf_path(z: zipfile.ZipFile):
    try:
        container = z.read("META-INF/container.xml")
        m = re.search(r'full-path="([^"]+\.opf)"', container.decode("utf-8", "ignore"))
        if m:
            return m.group(1)
    except Exception:
        pass
    for n in z.namelist():
        if n.lower().endswith(".opf"):
            return n
    return None


def resolve_title_author(disk_path: str, ext: str):
    """Best title/author: embedded metadata first, filename as the fallback."""
    t, a = extract_meta(disk_path, ext)
    if not _good_title(t):
        t = clean_title(disk_path)
        # filename titles often carry the author too — drop it once we know it
        t = _strip_author_suffix(t, a)
    return t, a


# ── covers ────────────────────────────────────────────────────────────────
def render_cover(disk_path: str, ext: str, out_path: str, max_px: int = 640) -> bool:
    """Write a cover image to out_path (a .jpg path). True on success."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        if ext == ".epub" and _epub_cover(disk_path, out_path):
            return True
        # PyMuPDF renders the first page of PDF/EPUB/CBZ/etc. to an image.
        if _HAVE_FITZ:
            with fitz.open(disk_path) as doc:
                if doc.page_count < 1:
                    return False
                page = doc.load_page(0)
                rect = page.rect
                scale = max_px / max(rect.width, rect.height or 1)
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                pix.save(out_path)  # format inferred from the .jpg extension
                return os.path.getsize(out_path) > 0
    except Exception:
        pass
    return False


def _epub_cover(disk_path: str, out_path: str) -> bool:
    """Pull the embedded cover image out of an EPUB zip and write it raw
    (Coil decodes jpg/png/webp by content, so the .jpg name is harmless)."""
    try:
        with zipfile.ZipFile(disk_path) as z:
            names = z.namelist()
            cand = next(
                (n for n in names if "cover" in n.lower()
                 and n.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))),
                None,
            )
            if not cand:
                imgs = [n for n in names if n.lower().endswith((".jpg", ".jpeg", ".png"))]
                cand = imgs[0] if imgs else None
            if not cand:
                return False
            with open(out_path, "wb") as f:
                f.write(z.read(cand))
            return os.path.getsize(out_path) > 0
    except Exception:
        return False


def fetch_online_cover(title: str, author: str, out_path: str, timeout: float = 6.0) -> bool:
    """High-confidence Open Library cover as a last resort. Best-effort."""
    if not (_HAVE_REQUESTS and title):
        return False
    try:
        params = {"title": title, "limit": 1}
        if author:
            params["author"] = author
        r = requests.get("https://openlibrary.org/search.json", params=params, timeout=timeout)
        docs = (r.json() or {}).get("docs") or []
        if not docs:
            return False
        doc = docs[0]
        # confidence gate: returned title must closely match what we asked for
        got = (doc.get("title") or "").lower()
        if not got or _similar(got, title.lower()) < 0.6:
            return False
        cid = doc.get("cover_i")
        if not cid:
            return False
        img = requests.get(f"https://covers.openlibrary.org/b/id/{cid}-L.jpg", timeout=timeout)
        if img.status_code == 200 and len(img.content) > 1500:
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(img.content)
            return True
    except Exception:
        pass
    return False


def _similar(a: str, b: str) -> float:
    """Cheap token-overlap similarity (0..1) — avoids a difflib import cost."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def book_id(vpath: str) -> str:
    return hashlib.sha1(vpath.encode("utf-8")).hexdigest()[:16]
