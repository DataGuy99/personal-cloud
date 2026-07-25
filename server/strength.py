"""Pattern-level strength engine.

The problem this exists to solve: workout-gen keys progression on the EXERCISE
NAME (`anchorLog[name]`). Swap the anchor for a pattern -- bench -> incline DB --
and `getProgression()` sees an empty log, calls it a new lift, and the pattern's
e1RM restarts from nothing. You lose your place.

Fix: strength is a property of the PATTERN, not the exercise. Each pattern has a
latent level S (expressed in its reference lift's pounds). Every exercise maps
onto it with a coefficient k:

    e1RM(exercise) ~= k(exercise) * S(pattern)      =>      S = e1RM / k

Swapping anchors then changes only *which lens* you're measuring S through, not S
itself. k is resolved in this order, best evidence first:

  manual    you set it (always editable)
  personal  measured from YOUR data -- you logged both this lift and the pattern's
            reference lift close together, so the ratio is observed, not assumed.
            Accessories count, which is why this fires more often than you'd think.
  bridged   inferred at an anchor swap: the pattern level is continuous across the
            swap, so the first session on the new lift defines its conversion.
            This is what stops a swap from resetting you.
  default   a seeded guess from the table below. Used only when nothing better
            exists. ALWAYS reported as such -- never dressed up as measured.

Math matches workout-gen exactly (Epley w/ RIR, blended across sets, weighted
toward near-failure sets) so these numbers agree with the app instead of
competing with it. Loads are lb. Bodyweight lifts use bodyweight + added.
"""
import json, os, statistics
from datetime import datetime

_HERE = os.path.dirname(__file__)
with open(os.path.join(_HERE, "data", "exercises.json")) as f:
    _LIB = json.load(f)

MUSCLES = _LIB["MUSCLES"]
EXERCISES = {e["name"]: e for e in _LIB["EXERCISES"]}

# Head-level muscle distribution (added 2026-07-25). Generated from reps'
# src/muscleHeads.js by pre-computing headLoad() for every exercise, so this file
# holds a LOOKUP rather than a second copy of that module's EMPHASIS/DEFAULT_SPLIT
# logic. Regenerate whenever reps changes its exercise list or head splits.
#
#   HEAD_LOAD[exercise] -> {"muscle/head": involvement_pct}
#   PRIMARY_MUSCLE[exercise] -> the single highest-involvement primary muscle,
#                               which is what a UI means by an exercise's "group".
#
# Optional: absent or unreadable, head-level reporting degrades to empty and
# everything else keeps working.
try:
    with open(os.path.join(_HERE, "data", "muscle_heads.json")) as f:
        _HEADS_LIB = json.load(f)
except Exception:
    _HEADS_LIB = {}

HEADS = _HEADS_LIB.get("HEADS", {})
HEAD_LABELS = _HEADS_LIB.get("HEAD_LABELS", {})
HEAD_LOAD = _HEADS_LIB.get("head_load", {})
PRIMARY_MUSCLE = _HEADS_LIB.get("primary_muscle", {})

# verbatim from workout-gen App.jsx
PATTERNS = [
    {"id": "hpress", "label": "H. Press", "full": "Horizontal Press", "ref": "Barbell Bench Press"},
    {"id": "vpress", "label": "V. Press", "full": "Vertical Press", "ref": "Barbell Overhead Press"},
    {"id": "hpull",  "label": "H. Pull",  "full": "Horizontal Pull", "ref": "Barbell Rows"},
    {"id": "vpull",  "label": "V. Pull",  "full": "Vertical Pull",   "ref": "Pull-ups"},
    {"id": "squat",  "label": "Squat",    "full": "Squat Pattern",   "ref": "Barbell Back Squat"},
    {"id": "hinge",  "label": "Hinge",    "full": "Hip Hinge",       "ref": "Conventional Deadlift"},
]
PATTERN_MAP = {
    "hpress": ["Dumbbell Bench Press", "Incline Dumbbell Press", "Decline Dumbbell Press",
               "Dumbbell Floor Press", "Push-ups", "Dips", "Close-grip Barbell Bench",
               "Diamond Push-ups", "Barbell Bench Press", "Incline Barbell Bench Press"],
    "vpress": ["Barbell Overhead Press", "Dumbbell Arnold Press", "Landmine Press",
               "Single-arm Landmine Press", "Pike Push-ups", "Barbell Push Press"],
    "hpull":  ["Barbell Rows", "Pendlay Rows", "Dumbbell Rows",
               "Chest-supported Incline DB Rows", "Meadow Rows", "Inverted Rows"],
    "vpull":  ["Pull-ups", "Chin-ups", "Wide-grip Pull-ups", "Commando Pull-ups"],
    "squat":  ["Belt Squat", "Landmine Squat", "Dumbbell Goblet Squat",
               "Dumbbell Bulgarian Split Squat", "Dumbbell Lunges", "Dumbbell Step-ups",
               "Pistol Squats", "Barbell Back Squat", "Barbell Front Squat"],
    "hinge":  ["Barbell Romanian Deadlifts", "Dumbbell Romanian Deadlifts",
               "Single-leg DB Romanian Deadlift", "Conventional Deadlift", "Sumo Deadlift",
               "Barbell Hip Thrusts", "B-stance Hip Thrust", "Barbell Good Mornings",
               "Nordic Curls", "Landmine Romanian Deadlift"],
}
EX_PATTERN = {name: pid for pid, names in PATTERN_MAP.items() for name in names}

