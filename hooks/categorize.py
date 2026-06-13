from pathlib import Path

CATEGORY_MAP = {
    "movies":  {".mkv", ".mp4", ".avi", ".m4v", ".mov"},
    "tv":      set(),
    "music":   {".mp3", ".flac", ".ogg", ".m4a", ".wav", ".opus"},
    "photos":  {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".raw", ".cr2"},
    "docs":    {".pdf", ".docx", ".xlsx", ".txt", ".md", ".odt", ".epub"},
    "memes":   set(),
}

def categorize(filename):
    ext = Path(filename).suffix.lower()
    for cat, exts in CATEGORY_MAP.items():
        if ext in exts:
            return cat
    return "unknown"
