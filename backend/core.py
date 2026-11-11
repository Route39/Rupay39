import os
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from cryptography.fernet import Fernet
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
IST = ZoneInfo("Asia/Kolkata")
log = logging.getLogger("rupay39")

REQUEST_STATUSES = ["INITIATED", "PENDING", "SUCCESS", "FAILED", "EXPIRED", "UNMATCHED", "REFUNDED", "REVERSED"]
OPEN_STATUSES = ["INITIATED", "PENDING"]
RECON_STATUSES = ["MATCHED", "UNMATCHED", "AMOUNT_MISMATCH", "DUPLICATE", "MISSING_IN_BANK", "MISSING_IN_SYSTEM", "UNDER_REVIEW"]
SYNC_STATUSES = ["NOT_SYNCED", "SYNC_PENDING", "SYNCED", "SYNC_FAILED", "RETRY_PENDING"]
CITIES = ["Chennai", "Coimbatore", "Madurai", "Bengaluru", "Mysuru"]

_partial_utr = {"utr": {"$type": "string"}}
INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("user_id", ASCENDING)], unique=True, name="uid")],
    "drivers": [IndexModel([("id", ASCENDING)], unique=True, name="id"), IndexModel([("city", ASCENDING)], name="city")],
    "vehicles": [IndexModel([("id", ASCENDING)], unique=True, name="id"),
                 IndexModel([("registration_no", ASCENDING)], unique=True, name="reg")],
    "payment_requests": [
        IndexModel([("id", ASCENDING)], unique=True, name="id"),
        IndexModel([("internal_ref", ASCENDING)], unique=True, name="ref"),
        IndexModel([("client_id", ASCENDING), ("idempotency_key", ASCENDING)], unique=True, name="idem",
                   partialFilterExpression={"idempotency_key": {"$type": "string"}}),
        IndexModel([("driver_id", ASCENDING), ("created_at", DESCENDING)], name="driver_created"),
        IndexModel([("status", ASCENDING), ("expires_at", ASCENDING)], name="status_exp"),
        IndexModel([("claimed_utr", ASCENDING)], name="claimed_utr"),
        IndexModel([("city", ASCENDING), ("created_at", DESCENDING)], name="city_created"),
    ],
    "payment_transactions": [
        IndexModel([("id", ASCENDING)], unique=True, name="id"),
        IndexModel([("provider", ASCENDING), ("provider_txn_id", ASCENDING)], unique=True, name="prov_txn"),
        IndexModel([("utr", ASCENDING), ("kind", ASCENDING)], unique=True, name="utr_kind", partialFilterExpression=_partial_utr),
        IndexModel([("payment_id", ASCENDING)], name="payment"),
        IndexModel([("created_at", DESCENDING)], name="created"),
        IndexModel([("city", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)], name="city_status"),
    ],
    "payment_webhooks": [IndexModel([("event_key", ASCENDING)], unique=True, name="event_key"),
                         IndexModel([("received_at", DESCENDING)], name="received"),
                         IndexModel([("expire_at", ASCENDING)], name="rejected_ttl", expireAfterSeconds=0)],
    "payment_audit_logs": [IndexModel([("created_at", DESCENDING)], name="created"),
                           IndexModel([("entity_id", ASCENDING)], name="entity")],
    "bank_transactions": [IndexModel([("id", ASCENDING)], unique=True, name="id"),
                          IndexModel([("row_hash", ASCENDING)], unique=True, name="row_hash"),
                          IndexModel([("utr", ASCENDING)], name="utr"),
                          IndexModel([("recon_status", ASCENDING), ("txn_time", DESCENDING)], name="recon")],
    "bank_reconciliation": [IndexModel([("created_at", DESCENDING)], name="created"),
                            IndexModel([("run_id", ASCENDING)], name="run")],
    "unmatched_transactions": [IndexModel([("id", ASCENDING)], unique=True, name="id"),
                               IndexModel([("dedupe_key", ASCENDING)], unique=True, name="dedupe",
                                          partialFilterExpression={"dedupe_key": {"$type": "string"}}),
                               IndexModel([("status", ASCENDING), ("city", ASCENDING), ("created_at", DESCENDING)], name="status_city")],
    "payment_receipts": [IndexModel([("receipt_no", ASCENDING)], unique=True, name="no"),
                         IndexModel([("transaction_id", ASCENDING)], unique=True, name="txn")],
    "myvolt_sync_logs": [IndexModel([("idempotency_key", ASCENDING)], unique=True, name="idem"),
                         IndexModel([("status", ASCENDING), ("next_retry_at", ASCENDING)], name="queue")],
    "evrent_sync_logs": [IndexModel([("idempotency_key", ASCENDING)], unique=True, name="idem"),
                         IndexModel([("status", ASCENDING), ("next_retry_at", ASCENDING)], name="queue")],
    "settlement_records": [IndexModel([("bank_txn_id", ASCENDING)], unique=True, name="btx")],
    "payment_provider_config": [IndexModel([("code", ASCENDING)], unique=True, name="code")],
    "api_clients": [IndexModel([("key_hash", ASCENDING)], unique=True, name="hash")],
    "roles": [IndexModel([("code", ASCENDING)], unique=True, name="code")],
    "permissions": [IndexModel([("code", ASCENDING)], unique=True, name="code")],
    "system_settings": [IndexModel([("id", ASCENDING)], unique=True, name="id")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                log.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def short_code(n: int = 10) -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(n))


