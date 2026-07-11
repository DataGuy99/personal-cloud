"""Numbers that must not drift. Run: python3 tests/test_strength.py"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
from datetime import date, timedelta
import strength as ST

T = date.today(); D = lambda n: (T - timedelta(days=n)).isoformat()
S = lambda d, w, r, rir: {"date": d, "sets": [{"reps": r, "weight": w, "rir": rir}] * 3}
ok = lambda c, m: (print(("  PASS " if c else "  FAIL ") + m), c)[1]
fails = []

# e1RM must match workout-gen's Epley/RIR blend exactly
v, assumed = ST.e1rm([{"reps": 8, "weight": 180, "rir": 2}])
fails.append(not ok(abs(v - 180 * (1 + 10 / 30)) < 0.01, f"Epley w/ RIR: {v:.1f} == 240.0"))
v, assumed = ST.e1rm([{"reps": 8, "weight": 180, "rir": None}])
fails.append(not ok(assumed and abs(v - 180 * (1 + 8 / 30)) < 0.01,
                    "missing RIR -> top set, flagged assumed_failure"))
v, _ = ST.e1rm([{"reps": 6, "weight": 20, "rir": 1}], bodyweight=184, is_bw=True)
fails.append(not ok(abs(v - 204 * (1 + 7 / 30)) < 0.01, "bodyweight lift adds BW to load"))

# THE POINT: an anchor swap must not reset the pattern
anchor = {"Barbell Bench Press": [S(D(56), 155, 8, 2), S(D(42), 165, 8, 2),
                                  S(D(28), 175, 8, 2), S(D(21), 180, 8, 2)],
          "Incline Dumbbell Press": [S(D(14), 65, 8, 2), S(D(7), 70, 8, 2)]}
p = [x for x in ST.progression(anchor, {}, {"hpress": "Incline Dumbbell Press"}, 184.0)
     if x["id"] == "hpress"][0]
pre = [s for s in p["series"] if s["exercise"] == "Barbell Bench Press"][-1]["level"]
post = [s for s in p["series"] if s["exercise"] == "Incline Dumbbell Press"][0]["level"]
fails.append(not ok(abs(pre - post) < 0.05, f"swap holds the level: {pre} -> {post}"))
fails.append(not ok(p["anchor_changes"][0]["how"] == "bridged", "no overlap -> bridged"))
fails.append(not ok(len(p["anchor_changes"]) == 1, "exactly one anchor change"))
fails.append(not ok(p["level"] > pre, "progress after the swap still reads as progress"))

# concurrent accessory logging -> the ratio is MEASURED, not guessed
acc = {"Incline Dumbbell Press": [S(D(52), 55, 10, 2), S(D(38), 57.5, 10, 2),
                                  S(D(24), 60, 10, 2)]}
p2 = [x for x in ST.progression(anchor, acc, {"hpress": "Incline Dumbbell Press"}, 184.0)
      if x["id"] == "hpress"][0]
fails.append(not ok(p2["anchor_changes"][0]["how"] == "personal", "overlap -> personal"))
fails.append(not ok(p2["confidence"] == "measured", "all points measured"))
kb = p["anchor_changes"][0]["k"]; kp = p2["anchor_changes"][0]["k"]
fails.append(not ok(abs(kb - kp) < 0.05, f"bridge agrees with measurement: {kb} vs {kp}"))

# a sequential lift must NOT be passed off as a measurement
obs = ST.observations(anchor, {}, 184.0)
fails.append(not ok("Incline Dumbbell Press" not in ST._personal_k(obs, "hpress", "Barbell Bench Press"),
                    "stale reference is not treated as concurrent"))

# manual override wins over everything
p3 = [x for x in ST.progression(anchor, acc, {"hpress": "Incline Dumbbell Press"}, 184.0,
                                {"Incline Dumbbell Press": 0.5}) if x["id"] == "hpress"][0]
fails.append(not ok(p3["prescription"]["k_source"] == "manual", "manual override wins"))

# muscle load: primary 1.0 / secondary 0.5, landmarks applied
m = ST.muscle_load({"Barbell Bench Press": [S(D(3), 180, 8, 2)]}, {}, 184.0, 28)
chest = [x for x in m["muscles"] if x["muscle"] == "chest"][0]
tri = [x for x in m["muscles"] if x["muscle"] == "triceps"][0]
bb = ST.EXERCISES["Barbell Bench Press"]
prim = {x["m"] for x in bb["p"]}
fails.append(not ok(("chest" in prim and chest["hard_sets_per_week"] == 0.8) or
                    ("chest" not in prim and chest["hard_sets_per_week"] == 0.4),
                    f"3 hard sets/4wk -> chest {chest['hard_sets_per_week']}/wk"))
fails.append(not ok(chest["volume_load"] > tri["volume_load"], "bench loads chest > triceps"))
fails.append(not ok(chest["status"] == "under MEV", "landmark status applied"))

print("\n" + ("ALL PASS" if not any(fails) else f"{sum(fails)} FAILED"))
sys.exit(1 if any(fails) else 0)
