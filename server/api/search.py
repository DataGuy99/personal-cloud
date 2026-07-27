"""Cross-service search.

The shell's magnifier has always been fake -- specs/nook-shell.md calls it "the
single biggest gap in the whole shell". This is the real thing.

WHAT MAKES IT AWKWARD, and why the index looks the way it does:

  1. One query is inherently ambiguous. "183" could be a logged bodyweight, grams
     of an ingredient, or a street number in a project address. A name could be a
     film, a book, a note, or an employee. So a result carries service + tab +
     item_id (the address to open), `kind` (what sort of thing it is), and a
     `subtitle` that gives a person enough context to pick.

  2. Numbers don't full-text-index themselves. A bodyweight is a REAL column;
     FTS will never match "183" against it. So the indexer EMITS numbers into the
     searchable body ("183 lb body weight"). Same for quantities buried in a KV
     blob. This is the single easiest thing to get wrong and the failure is
     silent -- numeric queries just return nothing.

  3. The data lives in two shapes. Some is in real tables (dump_items,
     body_metrics, work_sessions); the rest is inside the ported apps' opaque KV
     blobs (reps' wg2-*, meal-prep's prep_*, contract-manager's state). The
     indexer walks both.

Freshness is explicit, not trigger-based: reindex() rebuilds a user's rows on
demand. Triggers can't see inside a KV blob, so they'd silently miss most of it.
"""
import json, re, time
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("search", __name__, url_prefix="/api/search")

MAX_RESULTS = 60
MAX_BODY = 400


def _num_words(*vals):
    """Numbers as searchable words, so "183" matches a REAL column."""
    out = []
    for v in vals:
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        out.append(str(int(f)) if f == int(f) else str(f))
    return out


def _row(rows, service, tab, item_id, kind, title, subtitle, at, *body_parts):
    body = " ".join(str(p) for p in body_parts if p)[:MAX_BODY]
    rows.append((service, tab, str(item_id), kind, title or "", subtitle or "",
                 int(at or 0), body))


def _kv(conn, uid, app):
    """One ported app's KV blob as {key: parsed_json}."""
    out = {}
    for r in conn.execute("SELECT key, value FROM app_kv WHERE user_id=? AND app=?", (uid, app)):
        try:
            out[r["key"]] = json.loads(r["value"])
        except Exception:
            pass
    return out


def _collect(conn, uid):
    """Every indexable thing for one user, as tuples ready to insert."""
    rows = []

    # ── Home: the capture stream ──────────────────────────────────────────
    for r in conn.execute(
        "SELECT id, kind, content, meta, created_at FROM dump_items "
        "WHERE user_id=? ORDER BY created_at DESC LIMIT 2000", (uid,)
    ):
        text = (r["content"] or "").strip()
        if not text:
            continue
        try:
            meta = json.loads(r["meta"] or "{}")
        except Exception:
            meta = {}
        tags = " ".join(meta.get("tags") or [])
        _row(rows, "home", "stream", r["id"], r["kind"] or "note",
             text[:80], "Home", r["created_at"], text, tags)

    # ── Hours: logged work ────────────────────────────────────────────────
    for r in conn.execute(
        "SELECT id, activity, note, started_at, hourly_rate FROM work_sessions "
        "WHERE user_id=? ORDER BY started_at DESC LIMIT 1000", (uid,)
    ):
        label = (r["activity"] or "Work").strip()
        note = (r["note"] or "").strip()
        _row(rows, "hours", "today", r["id"], "work",
             label, note or "Hours", r["started_at"],
             label, note, *_num_words(r["hourly_rate"]))

    # ── Workout: body metrics. Numbers matter most here ───────────────────
    # NB the real columns are weight_kg / logged_at, and the weight is in KG.
    # Both the kg figure and its pound equivalent go into the body, because a
    # user searching their own bodyweight will type whichever unit they think in.
    for r in conn.execute(
        "SELECT id, weight_kg, body_fat_pct, note, logged_at FROM body_metrics "
        "WHERE user_id=? ORDER BY logged_at DESC LIMIT 500", (uid,)
    ):
        kg = r["weight_kg"]
        if kg is None:
            continue
        lb = round(float(kg) * 2.2046226, 1)
        nums = _num_words(kg, lb, r["body_fat_pct"])
        _row(rows, "workout", "log", r["id"], "bodyweight",
             f"{_num_words(kg)[0]} kg", "Body log", r["logged_at"],
             "body weight bodyweight", r["note"] or "", *nums)

    # ── Workout: reps' own logs, from its KV blob ─────────────────────────
    wg = _kv(conn, uid, "workout-gen")
    for name, entries in (wg.get("wg2-anchor-log") or {}).items():
        for e in (entries or [])[-12:]:
            sets = e.get("sets") or []
            weights = _num_words(*[s.get("weight") for s in sets])
            reps = _num_words(*[s.get("reps") for s in sets])
            top = max(weights, key=lambda x: float(x)) if weights else ""
            _row(rows, "workout", "log", f"{name}:{e.get('date','')}", "lift",
                 f"{name}{(' ' + top + ' lb') if top else ''}",
                 "Session · " + str(e.get("date", ""))[:10], 0,
                 name, "lift", *weights, *reps)
    for r in (wg.get("wg2-routines") or []):
        _row(rows, "workout", "workouts", r.get("id") or r.get("name"), "routine",
             r.get("name") or "Routine", "Routine", 0,
             r.get("name"), " ".join(r.get("exerciseNames") or []))

    # ── Meal Prep: recipes + their ingredients (quantities included) ──────
    mp = _kv(conn, uid, "meal-prep")
    for r in (mp.get("prep_recipes") or []):
        name = r.get("name") or "Recipe"
        ings, qtys = [], []
        for i in (r.get("ingredients") or []):
            label = i.get("itemDisplay") or i.get("item") or ""
            if label:
                ings.append(label)
            qtys += _num_words(i.get("qty"))
            if i.get("unit"):
                qtys.append(str(i["unit"]))
        _row(rows, "meal", "recipes", r.get("id") or name, "recipe",
             name, "Recipe", 0, name, " ".join(r.get("tags") or []),
             " ".join(ings), " ".join(qtys))
        # Ingredients are separately addressable: "183 g flour" should find the
        # recipe it belongs to, labelled as an ingredient rather than a dish.
        for i in (r.get("ingredients") or []):
            label = i.get("itemDisplay") or i.get("item")
            if not label:
                continue
            q = _num_words(i.get("qty"))
            qty_label = (q[0] + " " + str(i.get("unit") or "")).strip() if q else ""
            _row(rows, "meal", "recipes", f"{r.get('id') or name}:{label}", "ingredient",
                 (qty_label + " " + label).strip(), name + " · Recipes", 0,
                 label, qty_label, *q)

    for s in (mp.get("prep_shopItems") or []):
        label = s.get("itemDisplay") or s.get("name") or s.get("item")
        if not label:
            continue
        _row(rows, "meal", "shop", s.get("id") or label, "shopping",
             label, "Shopping list", 0, label, *_num_words(s.get("qty")))

    # ── Contractor: projects and crew ─────────────────────────────────────
    cm = _kv(conn, uid, "contract-manager")
    state = cm.get("state") or {}
    for p in (state.get("projects") or []):
        name = p.get("name") or "Project"
        client = p.get("client") or ""
        # Street numbers live inside the address string, so they index for free.
        _row(rows, "contractor", "home", p.get("id") or name, "project",
             name, (client + " · Projects").strip(" ·"), 0,
             name, client, p.get("site") or "", *_num_words(p.get("bid")))
    for m in (state.get("team") or []):
        if not m.get("name"):
            continue
        _row(rows, "contractor", "more", m.get("id") or m["name"], "employee",
             m["name"], "Crew", 0, m["name"], *_num_words(m.get("rate")))

    return rows


