"""Payment request engine + verification engine. Only verified provider/bank evidence can mark SUCCESS."""
import json
from datetime import timedelta

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core import db, now, new_id, short_code, ist_today, audit, get_settings, OPEN_STATUSES, log
from providers import get_provider, ProviderNotAvailable, ProviderEvent
import sync

CLAIMABLE = ["INITIATED", "PENDING", "EXPIRED", "FAILED", "UNMATCHED"]


def payable_for(driver: dict) -> dict:
    rent_due = 0.0 if driver.get("rent_paid_for") == ist_today().isoformat() else float(driver.get("daily_rent", 0))
    outstanding = float(driver.get("outstanding_amount", 0))
    return {"rental_amount": rent_due, "outstanding_amount": outstanding, "total_payable": round(rent_due + outstanding, 2)}


async def create_exception(etype: str, *, city: str | None = None, payment_id: str | None = None, bank_txn_id: str | None = None,
                           transaction_id: str | None = None, amount: float | None = None, details: str = "",
                           dedupe_key: str | None = None, driver_id: str | None = None) -> dict | None:
    doc = {"id": new_id("EXC"), "type": etype, "status": "OPEN", "city": city, "payment_id": payment_id, "bank_txn_id": bank_txn_id,
           "transaction_id": transaction_id, "driver_id": driver_id, "amount": amount, "details": details, "comments": [],
           "resolution": None, "created_at": now(), "updated_at": now()}
    if dedupe_key:
        doc["dedupe_key"] = dedupe_key
    try:
        await db.unmatched_transactions.insert_one(doc)
    except DuplicateKeyError:
        return None
    await audit(None, "EXCEPTION_CREATED", "exception", doc["id"], None, "OPEN", details, meta={"type": etype, "payment_id": payment_id})
    return doc


async def create_payment_request(*, driver_id: str, vehicle_id: str, amount: float | None, method: str, provider_code: str | None,
                                 client_id: str, idempotency_key: str | None, actor: dict | None) -> dict:
    settings = await get_settings()
    if idempotency_key:
        existing = await db.payment_requests.find_one({"client_id": client_id, "idempotency_key": idempotency_key}, {"_id": 0})
        if existing:
            return existing
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver or driver.get("status") != "ACTIVE":
        raise HTTPException(404, "Driver not found or inactive")
    vehicle = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not vehicle or vehicle.get("driver_id") != driver_id:
        raise HTTPException(422, "Vehicle is not assigned to this driver")
    open_req = await db.payment_requests.find_one(
        {"driver_id": driver_id, "status": {"$in": OPEN_STATUSES}, "expires_at": {"$gt": now()}}, {"_id": 0})
    if open_req:
        return open_req
    due = payable_for(driver)
    if due["total_payable"] <= 0:
        raise HTTPException(409, "Nothing payable for this driver right now")
    if amount is not None:
        amount = round(float(amount), 2)
        if amount != due["total_payable"]:
            if not settings["allow_partial_payments"] or not (0 < amount < due["total_payable"]):
                raise HTTPException(422, f"Amount must equal authorised payable amount {due['total_payable']:.2f}")
    pay_amount = amount if amount is not None else due["total_payable"]
    provider_code = provider_code or settings["primary_provider"]
    try:
        provider = get_provider(provider_code)
    except ProviderNotAvailable as e:
        raise HTTPException(422, str(e))
    cfg = await db.payment_provider_config.find_one({"code": provider_code}, {"_id": 0})
    if not cfg or not cfg.get("enabled"):
        raise HTTPException(422, f"Provider {provider_code} is not enabled")
    if method not in provider.methods:
        raise HTTPException(422, f"Method {method} not supported by {provider_code}")
    ts = now()
    req = {
        "id": f"PAY-{ist_today().strftime('%Y%m%d')}-{short_code(6)}", "internal_ref": f"R39{short_code(12)}",
        "driver_id": driver_id, "vehicle_id": vehicle_id, "driver_name": driver["name"], "vehicle_reg": vehicle["registration_no"],
        "city": driver["city"], "supervisor_id": driver.get("supervisor_id"), **due, "amount_requested": pay_amount,
        "is_partial": pay_amount < due["total_payable"], "provider": provider_code, "method": method,
        "is_simulated": provider.is_simulated, "status": "INITIATED", "reconciliation_status": "UNMATCHED",
        "sync_status": "NOT_SYNCED", "utr": None, "claimed_utr": None, "provider_txn_id": None, "client_id": client_id,
        "idempotency_key": idempotency_key, "created_at": ts,
        "expires_at": ts + timedelta(minutes=int(settings["payment_expiry_minutes"]) if provider_code != "STATIC_QR" else 24 * 60),
        "confirmed_at": None, "late_confirmation": False, "receipt_no": None,
    }
    if not idempotency_key:
        req.pop("idempotency_key")
    try:
        await db.payment_requests.insert_one(dict(req))
    except DuplicateKeyError:
        return await db.payment_requests.find_one({"client_id": client_id, "idempotency_key": idempotency_key}, {"_id": 0})
    try:
        instructions = await provider.initiate({**req, "total_payable": pay_amount}, settings)
        status = "PENDING"
    except ProviderNotAvailable as e:
        instructions, status = {"error": str(e)}, "FAILED"
    await db.payment_requests.update_one({"id": req["id"]}, {"$set": {"instructions": instructions, "status": status}})
    await audit(actor, "PAYMENT_REQUEST_CREATED", "payment_request", req["id"], None, status,
                meta={"client_id": client_id, "amount": pay_amount, "provider": provider_code})
    return {**req, "instructions": instructions, "status": status}


