"""Shared decorators for API blueprints."""
from functools import wraps
from flask import request, jsonify, g
import db


def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        user = db.session_user(request.cookies.get("pc_session", ""))
        if not user:
            return jsonify({"error": "not authenticated"}), 401
        g.user = user
        return fn(*a, **kw)
    return wrapper