VOL_LANDMARKS = {
    "chest": {"mev": 8, "mav": 16, "mrv": 22}, "back": {"mev": 8, "mav": 16, "mrv": 22},
    "shoulders": {"mev": 8, "mav": 16, "mrv": 26}, "biceps": {"mev": 6, "mav": 14, "mrv": 20},
    "triceps": {"mev": 6, "mav": 12, "mrv": 18}, "quads": {"mev": 6, "mav": 14, "mrv": 20},
    "hamstrings": {"mev": 4, "mav": 10, "mrv": 16}, "glutes": {"mev": 4, "mav": 12, "mrv": 16},
    "calves": {"mev": 6, "mav": 12, "mrv": 16}, "core": {"mev": 4, "mav": 10, "mrv": 16},
    "traps": {"mev": 4, "mav": 10, "mrv": 16}, "forearms": {"mev": 2, "mav": 8, "mrv": 14},
}

# Seeds only. Ratio of this lift's e1RM to its pattern's reference lift, in TOTAL
# load -- a pair of dumbbells counts both, matching the app's impl model. Used only
# when a lift has never overlapped the reference and there's no level to bridge
# from; measurement replaces it the moment there is any.
DEFAULT_K = {
    "Barbell Bench Press": 1.00, "Incline Barbell Bench Press": 0.85,
    "Close-grip Barbell Bench": 0.90, "Dumbbell Bench Press": 0.45,
    "Incline Dumbbell Press": 0.38, "Decline Dumbbell Press": 0.47,
    "Dumbbell Floor Press": 0.42, "Dips": 1.05, "Push-ups": 0.62, "Diamond Push-ups": 0.55,
    "Barbell Overhead Press": 1.00, "Barbell Push Press": 1.20, "Dumbbell Arnold Press": 0.84,
    "Landmine Press": 0.55, "Single-arm Landmine Press": 0.35, "Pike Push-ups": 0.70,
    "Barbell Rows": 1.00, "Pendlay Rows": 0.95, "Dumbbell Rows": 0.48,
    "Chest-supported Incline DB Rows": 0.84, "Meadow Rows": 0.55, "Inverted Rows": 0.65,
    "Pull-ups": 1.00, "Chin-ups": 1.05, "Wide-grip Pull-ups": 0.95, "Commando Pull-ups": 0.92,
    "Barbell Back Squat": 1.00, "Barbell Front Squat": 0.82, "Belt Squat": 0.85,
    "Landmine Squat": 0.60, "Dumbbell Goblet Squat": 0.40,
    "Dumbbell Bulgarian Split Squat": 0.60, "Dumbbell Lunges": 0.60,
    "Dumbbell Step-ups": 0.60, "Pistol Squats": 0.45,
    "Conventional Deadlift": 1.00, "Sumo Deadlift": 1.00, "Barbell Romanian Deadlifts": 0.75,
    "Landmine Romanian Deadlift": 0.45, "Dumbbell Romanian Deadlifts": 0.80,
    "Single-leg DB Romanian Deadlift": 0.25, "Barbell Hip Thrusts": 0.90,
    "B-stance Hip Thrust": 0.60, "Barbell Good Mornings": 0.55, "Nordic Curls": 0.50,
}