async def _issue_receipt(req: dict, txn: dict) -> str:
    receipt_no = f"R39-RCPT-{ist_today().strftime('%Y%m%d')}-{short_code(6)}"
    try:
        await db.payment_receipts.insert_one({
            "receipt_no": receipt_no, "payment_id": req["id"], "transaction_id": txn["id"], "amount": txn["amount"],
            "driver_id": req["driver_id"], "driver_name": req["driver_name"], "vehicle_reg": req["vehicle_reg"], "city": req["city"],
            "utr": txn.get("utr"), "provider": txn["provider"], "method": req["method"], "is_simulated": txn["is_simulated"],
            "rental_amount": req["rental_amount"], "outstanding_amount": req["outstanding_amount"], "issued_at": now()})
    except DuplicateKeyError:
        existing = await db.payment_receipts.find_one({"transaction_id": txn["id"]})
        return existing["receipt_no"]
    return receipt_no


async def record_success(req: dict, *, amount: float, provider: str, provider_txn_id: str, utr: str | None, payer_vpa: str | None,
                         source: str, is_simulated: bool, actor: dict | None = None, reason: str | None = None,
                         evidence_ref: str | None = None, recon_status: str = "UNMATCHED") -> dict:
    """Idempotent: uniqueness on (provider, provider_txn_id) and (utr, kind) means a payment is credited once."""
    txn = {"id": new_id("TXN"), "payment_id": req["id"], "kind": "PAYMENT", "provider": provider, "provider_txn_id": provider_txn_id,
           "amount": amount, "status": "PROCESSING", "source": source, "is_simulated": is_simulated, "payer_vpa": payer_vpa,
           "driver_id": req["driver_id"], "driver_name": req["driver_name"], "vehicle_reg": req["vehicle_reg"], "city": req["city"],
           "method": req["method"], "reconciliation_status": recon_status, "myvolt_sync_status": "NOT_SYNCED", "created_at": now()}
    if utr:
        txn["utr"] = utr
    try:
        await db.payment_transactions.insert_one(dict(txn))
    except DuplicateKeyError as e:
        key = (e.details or {}).get("keyPattern", {})
        if "utr" in key:
            await create_exception("DUPLICATE_TRANSACTION", city=req["city"], payment_id=req["id"], amount=amount,
                                   details=f"UTR {utr} already credited to another transaction; not credited again",
                                   dedupe_key=f"dup-utr:{utr}:{provider_txn_id}", driver_id=req["driver_id"])
            return {"outcome": "DUPLICATE_UTR"}
        return {"outcome": "DUPLICATE_TRANSACTION"}
    prev = req["status"]
    claimed = await db.payment_requests.find_one_and_update(
        {"id": req["id"], "status": {"$in": CLAIMABLE}},
        {"$set": {"status": "SUCCESS", "confirmed_at": now(), "utr": utr, "provider_txn_id": provider_txn_id,
                  "late_confirmation": prev == "EXPIRED", "transaction_id": txn["id"], "sync_status": "SYNC_PENDING",
                  "reconciliation_status": recon_status}}, projection={"_id": 0})
    if not claimed:
        await db.payment_transactions.update_one({"id": txn["id"]}, {"$set": {"status": "DUPLICATE"}})
        await create_exception("DUPLICATE_TRANSACTION", city=req["city"], payment_id=req["id"], transaction_id=txn["id"], amount=amount,
                               details="Second payment received for an already-settled request; review for refund",
                               dedupe_key=f"dup-pay:{txn['id']}", driver_id=req["driver_id"])
        await audit(actor, "DUPLICATE_PAYMENT", "payment_transaction", txn["id"], None, "DUPLICATE", reason)
        return {"outcome": "DUPLICATE_PAYMENT", "transaction_id": txn["id"]}
    prev = claimed["status"]
    txn["status"] = "SUCCESS"
    receipt_no = await _issue_receipt(req, txn)
    await db.payment_transactions.update_one({"id": txn["id"]}, {"$set": {"status": "SUCCESS", "receipt_no": receipt_no,
                                                                         "myvolt_sync_status": "SYNC_PENDING"}})
    await db.payment_requests.update_one({"id": req["id"]}, {"$set": {"receipt_no": receipt_no}})
    # Payment covers the rent component first; the remainder reduces the current outstanding (never below zero).
    reduce_by = round(amount - req["rental_amount"], 2)
    await db.drivers.update_one({"id": req["driver_id"]}, [{"$set": {
        "rent_paid_for": ist_today().isoformat(), "last_payment_at": now(),
        "outstanding_amount": {"$max": [0, {"$round": [{"$subtract": [{"$ifNull": ["$outstanding_amount", 0]}, reduce_by]}, 2]}]}}}])
    await audit(actor, "PAYMENT_VERIFIED", "payment_request", req["id"], prev, "SUCCESS", reason, evidence_ref,
                meta={"transaction_id": txn["id"], "source": source, "utr": utr, "amount": amount, "simulated": is_simulated})
    if prev == "EXPIRED":
        await create_exception("DELAYED_CONFIRMATION", city=req["city"], payment_id=req["id"], transaction_id=txn["id"], amount=amount,
                               details="Verified confirmation arrived after the request expired", dedupe_key=f"late:{txn['id']}",
                               driver_id=req["driver_id"])
    await sync.enqueue("PAYMENT_VERIFIED", {**txn, "receipt_no": receipt_no}, req)
    return {"outcome": "SUCCESS", "transaction_id": txn["id"], "receipt_no": receipt_no}


