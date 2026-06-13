import requests, time, hashlib, json, os, logging

VT_API_KEY = os.environ.get("VT_API_KEY", "")
VT_CACHE_FILE = "/opt/copyparty/hooks/.vt_cache.json"

def _load_cache():
    try:
        with open(VT_CACHE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_cache(cache):
    with open(VT_CACHE_FILE, "w") as f:
        json.dump(cache, f)

def virustotal_check(filepath):
    """Hash-based lookup only. Returns positives count or -1 if unknown."""
    file_hash = hashlib.sha256(open(filepath, "rb").read()).hexdigest()
    cache = _load_cache()
    if file_hash in cache:
        return cache[file_hash]

    if not VT_API_KEY:
        return {"positives": -1, "error": "No API key configured"}

    time.sleep(15)

    url = f"https://www.virustotal.com/api/v3/files/{file_hash}"
    headers = {"x-apikey": VT_API_KEY}
    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        data = response.json()
        stats = data["data"]["attributes"]["last_analysis_stats"]
        result = {
            "positives": stats.get("malicious", 0),
            "suspicious": stats.get("suspicious", 0),
            "total": sum(stats.values()),
        }
        cache[file_hash] = result
        _save_cache(cache)
        return result
    elif response.status_code == 404:
        return {"positives": -1, "error": "Hash not found (novel file)"}
    else:
        return {"positives": -1, "error": f"API error {response.status_code}"}