PAIR_WINDOW_DAYS = 21     # how close two lifts must be logged to compare them
BRIDGE_STALE_DAYS = 90    # older than this, the pre-swap level isn't a fair anchor


def _day(iso):
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).date()


def impl_of(name, overrides=None):
    """Implements moved at once. 2 = a pair of dumbbells, one per hand."""
    if overrides and overrides.get(name) is not None:
        try:
            return int(overrides[name]) or 1
        except Exception:
            return 1
    return int((EXERCISES.get(name) or {}).get("impl") or 1)


def _load(s, bw, is_bw, name=None, impl_ov=None):
    """Total lb a set moved. The logged weight is what's on ONE implement, so a
    pair of 40s is 80 lb -- the same convention the app uses."""
    w = float(s.get("weight") or 0) * (impl_of(name, impl_ov) if name else 1)
    return (bw + w) if is_bw else w


def e1rm(sets, bodyweight=0.0, is_bw=False, name=None, impl_ov=None):
    """Epley w/ RIR, blended across sets, weighted toward near-failure.
    Exactly workout-gen's model: e = w*(1+(reps+rir)/30), weight = 1/(1+rir).
    Returns (e1rm, assumed_failure) -- the flag is set when no set carried an RIR
    and we had to treat the top set as taken to failure."""
    usable = [s for s in sets
              if (s.get("reps") or 0) > 0 and _load(s, bodyweight, is_bw, name, impl_ov) > 0]
    if not usable:
        return None, False
    with_rir = [s for s in usable if s.get("rir") is not None]
    if with_rir:
        num = den = 0.0
        for s in with_rir:
            rir = float(s["rir"])
            load = _load(s, bodyweight, is_bw, name, impl_ov)
            rtf = float(s["reps"]) + rir
            num += load * (1 + rtf / 30) * (1 / (1 + rir))
            den += 1 / (1 + rir)
        return num / den, False
    top = max(usable, key=lambda s: _load(s, bodyweight, is_bw, name, impl_ov))
    load = _load(top, bodyweight, is_bw, name, impl_ov)
    return load * (1 + float(top["reps"]) / 30), True


def observations(anchor_log, acc_log, bodyweight, impl_ov=None):
    """Every e1RM datapoint we have, from anchors AND accessories.
    Accessories matter: they're what let us MEASURE a coefficient instead of
    guessing one."""
    out = []
    for src, log in (("anchor", anchor_log or {}), ("accessory", acc_log or {})):
        for name, sessions in log.items():
            ex = EXERCISES.get(name)
            if not ex:
                continue
            is_bw = bool(ex.get("bw"))
            for sess in sessions or []:
                val, assumed = e1rm(sess.get("sets") or [], bodyweight, is_bw, name, impl_ov)
                if not val:
                    continue
                try:
                    d = _day(sess.get("date"))
                except Exception:
                    continue
                out.append({"date": d, "exercise": name, "e1rm": round(val, 1),
                            "pattern": EX_PATTERN.get(name), "source": src,
                            "assumed_failure": assumed})
    out.sort(key=lambda o: (o["date"], o["exercise"]))
    return out


def _ref_at(ref_pts, d):
    """The reference lift's e1RM on day d, linearly interpolated.

    STRICTLY inside the reference series only -- no extrapolation. That's the
    line between the two calibration modes and it matters: if you trained the
    other lift while the reference was live, the ratio is a real measurement.
    If you only started it after the reference stopped, comparing it to a stale
    number would silently fold weeks of progress into the ratio. That case isn't
    a measurement -- it's a swap, and it belongs to the bridge."""
    if len(ref_pts) < 2 or d < ref_pts[0]["date"] or d > ref_pts[-1]["date"]:
        return None
    prev = nxt = None
    for r in ref_pts:
        if r["date"] <= d:
            prev = r
        if r["date"] >= d and nxt is None:
            nxt = r
    if prev is None or nxt is None:
        return None
    if prev["date"] == nxt["date"]:
        return prev["e1rm"]
    span = (nxt["date"] - prev["date"]).days
    frac = (d - prev["date"]).days / span
    return prev["e1rm"] + (nxt["e1rm"] - prev["e1rm"]) * frac