async def _record_failed(req: dict, ev: ProviderEvent, provider: str, simulated: bool) -> dict:
    txn = {"id": new_id("TXN"), "payment_id": req["id"], "kind": "PAYMENT", "provider": provider, "provider_txn_id": ev.provider_txn_id,
           "amount": ev.amount, "status": "FAILED", "source": "CALLBACK", "is_simulated": simulated, "payer_vpa": ev.payer_vpa,
           "driver_id": req["driver_id"], "driver_name": req["driver_name"], "vehicle_reg": req["vehicle_reg"], "city": req["city"],
           "method": req["method"], "reconciliation_status": "UNMATCHED", "myvolt_sync_status": "NOT_SYNCED", "created_at": now()}
    try:
        await db.payment_transactions.insert_one(txn)
    except DuplicateKeyError:
        return {"outcome": "DUPLICATE_TRANSACTION"}
    res = await db.payment_requests.update_one({"id": req["id"], "status": {"$in": OPEN_STATUSES}}, {"$set": {"status": "FAILED"}})
    if res.modified_count:
        await audit(None, "PAYMENT_FAILED", "payment_request", req["id"], req["status"], "FAILED", meta={"transaction_id": txn["id"]})
    return {"outcome": "FAILED", "transaction_id": txn["id"]}