def reindex(uid):
    """Rebuild one user's index. Cheap enough to call on demand."""
    conn = db.connect()
    try:
        rows = _collect(conn, uid)
        conn.execute("DELETE FROM search_index WHERE user_id=?", (uid,))
        conn.executemany(
            "INSERT OR REPLACE INTO search_index "
            "(user_id, service, tab, item_id, kind, title, subtitle, at, body) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            [(uid,) + r for r in rows],
        )
        conn.commit()
    finally:
        conn.close()
    return len(rows)


def _fts_query(q):
    """User text -> a safe FTS5 prefix query. Quoted so punctuation can't be
    read as FTS syntax, which would 500 on input like "a-b" or "x*"."""
    terms = [t for t in re.split(r"\s+", q.strip()) if t]
    if not terms:
        return None
    return " AND ".join('"' + t.replace('"', '') + '"*' for t in terms)


@bp.get("")
@require_auth
def search():
    """?q= — - cross-service results, newest-first within relevance."""
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"query": q, "results": []})

    match = _fts_query(q)
    if not match:
        return jsonify({"query": q, "results": []})

    # Build the index on first use. Without this, search silently returns nothing
    # for a user who has never POSTed /reindex — which looks identical to "no
    # matches" and is impossible to diagnose from the UI.
    conn = db.connect()
    empty = conn.execute("SELECT 1 FROM search_index WHERE user_id=? LIMIT 1",
                         (g.user["id"],)).fetchone() is None
    conn.close()
    if empty:
        reindex(g.user["id"])

    service = request.args.get("service")
    sql = ("SELECT s.service, s.tab, s.item_id, s.kind, s.title, s.subtitle, s.at "
           "FROM search_fts f JOIN search_index s ON s.id = f.rowid "
           "WHERE search_fts MATCH ? AND s.user_id = ?")
    args = [match, g.user["id"]]
    if service:
        sql += " AND s.service = ?"
        args.append(service)
    sql += " ORDER BY bm25(search_fts), s.at DESC LIMIT ?"
    args.append(MAX_RESULTS)

    conn = db.connect()
    try:
        rows = conn.execute(sql, args).fetchall()
    except Exception:
        # A malformed FTS expression should return nothing, not a 500.
        rows = []
    finally:
        conn.close()

    return jsonify({
        "query": q,
        "results": [{
            "service": r["service"], "tab": r["tab"], "id": r["item_id"],
            "kind": r["kind"], "title": r["title"], "subtitle": r["subtitle"],
            "at": r["at"],
        } for r in rows],
    })


@bp.post("/reindex")
@require_auth
def do_reindex():
    """Rebuild this user's index. Called after a sync, or manually."""
    started = time.time()
    n = reindex(g.user["id"])
    return jsonify({"ok": True, "rows": n, "seconds": round(time.time() - started, 2)})
