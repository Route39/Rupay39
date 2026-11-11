import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import db, now, new_id, clean, paginate, date_range, audit, get_settings, IST
from rbac import current_member, require_role, city_scope, STAFF, FINANCE, ROLE_LABELS, PERMISSIONS
from engine import create_payment_request, process_callback, payable_for
from providers import get_provider

router = APIRouter(prefix="/api/admin")


@router.get("/me")
async def me(member: dict = Depends(current_member)):
    return {**clean(member), "role_label": ROLE_LABELS[member["role"]], "permissions": PERMISSIONS[member["role"]]}


async def _scope(member: dict, city: str | None, supervisor_id: str | None) -> dict:
    q = city_scope(member)
    cities = None
    if supervisor_id:
        sup = await db.users.find_one({"user_id": supervisor_id}, {"_id": 0, "cities": 1})
        cities = (sup or {}).get("cities") or []
    if city:
        cities = [c for c in (cities or [city]) if c == city]
    if cities is not None:
        allowed = q.get("city", {}).get("$in")
        q["city"] = {"$in": [c for c in cities if allowed is None or c in allowed]}
    return q


def _search(q: str | None, fields: list[str]) -> dict:
    if not q:
        return {}
    import re
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    return {"$or": [{f: rx} for f in fields]}


@router.get("/dashboard")
async def dashboard(date_from: str | None = None, date_to: str | None = None, city: str | None = None, driver_id: str | None = None,
                    vehicle_reg: str | None = None, supervisor_id: str | None = None, status: str | None = None, method: str | None = None,
                    member: dict = Depends(require_role(*STAFF))):
    lo, hi = date_range(date_from, date_to, default_days=1)
    days = max(1, round((hi - lo).total_seconds() / 86400))
    scope = await _scope(member, city, supervisor_id)
    dq = {"status": "ACTIVE", **scope}
    if driver_id:
        dq["id"] = driver_id
    if vehicle_reg:
        dq["vehicle_reg"] = vehicle_reg
    tq = {"kind": "PAYMENT", "created_at": {"$gte": lo, "$lt": hi}, **scope}
    for k, v in (("driver_id", driver_id), ("vehicle_reg", vehicle_reg), ("method", method)):
        if v:
            tq[k] = v
    success_q = {**tq, "status": status or "SUCCESS"} if (status in (None, "SUCCESS")) else {**tq, "status": status}
    agg = lambda pipe, coll="payment_transactions": db[coll].aggregate(pipe).to_list(1000)
    drivers = await agg([{"$match": dq}, {"$group": {"_id": None, "n": {"$sum": 1}, "rent": {"$sum": "$daily_rent"},
                                                     "out": {"$sum": "$outstanding_amount"}}}], "drivers")
    d = drivers[0] if drivers else {"n": 0, "rent": 0, "out": 0}
    vehicles = await db.vehicles.count_documents({"status": "ACTIVE", **scope})
    succ = await agg([{"$match": {**tq, "status": "SUCCESS"}}, {"$group": {"_id": "$is_simulated", "amt": {"$sum": "$amount"}, "n": {"$sum": 1}}}])
    succ_amt = sum(s["amt"] for s in succ)
    sim_amt = sum(s["amt"] for s in succ if s["_id"])
    verified = sum(s["n"] for s in succ)
    failed = await db.payment_transactions.count_documents({**tq, "status": "FAILED"})
    failed += await db.payment_requests.count_documents({"status": "FAILED", "created_at": {"$gte": lo, "$lt": hi}, **scope,
                                                         "transaction_id": None, "instructions.error": {"$exists": True}})
    unmatched = await db.bank_transactions.count_documents({"recon_status": {"$in": ["UNMATCHED", "MISSING_IN_SYSTEM", "UNDER_REVIEW"]},
                                                            "entry_type": "TRANSACTION"}) if member["role"] != "supervisor" else 0
    open_exc = await db.unmatched_transactions.count_documents({"status": {"$ne": "RESOLVED"}, **city_scope(member)})
    expected = round(d["rent"] * days, 2)
    ist = {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at", "timezone": "Asia/Kolkata"}}
    daily = await agg([{"$match": {**tq, "status": {"$in": ["SUCCESS", "FAILED"]}}},
                       {"$group": {"_id": ist, "amount": {"$sum": {"$cond": [{"$eq": ["$status", "SUCCESS"]}, "$amount", 0]}},
                                   "success": {"$sum": {"$cond": [{"$eq": ["$status", "SUCCESS"]}, 1, 0]}},
                                   "failed": {"$sum": {"$cond": [{"$eq": ["$status", "FAILED"]}, 1, 0]}}}}, {"$sort": {"_id": 1}}])
    trend_lo = lo if days >= 7 else lo - timedelta(days=13)
    if days < 7:
        daily = await agg([{"$match": {**tq, "created_at": {"$gte": trend_lo, "$lt": hi}, "status": {"$in": ["SUCCESS", "FAILED"]}}},
                           {"$group": {"_id": ist, "amount": {"$sum": {"$cond": [{"$eq": ["$status", "SUCCESS"]}, "$amount", 0]}},
                                       "success": {"$sum": {"$cond": [{"$eq": ["$status", "SUCCESS"]}, 1, 0]}},
                                       "failed": {"$sum": {"$cond": [{"$eq": ["$status", "FAILED"]}, 1, 0]}}}}, {"$sort": {"_id": 1}}])
    monthly = await agg([{"$match": {**{k: v for k, v in tq.items() if k != "created_at"}, "status": "SUCCESS",
                                     "created_at": {"$gte": hi - timedelta(days=365)}}},
                         {"$group": {"_id": {"$dateToString": {"format": "%Y-%m", "date": "$created_at", "timezone": "Asia/Kolkata"}},
                                     "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}}, {"$sort": {"_id": 1}}])
    city_rows = await agg([{"$match": {**tq, "status": "SUCCESS"}}, {"$group": {"_id": "$city", "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}}])
    city_exp = await agg([{"$match": dq}, {"$group": {"_id": "$city", "rent": {"$sum": "$daily_rent"}, "out": {"$sum": "$outstanding_amount"}}}], "drivers")
    cmap = {c["_id"]: {"city": c["_id"], "collected": 0, "count": 0, "expected": round(c["rent"] * days, 2), "outstanding": c["out"]} for c in city_exp}
    for c in city_rows:
        cmap.setdefault(c["_id"], {"city": c["_id"], "expected": 0, "outstanding": 0})
        cmap[c["_id"]].update(collected=c["amount"], count=c["count"])
    recon = await agg([{"$match": {**tq, "status": "SUCCESS"}}, {"$group": {"_id": "$reconciliation_status", "count": {"$sum": 1}}}])
    status_split = await agg([{"$match": tq}, {"$group": {"_id": "$status", "count": {"$sum": 1}}}])
    has_demo = await db.drivers.count_documents({"source": "DEMO"}, limit=1)
    return {
        "range": {"from": lo.astimezone(IST).date().isoformat(), "to": (hi - timedelta(seconds=1)).astimezone(IST).date().isoformat(), "days": days},
        "kpis": {"active_drivers": d["n"], "active_vehicles": vehicles, "expected_collection": expected, "successful_collection": round(succ_amt, 2),
                 "simulated_collection": round(sim_amt, 2), "pending_collection": round(max(0, expected - succ_amt), 2), "failed_transactions": failed,
                 "unmatched_transactions": unmatched, "open_exceptions": open_exc, "outstanding_amount": round(d["out"], 2),
                 "verified_payments": verified, "collection_efficiency": round(succ_amt / expected * 100, 1) if expected else 0},
        "daily": [{"date": x["_id"], "amount": x["amount"], "success": x["success"], "failed": x["failed"]} for x in daily],
        "monthly": [{"month": x["_id"], "amount": x["amount"], "count": x["count"]} for x in monthly],
        "cities": sorted(cmap.values(), key=lambda c: -c.get("collected", 0)),
        "reconciliation": [{"status": x["_id"] or "UNMATCHED", "count": x["count"]} for x in recon],
        "status_split": [{"status": x["_id"], "count": x["count"]} for x in status_split],
        "demo_data": bool(has_demo),
    }


@router.get("/payment-requests")
async def list_requests(q: str | None = None, status: str | None = None, city: str | None = None, provider: str | None = None,
                        method: str | None = None, date_from: str | None = None, date_to: str | None = None, page: int = 1, size: int = 25,
                        member: dict = Depends(require_role(*STAFF))):
    lo, hi = date_range(date_from, date_to, default_days=3650)
    query = {"created_at": {"$gte": lo, "$lt": hi}, **(await _scope(member, city, None)),
             **_search(q, ["id", "driver_name", "vehicle_reg", "internal_ref", "utr", "claimed_utr", "driver_id"])}
    for k, v in (("status", status), ("provider", provider), ("method", method)):
        if v:
            query[k] = v
    return await paginate("payment_requests", query, [("created_at", -1)], page, size)


@router.get("/payment-requests/{pid}")
async def request_detail(pid: str, member: dict = Depends(require_role(*STAFF))):
    req = await db.payment_requests.find_one({"id": pid, **city_scope(member)}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    find = lambda coll, q, s="created_at": db[coll].find(q, {"_id": 0}).sort(s, -1).to_list(200)
    return {
        "request": clean(req),
        "transactions": clean(await find("payment_transactions", {"payment_id": pid})),
        "audit": clean(await find("payment_audit_logs", {"entity_id": pid})),
        "myvolt_sync": clean(await find("myvolt_sync_logs", {"payment_id": pid})),
        "evrent_sync": clean(await find("evrent_sync_logs", {"payment_id": pid})),
        "webhooks": clean(await find("payment_webhooks", {"payload.internal_ref": req["internal_ref"]}, "received_at")),
        "exceptions": clean(await find("unmatched_transactions", {"payment_id": pid})),
        "receipt": clean(await db.payment_receipts.find_one({"payment_id": pid}, {"_id": 0})),
    }


class AdminCreate(BaseModel):
    driver_id: str
    method: str = "UPI_QR"
    provider: str | None = None
    amount: float | None = None


@router.post("/payment-requests")
async def admin_create(body: AdminCreate, member: dict = Depends(require_role(*FINANCE))):
    drv = await db.drivers.find_one({"id": body.driver_id}, {"_id": 0})
    if not drv:
        raise HTTPException(404, "Driver not found")
    req = await create_payment_request(driver_id=body.driver_id, vehicle_id=drv.get("vehicle_id", ""), amount=body.amount, method=body.method,
                                       provider_code=body.provider, client_id="ADMIN-CONSOLE", idempotency_key=None, actor=member)
    return clean(req)


class Simulate(BaseModel):
    outcome: str = Field(pattern="^(success|failed|wrong_amount|duplicate_callback|reversal|refund)$")
    utr: str | None = None


@router.post("/payment-requests/{pid}/simulate")
async def simulate(pid: str, body: Simulate, member: dict = Depends(require_role(*FINANCE))):
    """Sends a SIGNED callback through the real verification engine, using the MOCK provider only."""
    req = await db.payment_requests.find_one({"id": pid}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    if req["provider"] != "MOCK":
        raise HTTPException(422, "Simulation is only available for MOCK provider requests")
    mock = get_provider("MOCK")
    if body.outcome == "duplicate_callback":
        raw = (req.get("last_sim_event") or "").encode()
        if not raw:
            raise HTTPException(409, "No previous simulated callback to repeat")
    else:
        evt = {"event_id": new_id("EVT"), "event_type": {"reversal": "REVERSAL", "refund": "REFUND"}.get(body.outcome, "PAYMENT"),
               "status": "FAILED" if body.outcome == "failed" else "SUCCESS", "internal_ref": req["internal_ref"],
               "provider_txn_id": new_id("MOCKTXN"), "merchant_id": mock.merchant_id(), "payer_vpa": "driver@simulated",
               "amount": req["amount_requested"] + (37 if body.outcome == "wrong_amount" else 0),
               "utr": body.utr or ("".join(str((ord(c) * 7) % 10) for c in new_id("U")[2:14])), "timestamp": now().isoformat()}
        if body.outcome in ("reversal", "refund"):
            evt["original_txn_id"] = req.get("provider_txn_id")
            evt["utr"] = req.get("utr")
        raw = json.dumps(evt).encode()
        await db.payment_requests.update_one({"id": pid}, {"$set": {"last_sim_event": raw.decode()}})
    await audit(member, "SIMULATED_CALLBACK_SENT", "payment_request", pid, reason=body.outcome)
    code, result = await process_callback("MOCK", raw, {"x-mock-signature": mock.sign(raw)})
    return {"http_status": code, "result": result, "simulated": True}


@router.get("/transactions")
async def list_txns(q: str | None = None, status: str | None = None, city: str | None = None, provider: str | None = None,
                    kind: str | None = None, method: str | None = None, reconciliation_status: str | None = None,
                    date_from: str | None = None, date_to: str | None = None, page: int = 1, size: int = 25,
                    member: dict = Depends(require_role(*STAFF))):
    lo, hi = date_range(date_from, date_to, default_days=3650)
    query = {"created_at": {"$gte": lo, "$lt": hi}, **(await _scope(member, city, None)),
             **_search(q, ["id", "payment_id", "driver_name", "vehicle_reg", "utr", "provider_txn_id"])}
    for k, v in (("status", status), ("provider", provider), ("kind", kind), ("method", method), ("reconciliation_status", reconciliation_status)):
        if v:
            query[k] = v
    return await paginate("payment_transactions", query, [("created_at", -1)], page, size)


@router.get("/receipts/{receipt_no}")
async def receipt(receipt_no: str, member: dict = Depends(require_role(*STAFF))):
    r = await db.payment_receipts.find_one({"receipt_no": receipt_no, **city_scope(member)}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Not found")
    return {"receipt": clean(r), "settings": clean(await get_settings())}


@router.get("/drivers")
async def list_drivers(q: str | None = None, city: str | None = None, status: str | None = None, page: int = 1, size: int = 25,
                       member: dict = Depends(require_role(*STAFF))):
    query = {**(await _scope(member, city, None)), **_search(q, ["id", "name", "vehicle_reg", "external_id"])}
    if status:
        query["status"] = status
    res = await paginate("drivers", query, [("name", 1)], page, size)
    for d in res["items"]:
        d["payable"] = payable_for(d)
    return res


@router.get("/drivers/{driver_id}")
async def driver_detail(driver_id: str, member: dict = Depends(require_role(*STAFF))):
    d = await db.drivers.find_one({"id": driver_id, **city_scope(member)}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    reqs = await db.payment_requests.find({"driver_id": driver_id}, {"_id": 0}).sort("created_at", -1).to_list(30)
    return {"driver": clean(d), "payable": payable_for(d), "requests": clean(reqs)}


@router.get("/vehicles")
async def list_vehicles(q: str | None = None, city: str | None = None, status: str | None = None, page: int = 1, size: int = 25,
                        member: dict = Depends(require_role(*STAFF))):
    query = {**(await _scope(member, city, None)), **_search(q, ["id", "registration_no", "driver_name", "model"])}
    if status:
        query["status"] = status
    return await paginate("vehicles", query, [("registration_no", 1)], page, size)


@router.get("/lookups")
async def lookups(member: dict = Depends(require_role(*STAFF))):
    cities = await db.drivers.distinct("city", city_scope(member))
    sups = await db.users.find({"role": "supervisor"}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "cities": 1}).to_list(500)
    return {"cities": sorted(cities), "supervisors": sups}