async def _record_reversal(req: dict, ev: ProviderEvent, provider: str, simulated: bool) -> dict:
    kind = ev.event_type  # REVERSAL | REFUND
    orig = await db.payment_transactions.find_one({"provider": provider, "provider_txn_id": ev.original_txn_id, "kind": "PAYMENT"},
                                                  {"_id": 0})
    if not orig or orig["status"] != "SUCCESS":
        await create_exception(kind, city=req["city"], payment_id=req["id"], amount=ev.amount,
                               details=f"{kind} received but original successful transaction {ev.original_txn_id} not found",
                               dedupe_key=f"rev-orphan:{ev.provider_txn_id}", driver_id=req["driver_id"])
        return {"outcome": "ORIGINAL_NOT_FOUND"}
    txn = {"id": new_id("TXN"), "payment_id": req["id"], "kind": kind, "provider": provider, "provider_txn_id": ev.provider_txn_id,
           "amount": -abs(ev.amount), "status": "SUCCESS", "source": "CALLBACK", "is_simulated": simulated, "original_txn_id": orig["id"],
           "driver_id": req["driver_id"], "driver_name": req["driver_name"], "vehicle_reg": req["vehicle_reg"], "city": req["city"],
           "method": req["method"], "reconciliation_status": "UNMATCHED", "myvolt_sync_status": "SYNC_PENDING", "created_at": now()}
    if ev.utr:
        txn["utr"] = ev.utr
    try:
        await db.payment_transactions.insert_one(dict(txn))
    except DuplicateKeyError:
        return {"outcome": "DUPLICATE_TRANSACTION"}
    new_status = "REVERSED" if kind == "REVERSAL" else "REFUNDED"
    await db.payment_transactions.update_one({"id": orig["id"]}, {"$set": {"status": new_status, "reversed_by": txn["id"]}})
    await db.payment_requests.update_one({"id": req["id"]}, {"$set": {"status": new_status}})
    await db.drivers.update_one({"id": req["driver_id"]}, {"$inc": {"outstanding_amount": abs(ev.amount)}})
    await audit(None, f"PAYMENT_{new_status}", "payment_request", req["id"], req["status"], new_status, meta={"transaction_id": txn["id"]})
    await create_exception(kind, city=req["city"], payment_id=req["id"], transaction_id=txn["id"], amount=ev.amount,
                           details=f"{kind} of {orig['id']} recorded; outstanding restored", dedupe_key=f"rev:{txn['id']}",
                           driver_id=req["driver_id"])
    await sync.enqueue("PAYMENT_" + new_status, txn, req)
    return {"outcome": new_status, "transaction_id": txn["id"]}


