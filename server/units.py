"""Units — one conversion model for the whole server.

Created 2026-07-28 after an audit found there is NO unit anywhere in the stack: reps
stores whatever number the user types ("Prescriptions come back in the same units you
type, so nothing needs converting" — workout-gen/src/App.jsx:122), while body_metrics
stores a column literally named `weight_kg` and bmr_mifflin() expects kilograms.

Samuel confirmed he would have entered POUNDS. Writing an unlabelled 175 into weight_kg
computes BMR from 175 kg instead of 79 kg — about 45% too high — and every downstream
calorie figure inherits it silently. Nothing looks broken. That is why this module exists
and why storage is always normalised to a base unit.

MODEL — ported deliberately from meal-prep's src/normalizer.js rather than invented, so
the two halves of the system agree and so the hard-won rules come with it:

  * every unit is (family, factor-to-base); base units are g / ml / cm / count
  * user-defined units register into the SAME {family, factor} shape, so they slot into
    identical maths, and they may never override a built-in
  * AMBIGUOUS units are never auto-converted or merged — a "can" has no fixed size, so
    guessing is worse than asking. Offer a manual merge instead.

`length` is new here: meal-prep never needed height. Everything else mirrors it.
"""

# family, factor to base unit (mass→g, volume→ml, length→cm, count→1)
UNIT_CONV = {
    # mass
    "g":     ("mass", 1.0),
    "kg":    ("mass", 1000.0),
    "oz":    ("mass", 28.3495),
    "lb":    ("mass", 453.592),
    "lbs":   ("mass", 453.592),
    "st":    ("mass", 6350.29),        # stone
    # volume
    "ml":    ("volume", 1.0),
    "l":     ("volume", 1000.0),
    "tsp":   ("volume", 4.92892),
    "tbsp":  ("volume", 14.7868),
    "cup":   ("volume", 236.588),
    "floz":  ("volume", 29.5735),
    # length — new, for height and distance
    "cm":    ("length", 1.0),
    "m":     ("length", 100.0),
    "mm":    ("length", 0.1),
    "km":    ("length", 100000.0),
    "in":    ("length", 2.54),
    "ft":    ("length", 30.48),
    "mi":    ("length", 160934.0),
    # count
    "dozen": ("count", 12.0),
    "doz":   ("count", 12.0),
    "dz":    ("count", 12.0),
    "pair":  ("count", 2.0),
    "pairs": ("count", 2.0),
}

# Ambiguous in size — NEVER auto-convert or merge these. Carried over from meal-prep,
# where this rule was learned the hard way: a "can" of tomatoes and a "can" of soup are
# not the same amount, and silently summing them produces a wrong shopping list.
AMBIGUOUS = {
    "can", "cans", "package", "packages", "pack", "packs", "jar", "jars",
    "bunch", "bunches", "box", "boxes", "container", "containers",
    "sprig", "sprigs", "handful", "bag", "bags", "bottle", "bottles",
}

# What each family is stored as, and the two presentation systems.
BASE = {"mass": "g", "volume": "ml", "length": "cm", "count": ""}
PREFERRED = {
    "metric":   {"mass": "kg", "volume": "ml", "length": "cm"},
    "imperial": {"mass": "lb", "volume": "floz", "length": "in"},
}


def info(unit, custom=None):
    """(family, factor) for a unit, or None if unknown/ambiguous.

    `custom` is the user's own units, same {name: (family, factor)} shape. Built-ins win:
    a user may not redefine "kg" and quietly corrupt every existing row.
    """
    u = (unit or "").strip().lower()
    if not u:
        return ("count", 1.0)
    if u in UNIT_CONV:
        return UNIT_CONV[u]
    if u in AMBIGUOUS:
        return None
    if custom and u in custom:
        return custom[u]
    return None


def to_base(value, unit, custom=None):
    """Normalise to the family's base unit. Returns (value, family) or (None, None).

    Storage always calls this. A row without a known unit is never written — better to
    reject than to store an ambiguous number that looks fine forever.
    """
    got = info(unit, custom)
    if got is None or value is None:
        return (None, None)
    family, factor = got
    return (float(value) * factor, family)


def from_base(value, family, unit, custom=None):
    """Present a stored base value in `unit`. Inverse of to_base()."""
    got = info(unit, custom)
    if got is None or value is None:
        return None
    fam, factor = got
    if fam != family:
        return None                     # never convert across families
    return float(value) / factor


def display_unit(family, system="metric"):
    """The unit to show for a family under a preference ('metric' | 'imperial')."""
    return PREFERRED.get(system, PREFERRED["metric"]).get(family, BASE.get(family, ""))


def is_ambiguous(unit):
    return (unit or "").strip().lower() in AMBIGUOUS