def _personal_k(obs, pattern, ref):
    """Measure k from the user's own data -- only where the two lifts were
    genuinely trained in the same period. Accessories are the usual source: if
    you bench as your anchor and do DB bench as an accessory, we learn YOUR real
    DB:BB ratio, so swapping the anchor to DB bench later needs no guessing."""
    ref_pts = sorted([o for o in obs if o["exercise"] == ref], key=lambda o: o["date"])
    if len(ref_pts) < 2:
        return {}
    ks = {}
    for name in PATTERN_MAP[pattern]:
        if name == ref:
            continue
        ratios = []
        for o in [x for x in obs if x["exercise"] == name]:
            r = _ref_at(ref_pts, o["date"])
            if r and r > 0:
                ratios.append(o["e1rm"] / r)
        if ratios:
            # full precision on purpose: k is a divisor, and rounding it here would
            # put a small step in the level exactly at an anchor swap -- the one
            # place the series has to be continuous. Rounded only for display.
            ks[name] = {"k": statistics.median(ratios), "source": "personal",
                        "n": len(ratios), "basis": "logged alongside " + ref}
    return ks


def pattern_series(obs, pattern, overrides=None):
    """Walk the pattern's observations forward, keeping the level continuous
    across anchor swaps. Returns (series, coefficients, swaps)."""
    overrides = overrides or {}
    ref = next(p["ref"] for p in PATTERNS if p["id"] == pattern)
    pts = [o for o in obs if o["pattern"] == pattern]
    if not pts:
        return [], {}, []

    coef = {ref: {"k": 1.0, "source": "reference", "n": None}}
    for name, v in _personal_k(obs, pattern, ref).items():
        coef[name] = v

    series, swaps = [], []
    level = None          # current pattern level, in reference-lift lb
    last_ex = None

    for o in pts:
        name = o["exercise"]

        if name in overrides:
            coef[name] = {"k": float(overrides[name]), "source": "manual", "n": None}

        if name not in coef:
            # first time we've seen this lift with no measured ratio.
            if level is not None and series:
                fresh = (o["date"] - series[-1]["date"]).days <= BRIDGE_STALE_DAYS
                if fresh and o["e1rm"] > 0:
                    # the swap doesn't change how strong you are -- so the first
                    # session on the new lift IS the conversion factor.
                    coef[name] = {"k": o["e1rm"] / level, "source": "bridged",
                                  "n": 1, "bridged_from": last_ex}
            if name not in coef:
                coef[name] = {"k": DEFAULT_K.get(name, 1.0), "source": "default", "n": None}

        k = coef[name]["k"] or 1.0
        level = o["e1rm"] / k
        # only an ANCHOR changing is an anchor change. An accessory logged between
        # anchor sessions is not a swap, it's just another read of the same pattern.
        if o["source"] == "anchor":
            if last_ex and name != last_ex:
                swaps.append({"date": o["date"].isoformat(), "from": last_ex, "to": name,
                              "k": round(coef[name]["k"], 3), "how": coef[name]["source"],
                              "level_held": round(level, 1)})
            last_ex = name
        series.append({"date": o["date"], "exercise": name, "exercise_e1rm": o["e1rm"],
                       "k": k, "k_source": coef[name]["source"],
                       "level": round(level, 1), "log": o["source"],
                       "assumed_failure": o["assumed_failure"]})
    return series, coef, swaps


def _load_for(target_e1rm, reps, rir, is_bw=False, bodyweight=0.0, impl=1):
    """Invert Epley: the load that puts `reps` at `rir` for a given e1RM.
    Returns what you'd put on ONE implement (per hand), rounded to 5lb -- the same
    units you type into the app. Bodyweight lifts return ADDED weight."""
    raw = target_e1rm / (1 + (reps + rir) / 30)
    if is_bw:
        raw -= bodyweight
        if raw <= 0:
            return 0
    return int(round((raw / max(impl, 1)) / 5) * 5)


def _slope_per_week(series):
    """Least-squares lb/week on the pattern level."""
    if len(series) < 2:
        return None
    d0 = series[0]["date"]
    xs = [(s["date"] - d0).days / 7 for s in series]
    ys = [s["level"] for s in series]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den, 2)


