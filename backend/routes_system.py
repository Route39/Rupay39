import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now, new_id, clean, paginate, audit, get_settings, encrypt, CITIES
from rbac import require_role, ROLES, ROLE_LABELS, RANK, IN_ENV, PERMISSIONS, effective_role, hash_key, SUPER, FINANCE
from providers import REGISTRY
import sync

router = APIRouter(prefix="/api")


@router.get("/public/branding")
async def branding():
    s = await get_settings()
    return {k: s[k] for k in ("brand_name", "brand_tagline", "logo_url")}


# ---------- Users / roles ----------
@router.get("/users")
async def list_users(admin: dict = Depends(require_role(*SUPER))):
    people = await db.users.find(IN_ENV, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"roles": [{"code": r, "label": ROLE_LABELS[r]} for r in ROLES if RANK[r] <= RANK[admin["role"]]],
            "cities": CITIES, "users": clean([{**p, "role": effective_role(p.get("role"))} for p in people])}


class UserUpdate(BaseModel):
    role: str | None = None
    cities: list[str] | None = None
    active: bool | None = None


@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdate, admin: dict = Depends(require_role(*SUPER))):
    target = await db.users.find_one({"user_id": user_id, **IN_ENV}, {"_id": 0})
    if target is None:
        raise HTTPException(404, "Not found")
    upd = {}
    if body.role is not None:
        if body.role not in ROLES or RANK[body.role] > RANK[admin["role"]]:
            raise HTTPException(403, "Not allowed")
        if (effective_role(target.get("role")) == "admin" and body.role != "admin"
                and await db.users.count_documents({"role": "admin", **IN_ENV}) <= 1):
            raise HTTPException(409, "Keep at least one Super Admin")
        upd["role"] = body.role
    if body.cities is not None:
        upd["cities"] = [c for c in body.cities if c in CITIES]
    if body.active is not None:
        if user_id == admin["user_id"] and not body.active:
            raise HTTPException(409, "You cannot disable yourself")
        upd["active"] = body.active
    await db.users.update_one({"user_id": user_id}, {"$set": upd})
    await audit(admin, "USER_UPDATED", "user", user_id, target.get("role"), upd.get("role"), meta={k: v for k, v in upd.items()})
    return {"user_id": user_id, **upd}


@router.get("/roles")
async def roles(member: dict = Depends(require_role(*FINANCE))):
    return [{"code": r, "label": ROLE_LABELS[r], "permissions": PERMISSIONS[r]} for r in ROLES]


# ---------- Providers ----------
@router.get("/providers")
async def providers(member: dict = Depends(require_role(*FINANCE))):
    cfgs = {c["code"]: c for c in await db.payment_provider_config.find({}, {"_id": 0}).to_list(50)}
    settings = await get_settings()
    out = []
    for code, p in REGISTRY.items():
        c = cfgs.get(code, {})
        out.append({"code": code, "name": p.name, "methods": p.methods, "is_simulated": p.is_simulated, "supports_callbacks": p.supports_callbacks,
                    "enabled": c.get("enabled", False), "mode": c.get("mode"), "status": c.get("status"), "notes": c.get("notes"),
                    "is_primary": settings["primary_provider"] == code,
                    "credential_fields": sorted((c.get("credentials_encrypted") or {}).keys()),
                    "env_configured": getattr(p, "configured", lambda: None)(), "webhook_path": f"/api/webhooks/{code}"})
    return out


class ProviderUpdate(BaseModel):
    enabled: bool | None = None
    is_primary: bool | None = None
    notes: str | None = Field(default=None, max_length=1000)
    credentials: dict[str, str] | None = None


@router.patch("/providers/{code}")
async def update_provider(code: str, body: ProviderUpdate, admin: dict = Depends(require_role(*SUPER))):
    if code not in REGISTRY:
        raise HTTPException(404, "Unknown provider")
    p = REGISTRY[code]
    if code == "KOTAK" and (body.enabled or body.is_primary):
        raise HTTPException(409, "Kotak cannot be enabled until the adapter is implemented from Kotak's approved documentation")
    upd = {}
    if body.enabled is not None:
        upd["enabled"] = body.enabled
    if body.notes is not None:
        upd["notes"] = body.notes
    if body.credentials:
        for k, v in body.credentials.items():
            if any(x in k.lower() for x in ("pin", "otp", "password", "login")):
                raise HTTPException(422, f"Storing '{k}' is prohibited")
            upd[f"credentials_encrypted.{k[:60]}"] = encrypt(v)
    if upd:
        await db.payment_provider_config.update_one({"code": code}, {"$set": {**upd, "updated_at": now()}}, upsert=True)
    if body.is_primary:
        cfg = await db.payment_provider_config.find_one({"code": code})
        if not cfg or not cfg.get("enabled"):
            raise HTTPException(409, "Enable the provider first")
        await db.system_settings.update_one({"id": "global"}, {"$set": {"primary_provider": code}})
    await audit(admin, "PROVIDER_UPDATED", "provider", code, meta={"fields": [k.split(".")[0] if "credentials" in k else k for k in upd],
                                                                  "primary": body.is_primary, "simulated": p.is_simulated})
    return {"ok": True}