async def process_callback(provider_code: str, raw: bytes, headers: dict) -> tuple[int, dict]:
    """Verification engine entry point for provider callbacks."""
    try:
        provider = get_provider(provider_code)
    except ProviderNotAvailable:
        return 404, {"error": "unknown provider"}
    received = now()
    if not provider.supports_callbacks or not provider.verify_signature(raw, headers):
        await db.payment_webhooks.insert_one({"event_key": new_id("INVALID"), "provider": provider_code, "signature_valid": False,
                                              "payload": raw.decode(errors="replace")[:2000], "result": "REJECTED_SIGNATURE",
                                              "received_at": received, "expire_at": received + timedelta(days=30)})
        await audit(None, "WEBHOOK_REJECTED", "webhook", provider_code, reason="Invalid or missing signature")
        return 401, {"error": "invalid signature"}
    try:
        ev = provider.parse_callback(raw)
    except Exception:
        return 400, {"error": "malformed payload"}
    event_key = f"{provider_code}:{ev.event_id}"
    try:
        await db.payment_webhooks.insert_one({"event_key": event_key, "provider": provider_code, "signature_valid": True,
                                              "payload": json.loads(raw), "result": "PROCESSING", "received_at": received,
                                              "duplicate_count": 0})
    except DuplicateKeyError:
        await db.payment_webhooks.update_one({"event_key": event_key}, {"$inc": {"duplicate_count": 1}})
        return 200, {"status": "duplicate_callback_ignored"}

    async def done(result: dict) -> tuple[int, dict]:
        await db.payment_webhooks.update_one({"event_key": event_key}, {"$set": {"result": result.get("outcome"), "processed_at": now()}})
        return 200, result

    req = await db.payment_requests.find_one({"internal_ref": ev.internal_ref}, {"_id": 0})
    if not req:
        await create_exception("UNMATCHED_PROVIDER_EVENT", amount=ev.amount, details=f"Callback for unknown reference {ev.internal_ref}",
                               dedupe_key=f"unk:{event_key}")
        return await done({"outcome": "UNMATCHED"})
    if ev.merchant_id != provider.merchant_id():
        await create_exception("MERCHANT_MISMATCH", city=req["city"], payment_id=req["id"], amount=ev.amount,
                               details=f"Merchant {ev.merchant_id} does not match configured merchant", dedupe_key=f"mm:{event_key}")
        return await done({"outcome": "MERCHANT_MISMATCH"})
    if req["provider"] != provider_code:
        return await done({"outcome": "PROVIDER_MISMATCH"})
    if ev.event_type in ("REVERSAL", "REFUND"):
        return await done(await _record_reversal(req, ev, provider_code, provider.is_simulated))
    if ev.status != "SUCCESS":
        return await done(await _record_failed(req, ev, provider_code, provider.is_simulated))
    if round(ev.amount, 2) != round(req["amount_requested"], 2):
        txn = {"id": new_id("TXN"), "payment_id": req["id"], "kind": "PAYMENT", "provider": provider_code,
               "provider_txn_id": ev.provider_txn_id, "amount": ev.amount, "status": "AMOUNT_MISMATCH", "source": "CALLBACK",
               "is_simulated": provider.is_simulated, "driver_id": req["driver_id"], "driver_name": req["driver_name"],
               "vehicle_reg": req["vehicle_reg"], "city": req["city"], "method": req["method"],
               "reconciliation_status": "AMOUNT_MISMATCH", "myvolt_sync_status": "NOT_SYNCED", "created_at": now()}
        try:
            await db.payment_transactions.insert_one(txn)
        except DuplicateKeyError:
            return await done({"outcome": "DUPLICATE_TRANSACTION"})
        await db.payment_requests.update_one({"id": req["id"]}, {"$set": {"reconciliation_status": "AMOUNT_MISMATCH"}})
        await create_exception("AMOUNT_MISMATCH", city=req["city"], payment_id=req["id"], transaction_id=txn["id"], amount=ev.amount,
                               details=f"Paid {ev.amount:.2f}, expected {req['amount_requested']:.2f}", dedupe_key=f"amt:{txn['id']}",
                               driver_id=req["driver_id"])
        return await done({"outcome": "AMOUNT_MISMATCH", "transaction_id": txn["id"]})
    return await done(await record_success(req, amount=ev.amount, provider=provider_code, provider_txn_id=ev.provider_txn_id,
                                           utr=ev.utr, payer_vpa=ev.payer_vpa, source="CALLBACK", is_simulated=provider.is_simulated,
                                           recon_status="MATCHED" if provider.is_simulated else "UNMATCHED"))


async def expire_requests() -> int:
    res = await db.payment_requests.update_many({"status": {"$in": OPEN_STATUSES}, "expires_at": {"$lt": now()}},
                                                {"$set": {"status": "EXPIRED", "expired_at": now()}})
    if res.modified_count:
        log.info("expired %s payment requests", res.modified_count)
    return res.modified_count


async def submit_utr(payment_id: str, utr: str, driver_id: str | None = None) -> dict:
    """Driver-claimed UTR for static QR. Recorded as a claim only; never proof of payment."""
    utr = utr.strip()
    if not (utr.isdigit() and 10 <= len(utr) <= 22):
        raise HTTPException(422, "UTR must be 10-22 digits")
    q = {"id": payment_id, **({"driver_id": driver_id} if driver_id else {})}
    req = await db.payment_requests.find_one(q, {"_id": 0})
    if not req:
        raise HTTPException(404, "Payment request not found")
    if req["provider"] != "STATIC_QR":
        raise HTTPException(422, "UTR submission applies only to static QR payments")
    if req["status"] not in ("PENDING", "EXPIRED"):
        raise HTTPException(409, f"Request is {req['status']}")
    await db.payment_requests.update_one({"id": payment_id}, {"$set": {"claimed_utr": utr, "utr_submitted_at": now()}})
    await audit(None, "UTR_CLAIM_SUBMITTED", "payment_request", payment_id, meta={"utr": utr})
    others = await db.payment_requests.count_documents({"claimed_utr": utr, "id": {"$ne": payment_id}})
    return {"payment_id": payment_id, "claimed_utr": utr, "status": req["status"], "verification": "AWAITING_BANK_STATEMENT",
            "conflict": others > 0}