def progression(anchor_log, acc_log, anchors, bodyweight, overrides=None, days=365,
                impl_ov=None):
    obs = observations(anchor_log, acc_log, bodyweight, impl_ov)
    if days:
        from datetime import date, timedelta
        cutoff = date.today() - timedelta(days=days)
        obs = [o for o in obs if o["date"] >= cutoff]

    out = []
    for p in PATTERNS:
        series, coef, swaps = pattern_series(obs, p["id"], overrides)
        cur = series[-1]["level"] if series else None
        d30 = d90 = None
        if series:
            last_d = series[-1]["date"]
            for win, key in ((30, "d30"), (90, "d90")):
                past = [s for s in series if (last_d - s["date"]).days >= win]
                if past:
                    base = past[-1]["level"]
                    val = round(cur - base, 1)
                    if key == "d30":
                        d30 = val
                    else:
                        d90 = val
        measured = sum(1 for s in series if s["k_source"] in ("reference", "personal", "manual"))

        # "how much do I load this lift?" -- the pattern level, expressed through
        # whichever exercise is currently the anchor.
        anchor_name = (anchors or {}).get(p["id"])
        rx = None
        if anchor_name and cur:
            ak = coef.get(anchor_name)
            if not ak:
                ak = {"k": DEFAULT_K.get(anchor_name, 1.0), "source": "default"}
            expected = cur * (ak["k"] or 1.0)
            ex_def = EXERCISES.get(anchor_name) or {}
            rx = {
                "anchor": anchor_name,
                "k": round(ak["k"], 3), "k_source": ak["source"],
                "expected_e1rm": round(expected, 1),
                "bodyweight_lift": bool(ex_def.get("bw")),
                # double-progression bottom of range at RIR 2, rounded to 5lb like the app
                "suggested_top_set": _load_for(expected, reps=6, rir=2,
                                               is_bw=bool(ex_def.get("bw")),
                                               bodyweight=bodyweight,
                                               impl=impl_of(anchor_name, impl_ov)),
                "implements": impl_of(anchor_name, impl_ov),
                "for": "6 reps @ RIR 2",
                "caveat": (None if ak["source"] in ("reference", "personal", "manual")
                           else "conversion is estimated -- treat the first session as a "
                                "calibration, not a target"),
            }

        out.append({
            "id": p["id"], "label": p["label"], "full": p["full"],
            "reference_lift": p["ref"],
            "anchor": (anchors or {}).get(p["id"]),
            "level": cur,
            "unit": f"lb of {p['ref']}",
            "change_30d": d30, "change_90d": d90,
            "slope_lb_per_week": _slope_per_week(series),
            "sessions": len(series),
            "anchor_changes": swaps,
            "coefficients": {n: {**c, "k": round(c["k"], 3)} for n, c in coef.items()},
            "confidence": ("measured" if series and measured == len(series)
                           else "partly estimated" if series else "no data"),
            "estimated_points": len(series) - measured,
            "prescription": rx,
            "series": [{"date": s["date"].isoformat(), "level": s["level"],
                        "exercise": s["exercise"], "exercise_e1rm": s["exercise_e1rm"],
                        "k": round(s["k"], 3), "k_source": s["k_source"], "log": s["log"]}
                       for s in series],
        })
    return out