def ist_day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime(d.year, d.month, d.day, tzinfo=IST)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def ist_today() -> date:
    return now().astimezone(IST).date()


def date_range(date_from: str | None, date_to: str | None, default_days: int = 30) -> tuple[datetime, datetime]:
    today = ist_today()
    d_to = date.fromisoformat(date_to) if date_to else today
    d_from = date.fromisoformat(date_from) if date_from else d_to - timedelta(days=default_days - 1)
    return ist_day_bounds(d_from)[0], ist_day_bounds(d_to)[1]


def clean(doc):
    """Make a Mongo document JSON-safe (drop _id, datetimes -> ISO UTC)."""
    if isinstance(doc, list):
        return [clean(d) for d in doc]
    if isinstance(doc, dict):
        return {k: clean(v) for k, v in doc.items() if k != "_id"}
    if isinstance(doc, datetime):
        if doc.tzinfo is None:
            doc = doc.replace(tzinfo=timezone.utc)
        return doc.isoformat()
    return doc


async def paginate(coll: str, query: dict, sort: list, page: int, size: int) -> dict:
    size = max(1, min(size, 200))
    page = max(1, page)
    total = await db[coll].count_documents(query)
    items = await db[coll].find(query, {"_id": 0}).sort(sort).skip((page - 1) * size).limit(size).to_list(size)
    return {"items": clean(items), "total": total, "page": page, "size": size}


def _fernet() -> Fernet:
    return Fernet(os.environ["RUPAY_ENCRYPTION_KEY"].encode())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


async def audit(actor: dict | None, action: str, entity_type: str, entity_id: str, before: str | None = None,
                after: str | None = None, reason: str | None = None, evidence_ref: str | None = None, meta: dict | None = None):
    await db.payment_audit_logs.insert_one({
        "id": new_id("AUD"), "actor_id": (actor or {}).get("user_id", "system"),
        "actor_email": (actor or {}).get("email", "system"), "actor_role": (actor or {}).get("role", "system"),
        "action": action, "entity_type": entity_type, "entity_id": entity_id,
        "before_status": before, "after_status": after, "reason": reason, "evidence_ref": evidence_ref,
        "meta": meta or {}, "created_at": now(),
    })


DEFAULT_SETTINGS = {
    "id": "global", "brand_name": "RUPAY39", "brand_tagline": "POWERED BY ROUTE39", "logo_url": "",
    "primary_provider": "MOCK", "payment_expiry_minutes": 30, "allow_partial_payments": False,
    "static_qr_image_url": "", "static_qr_vpa": "", "static_qr_merchant_name": "Route39 Mobility",
    "settlement_keywords": ["SETTLEMENT", "SETTL", "BULK CR"], "myvolt_simulate_failure": False,
    "column_mapping_presets": {}, "support_contact": "",
}


async def get_settings() -> dict:
    doc = await db.system_settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        await db.system_settings.update_one({"id": "global"}, {"$setOnInsert": DEFAULT_SETTINGS}, upsert=True)
        doc = dict(DEFAULT_SETTINGS)
    return {**DEFAULT_SETTINGS, **doc}
