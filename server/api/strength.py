"""Strength API.

Reads workout-gen's own localStorage keys straight out of app_kv (the bridge
already syncs them), so no app change is needed and this keeps working after you
swap workout-gen out for a native Nook view.
"""
import json
from flask import Blueprint, request, jsonify, g
import db
import strength as ST
from api.util import require_auth

bp = Blueprint("strength", __name__, url_prefix="/api/strength")

APP = "workout-gen"
K_ANCHORS = "wg2-anchors"
K_ANCHOR_LOG = "wg2-anchor-log"
K_ACC_PROG = "wg2-acc-log_prog"
K_BODY = "wg2-body"
K_IMPL = "wg2-impl"
OVERRIDE_APP = "strength"
OVERRIDE_KEY = "coefficients"


def _kv(conn, uid, app):
    return {r["key"]: r["value"] for r in conn.execute(
        "SELECT key, value FROM app_kv WHERE user_id=? AND app=?", (uid, app)).fetchall()}


def _j(kv, key, fallback):
    try:
        return json.loads(kv[key])
    except Exception:
        return fallback


def _load_all():
    conn = db.connect()
    uid = g.user["id"]
    kv = _kv(conn, uid, APP)
    ov = _kv(conn, uid, OVERRIDE_APP)
    conn.close()
    body = _j(kv, K_BODY, [])
    bw = 0.0
    for e in reversed(body or []):
        if e.get("weight"):
            bw = float(e["weight"])
            break
    overrides = {}
    try:
        overrides = json.loads(ov.get(OVERRIDE_KEY, "{}"))
    except Exception:
        pass
    return {
        "impl_ov": _j(kv, K_IMPL, {}),
        "anchors": _j(kv, K_ANCHORS, {}),
        "anchor_log": _j(kv, K_ANCHOR_LOG, {}),
        "acc_log": _j(kv, K_ACC_PROG, {}),
        "bodyweight": bw,
        "overrides": overrides,
        "has_data": bool(kv.get(K_ANCHOR_LOG)),
    }


@bp.get("/patterns")
@require_auth
def patterns():
    """Progression per movement pattern, immune to anchor swaps."""
    days = min(int(request.args.get("days", 365)), 1825)
    d = _load_all()
    if not d["has_data"]:
        return jsonify({"error": "no workout-gen data on the server yet — open the app "
                                 "once so the bridge syncs it up", "patterns": []}), 200
    return jsonify({
        "bodyweight": d["bodyweight"],
        "unit": "lb",
        "patterns": ST.progression(d["anchor_log"], d["acc_log"], d["anchors"],
                                   d["bodyweight"], d["overrides"], days, d["impl_ov"]),
    })


@bp.get("/muscles")
@require_auth
def muscles():
    """Load distribution per muscle, and per workout."""
    days = min(int(request.args.get("days", 28)), 365)
    d = _load_all()
    if not d["has_data"]:
        return jsonify({"error": "no workout-gen data on the server yet", "muscles": []}), 200
    return jsonify(ST.muscle_load(d["anchor_log"], d["acc_log"], d["bodyweight"], days,
                                  d["impl_ov"]))


@bp.get("/coefficients")
@require_auth
def coefficients():
    """Every conversion factor in play, and where each one came from."""
    d = _load_all()
    obs = ST.observations(d["anchor_log"], d["acc_log"], d["bodyweight"], d["impl_ov"])
    out = {}
    for p in ST.PATTERNS:
        _, coef, _ = ST.pattern_series(obs, p["id"], d["overrides"])
        rows = []
        for name in ST.PATTERN_MAP[p["id"]]:
            c = coef.get(name) or {"k": ST.DEFAULT_K.get(name, 1.0), "source": "default",
                                   "n": None}
            rows.append({"exercise": name, **c, "k": round(c["k"], 3),
                         "overridden": name in d["overrides"]})
        out[p["id"]] = {"reference": p["ref"], "label": p["full"], "exercises": rows}
    return jsonify({
        "patterns": out,
        "meaning": "k = this lift's e1RM divided by the reference lift's. level = e1RM / k.",
        "sources": {
            "reference": "the pattern's unit lift, k = 1 by definition",
            "personal": "measured from your own logs — you trained both lifts in the same period",
            "bridged":  "inferred at an anchor swap by holding the pattern level continuous",
            "manual":   "you set it",
            "default":  "a seeded guess. Not measured. Override it or log the lifts together.",
        },
    })


@bp.put("/coefficients")
@require_auth
def set_coefficients():
    """Override a conversion factor. Everything here stays editable."""
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    uid = g.user["id"]
    cur = _kv(conn, uid, OVERRIDE_APP)
    try:
        overrides = json.loads(cur.get(OVERRIDE_KEY, "{}"))
    except Exception:
        overrides = {}
    for name, k in d.items():
        if name not in ST.EX_PATTERN:
            conn.close()
            return jsonify({"error": f"'{name}' isn't a pattern lift"}), 400
        if k is None:
            overrides.pop(name, None)     # clearing an override = back to measured/default
            continue
        try:
            kf = float(k)
        except Exception:
            conn.close()
            return jsonify({"error": f"k for '{name}' must be a number"}), 400
        if not (0.05 <= kf <= 3.0):
            conn.close()
            return jsonify({"error": f"k for '{name}' = {kf} is out of range (0.05–3.0)"}), 400
        overrides[name] = kf
    import time
    conn.execute(
        "INSERT INTO app_kv (user_id, app, key, value, updated_at) VALUES (?,?,?,?,?) "
        "ON CONFLICT(user_id, app, key) DO UPDATE SET value=excluded.value, "
        "updated_at=excluded.updated_at",
        (uid, OVERRIDE_APP, OVERRIDE_KEY, json.dumps(overrides), int(time.time())))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "overrides": overrides})