def muscle_load(anchor_log, acc_log, bodyweight, days=28, impl_ov=None):
    """Two currencies, because they answer different questions:

      hard_sets   -- primary 1.0, secondary 0.5. This is what MEV/MAV/MRV are
                     defined in, so it's the one to judge weekly volume against.
      volume_load -- reps x load, split by the exercise's own muscle percentages.
                     This is the load DISTRIBUTION -- where the tonnage landed.
    """
    from datetime import date, timedelta
    cutoff = date.today() - timedelta(days=days)
    per_workout, muscles = {}, {}
    heads = {}   # "muscle/head" -> hard-set credit over the window

    for log in (anchor_log or {}, acc_log or {}):
        for name, sessions in log.items():
            ex = EXERCISES.get(name)
            if not ex:
                continue
            is_bw = bool(ex.get("bw"))
            prim = [m["m"] for m in ex.get("p", [])]
            sec = [m["m"] for m in ex.get("s", [])]
            pct = {m["m"]: m["p"] for m in ex.get("p", []) + ex.get("s", [])}
            for sess in sessions or []:
                try:
                    d = _day(sess.get("date"))
                except Exception:
                    continue
                if d < cutoff:
                    continue
                key = d.isoformat()
                w = per_workout.setdefault(key, {"date": key, "hard_sets": {},
                                                 "volume_load": {}, "exercises": []})
                hard = tonnage = 0
                for s in sess.get("sets") or []:
                    reps = s.get("reps") or 0
                    if not reps:
                        continue
                    load = _load(s, bodyweight, is_bw, name, impl_ov)
                    rir = s.get("rir")
                    # workout-gen's definition of a hard set
                    if rir is None or float(rir) <= 4:
                        hard += 1
                        for m in prim:
                            w["hard_sets"][m] = w["hard_sets"].get(m, 0) + 1.0
                            muscles.setdefault(m, {"hard_sets": 0.0, "volume_load": 0.0})
                            muscles[m]["hard_sets"] += 1.0
                        for m in sec:
                            w["hard_sets"][m] = w["hard_sets"].get(m, 0) + 0.5
                            muscles.setdefault(m, {"hard_sets": 0.0, "volume_load": 0.0})
                            muscles[m]["hard_sets"] += 0.5
                        # Head-level split of the SAME hard set. A muscle's head
                        # shares sum to its own involvement, so summing the heads of
                        # one muscle reproduces that muscle's whole-muscle credit —
                        # the two views stay consistent by construction.
                        for key, pct_of in (HEAD_LOAD.get(name) or {}).items():
                            muscle = key.split("/", 1)[0]
                            base = 1.0 if muscle in prim else 0.5 if muscle in sec else 0.0
                            if not base:
                                continue
                            whole = pct.get(muscle) or 0
                            if whole <= 0:
                                continue
                            heads[key] = heads.get(key, 0.0) + base * (pct_of / whole)
                    vol = reps * load
                    tonnage += vol
                    for m, p in pct.items():
                        share = vol * p / 100
                        w["volume_load"][m] = round(w["volume_load"].get(m, 0) + share, 1)
                        muscles.setdefault(m, {"hard_sets": 0.0, "volume_load": 0.0})
                        muscles[m]["volume_load"] += share
                if hard or tonnage:
                    w["exercises"].append({"name": name, "hard_sets": hard,
                                           "volume_load": round(tonnage, 1),
                                           "pattern": EX_PATTERN.get(name)})

    weeks = max(days / 7, 1)
    total_load = sum(m["volume_load"] for m in muscles.values()) or 1
    summary = []
    for m in MUSCLES:
        v = muscles.get(m, {"hard_sets": 0.0, "volume_load": 0.0})
        per_week = round(v["hard_sets"] / weeks, 1)
        lm = VOL_LANDMARKS.get(m, {})
        status = ("under MEV" if per_week < lm.get("mev", 0)
                  else "productive" if per_week <= lm.get("mav", 99)
                  else "high" if per_week <= lm.get("mrv", 99) else "over MRV")
        summary.append({
            "muscle": m, "hard_sets_per_week": per_week,
            "volume_load": round(v["volume_load"], 1),
            "share_pct": round(v["volume_load"] / total_load * 100, 1),
            "mev": lm.get("mev"), "mav": lm.get("mav"), "mrv": lm.get("mrv"),
            "status": status,
        })
    summary.sort(key=lambda x: -x["volume_load"])

    # Head-level breakdown: which HEAD of each muscle the work actually hit.
    # Sums per muscle back to that muscle's own hard_sets, so it refines the
    # summary above rather than telling a different story.
    head_rows = []
    for key, credit in heads.items():
        muscle, head = key.split("/", 1)
        head_rows.append({
            "muscle": muscle,
            "head": head,
            "label": (HEAD_LABELS.get(muscle) or {}).get(head, head),
            # 2dp, not 1: head figures are small fractions of a muscle's total, and
            # rounding them to 1dp made a muscle's heads visibly fail to sum back to
            # its whole-muscle number (0.2+0.1+0.1 vs 0.5).
            "hard_sets_per_week": round(credit / weeks, 2),
        })
    head_rows.sort(key=lambda h: (h["muscle"], -h["hard_sets_per_week"]))

    return {
        "window_days": days,
        "muscles": summary,
        "heads": head_rows,
        # Static lookup, included so a client can label an exercise's muscle group
        # without shipping its own copy of the exercise table.
        "primary_muscle": PRIMARY_MUSCLE,
        "workouts": sorted(per_workout.values(), key=lambda w: w["date"], reverse=True),
        "note": ("hard_sets uses primary=1.0 / secondary=0.5 -- the scheme MEV/MAV/MRV "
                 "are defined in. volume_load splits reps x load by each exercise's own "
                 "muscle percentages, so it shows where the tonnage actually landed. "
                 "heads splits that same hard-set credit across each muscle's heads, so "
                 "summing a muscle's heads reproduces its whole-muscle figure."),
    }
