import os
import hashlib
from fastapi import Depends, HTTPException, Request
from pymongo import ReturnDocument

from auth import require_user
from core import db, now

# Highest first. "admin" = Super Admin. "pending" = signed in but not yet approved (no access).
ROLES = ["admin", "finance_admin", "supervisor", "pending"]
ROLE_LABELS = {"admin": "Super Admin", "finance_admin": "Finance Admin", "supervisor": "Supervisor", "pending": "Pending approval"}
DEFAULT_ROLE = "pending"
RETIRED_ROLES: dict = {}
RANK = {r: len(ROLES) - i for i, r in enumerate(ROLES)}
PERMISSIONS = {
    "admin": ["*"],
    "finance_admin": ["dashboard.view", "payments.view_all", "reconciliation.run", "exceptions.review", "exceptions.resolve_financial",
                      "reports.export", "bank.import", "fleet.view", "settlements.view", "sync.view"],
    "supervisor": ["dashboard.view", "payments.view_city", "exceptions.view_city", "exceptions.comment", "exceptions.resolve_operational",
                   "exceptions.escalate", "fleet.view"],
    "pending": [],
}

ENV = "live"
IN_ENV = {"env": {"$in": [ENV, None]}}


def effective_role(role) -> str:
    role = RETIRED_ROLES.get(role, role)
    return role if role in ROLES else DEFAULT_ROLE


async def current_member(user: dict = Depends(require_user)) -> dict:
    uid = user["user_id"]
    member = await db.users.find_one({"$or": [{"user_id": uid}, {"id": uid}]}, {"_id": 0})
    if member is None and user.get("email"):
        member = await db.users.find_one({"email": user["email"]}, {"_id": 0})
    if member is None:
        email = (user.get("email") or "").strip().lower()
        admins = {e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "support@route39.in").split(",") if e.strip()}
        role = "admin" if email in admins else DEFAULT_ROLE
        member = await db.users.find_one_and_update(
            {"user_id": uid},
            {"$setOnInsert": {"id": uid, "user_id": uid, "role": role, "email": email, "name": email.split("@")[0] or "User",
                              "cities": [], "active": True, "created_at": now()}},
            upsert=True, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if member.get("env") != ENV:
        await db.users.update_one({"$or": [{"user_id": uid}, {"id": uid}]}, {"$set": {"env": ENV}})
    if member.get("active") is False:
        raise HTTPException(status_code=403, detail="Account disabled")
    return {**member, "env": ENV, "role": effective_role(member.get("role"))}


def require_role(*roles: str):
    async def check(member: dict = Depends(current_member)) -> dict:
        if member["role"] not in roles:
            raise HTTPException(status_code=403, detail="Not allowed")
        return member
    return check


STAFF = ("admin", "finance_admin", "supervisor")
FINANCE = ("admin", "finance_admin")
SUPER = ("admin",)


def city_scope(member: dict, field: str = "city") -> dict:
    """Supervisors only see records in their assigned cities."""
    if member["role"] == "supervisor":
        return {field: {"$in": member.get("cities") or []}}
    return {}


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def require_api_client(request: Request) -> dict:
    """Service-to-service auth for EV Rent / MyVolt backends via X-API-Key."""
    raw = request.headers.get("x-api-key", "")
    if not raw:
        raise HTTPException(status_code=401, detail="Missing API key")
    client = await db.api_clients.find_one({"key_hash": hash_key(raw), "active": True}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=401, detail="Invalid API key")
    await db.api_clients.update_one({"id": client["id"]}, {"$set": {"last_used_at": now()}})
    return client
