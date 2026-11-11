"""Outbox for downstream sync (MyVolt ERP, EV Rent). Events persist first; delivery is async with retries."""
import os
import hmac
import json
import hashlib
from datetime import timedelta

import httpx
from pymongo.errors import DuplicateKeyError

from core import db, now, new_id, get_settings, audit, log

MAX_ATTEMPTS = 5
TARGETS = {"myvolt": "myvolt_sync_logs", "evrent": "evrent_sync_logs"}


def _payload(event_type: str, txn: dict, req: dict) -> dict:
    return {"event_type": event_type, "payment_id": req["id"], "transaction_id": txn["id"], "internal_ref": req["internal_ref"],
            "driver_id": req["driver_id"], "vehicle_id": req["vehicle_id"], "vehicle_reg": req["vehicle_reg"], "city": req["city"],
            "amount": txn["amount"], "utr": txn.get("utr"), "provider": txn["provider"], "method": req["method"],
            "receipt_no": txn.get("receipt_no"), "simulated": txn["is_simulated"],
            "rental_amount": req["rental_amount"], "outstanding_amount": req["outstanding_amount"], "occurred_at": now().isoformat()}


async def enqueue(event_type: str, txn: dict, req: dict) -> None:
    payload = _payload(event_type, txn, req)
    for target, coll in TARGETS.items():
        try:
            await db[coll].insert_one({"id": new_id("SYN"), "target": target, "idempotency_key": f"{event_type}:{txn['id']}",
                                       "event_type": event_type, "payment_id": req["id"], "transaction_id": txn["id"],
                                       "city": req["city"], "payload": payload, "status": "SYNC_PENDING", "attempts": 0,
                                       "next_retry_at": now(), "last_error": None, "response": None, "history": [],
                                       "created_at": now(), "updated_at": now()})
        except DuplicateKeyError:
            log.info("sync %s already queued for %s", target, txn["id"])


async def _send_myvolt(doc: dict) -> dict:
    url = os.environ.get("MYVOLT_PAYMENT_SYNC_URL")
    if url:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, json=doc["payload"], headers={"Authorization": f"Bearer {os.environ.get('MYVOLT_API_KEY', '')}",
                                                                 "Idempotency-Key": doc["idempotency_key"]})
            r.raise_for_status()
            return {"http_status": r.status_code, "body": r.text[:1000]}
    settings = await get_settings()
    if settings.get("myvolt_simulate_failure"):
        raise RuntimeError("SIMULATED MyVolt outage (Settings > MyVolt simulate failure)")
    return {"simulated": True, "myvolt_ref": f"MOCK-MV-{doc['transaction_id']}", "note": "MyVolt API not configured; mock acknowledged"}


async def _send_evrent(doc: dict) -> dict:
    url = os.environ.get("EVRENT_WEBHOOK_URL")
    if url:
        body = json.dumps(doc["payload"]).encode()
        sig = hmac.new(os.environ.get("EVRENT_WEBHOOK_SECRET", "").encode(), body, hashlib.sha256).hexdigest()
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, content=body, headers={"Content-Type": "application/json", "X-RUPAY39-Signature": sig,
                                                         "Idempotency-Key": doc["idempotency_key"]})
            r.raise_for_status()
            return {"http_status": r.status_code}
    return {"simulated": True, "note": "EV Rent webhook not configured; status available via GET /api/v1/payments/{id}"}


async def _process_one(coll: str) -> bool:
    t = now()
    doc = await db[coll].find_one_and_update(
        {"status": {"$in": ["SYNC_PENDING", "RETRY_PENDING"]}, "next_retry_at": {"$lte": t},
         "$or": [{"locked_until": None}, {"locked_until": {"$lt": t}}]},
        {"$set": {"locked_until": t + timedelta(seconds=60)}}, projection={"_id": 0}, sort=[("next_retry_at", 1)])
    if not doc:
        return False
    attempts = doc["attempts"] + 1
    try:
        resp = await (_send_myvolt(doc) if doc["target"] == "myvolt" else _send_evrent(doc))
        await db[coll].update_one({"id": doc["id"]}, {"$set": {"status": "SYNCED", "attempts": attempts, "response": resp,
                                                               "synced_at": now(), "updated_at": now(), "locked_until": None},
                                                      "$push": {"history": {"at": now(), "result": "SYNCED"}}})
        if doc["target"] == "myvolt":
            await db.payment_transactions.update_one({"id": doc["transaction_id"]}, {"$set": {"myvolt_sync_status": "SYNCED"}})
            await db.payment_requests.update_one({"id": doc["payment_id"]}, {"$set": {"sync_status": "SYNCED"}})
    except Exception as e:
        failed = attempts >= MAX_ATTEMPTS
        status = "SYNC_FAILED" if failed else "RETRY_PENDING"
        await db[coll].update_one({"id": doc["id"]}, {"$set": {
            "status": status, "attempts": attempts, "last_error": str(e)[:500], "updated_at": now(), "locked_until": None,
            "next_retry_at": now() + timedelta(seconds=min(3600, 20 * 2 ** attempts))},
            "$push": {"history": {"at": now(), "result": status, "error": str(e)[:300]}}})
        if doc["target"] == "myvolt":
            await db.payment_transactions.update_one({"id": doc["transaction_id"]}, {"$set": {"myvolt_sync_status": status}})
            await db.payment_requests.update_one({"id": doc["payment_id"]}, {"$set": {"sync_status": status}})
            if failed:
                from engine import create_exception
                await create_exception("MYVOLT_SYNC_FAILED", city=doc.get("city"), payment_id=doc["payment_id"],
                                       transaction_id=doc["transaction_id"], details=f"MyVolt sync failed after {attempts} attempts: {e}",
                                       dedupe_key=f"sync:{doc['id']}:{attempts}")
    return True


async def process_queues(batch: int = 50) -> None:
    for coll in TARGETS.values():
        for _ in range(batch):
            if not await _process_one(coll):
                break


async def retry_now(coll: str, log_id: str, actor: dict) -> bool:
    res = await db[coll].update_one({"id": log_id, "status": {"$in": ["SYNC_FAILED", "RETRY_PENDING"]}},
                                    {"$set": {"status": "RETRY_PENDING", "next_retry_at": now(), "attempts": 0, "locked_until": None}})
    if res.modified_count:
        await audit(actor, "SYNC_RETRY_REQUESTED", coll, log_id, None, "RETRY_PENDING")
    return bool(res.modified_count)