# ---------- API clients (EV Rent / MyVolt service keys) ----------
@router.get("/api-clients")
async def api_clients(admin: dict = Depends(require_role(*SUPER))):
    return clean(await db.api_clients.find({}, {"_id": 0, "key_hash": 0}).sort("created_at", -1).to_list(200))


class ClientCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    system: str = Field(pattern="^(EV_RENT|MYVOLT|OTHER)$")


@router.post("/api-clients")
async def create_client(body: ClientCreate, admin: dict = Depends(require_role(*SUPER))):
    raw = f"r39_{body.system.lower()}_{secrets.token_urlsafe(32)}"
    doc = {"id": new_id("CLI"), "name": body.name, "system": body.system, "key_prefix": raw[:14], "key_hash": hash_key(raw),
           "active": True, "created_by": admin["email"], "created_at": now(), "last_used_at": None}
    await db.api_clients.insert_one(dict(doc))
    await audit(admin, "API_CLIENT_CREATED", "api_client", doc["id"], meta={"name": body.name})
    doc.pop("key_hash")
    return {**clean(doc), "api_key": raw, "note": "Shown once. Store it in the EV Rent backend's secret store."}


@router.post("/api-clients/{cid}/revoke")
async def revoke_client(cid: str, admin: dict = Depends(require_role(*SUPER))):
    res = await db.api_clients.update_one({"id": cid}, {"$set": {"active": False, "revoked_at": now()}})
    if not res.matched_count:
        raise HTTPException(404, "Not found")
    await audit(admin, "API_CLIENT_REVOKED", "api_client", cid)
    return {"ok": True}


# ---------- Sync logs / webhooks ----------
@router.get("/sync-logs/{target}")
async def sync_logs(target: str, status: str | None = None, page: int = 1, size: int = 25, member: dict = Depends(require_role(*FINANCE))):
    if target not in sync.TARGETS:
        raise HTTPException(404, "Unknown target")
    q = {"status": status} if status else {}
    res = await paginate(sync.TARGETS[target], q, [("created_at", -1)], page, size)
    agg = await db[sync.TARGETS[target]].aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(10)
    res["counts"] = {a["_id"]: a["n"] for a in agg}
    return res


@router.post("/sync-logs/{target}/{log_id}/retry")
async def retry_sync(target: str, log_id: str, member: dict = Depends(require_role(*FINANCE))):
    if target not in sync.TARGETS or not await sync.retry_now(sync.TARGETS[target], log_id, member):
        raise HTTPException(409, "Nothing to retry")
    return {"ok": True}


@router.get("/webhooks")
async def webhooks(page: int = 1, size: int = 25, member: dict = Depends(require_role(*FINANCE))):
    return await paginate("payment_webhooks", {}, [("received_at", -1)], page, size)


@router.get("/audit-logs")
async def audit_logs(q: str | None = None, action: str | None = None, page: int = 1, size: int = 50,
                     admin: dict = Depends(require_role(*SUPER))):
    from routes_admin import _search
    query = {**_search(q, ["entity_id", "actor_email", "action", "reason"]), **({"action": action} if action else {})}
    return await paginate("payment_audit_logs", query, [("created_at", -1)], page, size)


# ---------- Settings ----------
@router.get("/settings")
async def settings_get(member: dict = Depends(require_role(*FINANCE))):
    return clean(await get_settings())


class SettingsUpdate(BaseModel):
    brand_name: str | None = Field(default=None, max_length=40)
    brand_tagline: str | None = Field(default=None, max_length=60)
    logo_url: str | None = Field(default=None, max_length=500)
    payment_expiry_minutes: int | None = Field(default=None, ge=5, le=1440)
    allow_partial_payments: bool | None = None
    static_qr_image_url: str | None = Field(default=None, max_length=500)
    static_qr_vpa: str | None = Field(default=None, max_length=100)
    static_qr_merchant_name: str | None = Field(default=None, max_length=100)
    settlement_keywords: list[str] | None = None
    myvolt_simulate_failure: bool | None = None
    support_contact: str | None = Field(default=None, max_length=200)


@router.patch("/settings")
async def settings_update(body: SettingsUpdate, admin: dict = Depends(require_role(*SUPER))):
    upd = body.model_dump(exclude_none=True)
    before = await get_settings()
    await db.system_settings.update_one({"id": "global"}, {"$set": upd}, upsert=True)
    await audit(admin, "SETTINGS_UPDATED", "settings", "global", meta={k: {"from": before.get(k), "to": v} for k, v in upd.items()})
    return clean(await get_settings())
