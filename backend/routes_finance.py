import io
import csv
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import db, now, clean, paginate, date_range, audit, IST
from rbac import require_role, city_scope, STAFF, FINANCE
from engine import record_success, CLAIMABLE
from recon import read_table, import_statement, run_reconciliation, TARGET_FIELDS
from routes_admin import _search
import sync

router = APIRouter(prefix="/api")
MAX_UPLOAD = 15 * 1024 * 1024
OPERATIONAL_TYPES = {"DRIVER_DISPUTE", "FAILED_PAYMENT", "DELAYED_CONFIRMATION", "MYVOLT_SYNC_FAILED"}

GUESS = {"utr": ["utr", "rrn", "reference", "ref no", "upi ref", "bank ref"], "amount": ["amount", "txn amount", "transaction amount"],
         "txn_time": ["date", "time", "txn date", "transaction date", "value date"], "payer_vpa": ["vpa", "payer vpa", "upi id"],
         "payer_name": ["payer", "payer name", "remitter", "name"], "description": ["description", "narration", "remarks", "particulars"],
         "direction": ["dr/cr", "type", "cr/dr", "direction"], "credit_amount": ["credit", "deposit", "cr amount"],
         "debit_amount": ["debit", "withdrawal", "dr amount"]}


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 15 MB)")
    return content


@router.post("/bank/preview")
async def bank_preview(file: UploadFile = File(...), member: dict = Depends(require_role(*FINANCE))):
    rows = read_table(file.filename or "", await _read_upload(file))
    headers = list(rows[0].keys()) if rows else []
    suggested = {}
    for field, keys in GUESS.items():
        for h in headers:
            if h.strip().lower() in keys:
                suggested[field] = h
                break
    return {"headers": headers, "sample": [{k: str(v) for k, v in r.items()} for r in rows[:5]], "row_count": len(rows),
            "suggested_mapping": suggested, "target_fields": TARGET_FIELDS}


@router.post("/bank/import")
async def bank_import(file: UploadFile = File(...), mapping: str = Form(...), source: str = Form("KOTAK_STATEMENT"),
                      save_preset: str = Form(""), member: dict = Depends(require_role(*FINANCE))):
    try:
        mp = json.loads(mapping)
    except ValueError:
        raise HTTPException(422, "Invalid mapping")
    if save_preset:
        await db.system_settings.update_one({"id": "global"}, {"$set": {f"column_mapping_presets.{save_preset[:40]}": mp}})
    return await import_statement(file.filename or "", await _read_upload(file), mp, source[:40], member)


@router.get("/bank/transactions")
async def bank_list(q: str | None = None, recon_status: str | None = None, entry_type: str | None = None, date_from: str | None = None,
                    date_to: str | None = None, page: int = 1, size: int = 25, member: dict = Depends(require_role(*FINANCE))):
    lo, hi = date_range(date_from, date_to, default_days=3650)
    query = {"txn_time": {"$gte": lo, "$lt": hi}, **_search(q, ["utr", "payer_name", "payer_vpa", "description", "id"])}
    for k, v in (("recon_status", recon_status), ("entry_type", entry_type)):
        if v:
            query[k] = v
    return await paginate("bank_transactions", query, [("txn_time", -1)], page, size)


@router.post("/reconciliation/run")
async def recon_run(member: dict = Depends(require_role(*FINANCE))):
    return await run_reconciliation(member)


@router.get("/reconciliation/runs")
async def recon_runs(page: int = 1, size: int = 20, member: dict = Depends(require_role(*FINANCE))):
    return await paginate("bank_reconciliation", {"record_type": "RUN"}, [("created_at", -1)], page, size)


@router.get("/reconciliation/items")
async def recon_items(run_id: str | None = None, status: str | None = None, page: int = 1, size: int = 25,
                      member: dict = Depends(require_role(*FINANCE))):
    q = {"record_type": "ITEM", **({"run_id": run_id} if run_id else {}), **({"status": status} if status else {})}
    return await paginate("bank_reconciliation", q, [("created_at", -1)], page, size)


@router.get("/reconciliation/summary")
async def recon_summary(member: dict = Depends(require_role(*FINANCE))):
    bank = await db.bank_transactions.aggregate([{"$match": {"entry_type": "TRANSACTION"}},
                                                 {"$group": {"_id": "$recon_status", "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}}]).to_list(50)
    sysr = await db.payment_transactions.aggregate([{"$match": {"kind": "PAYMENT", "status": "SUCCESS"}},
                                                    {"$group": {"_id": "$reconciliation_status", "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}}]).to_list(50)
    f = lambda rows: [{"status": r["_id"], "count": r["count"], "amount": round(r["amount"], 2)} for r in rows]
    return {"bank": f(bank), "system": f(sysr)}


@router.get("/settlements")
async def settlements(status: str | None = None, page: int = 1, size: int = 25, member: dict = Depends(require_role(*FINANCE))):
    return await paginate("settlement_records", {"status": status} if status else {}, [("settlement_time", -1)], page, size)


# ---------- Exceptions (unmatched_transactions) ----------
@router.get("/exceptions")
async def exceptions(status: str | None = None, type: str | None = None, city: str | None = None, q: str | None = None,
                     page: int = 1, size: int = 25, member: dict = Depends(require_role(*STAFF))):
    query = {**city_scope(member), **_search(q, ["id", "payment_id", "bank_txn_id", "details"])}
    if city and member["role"] != "supervisor":
        query["city"] = city
    if status == "ACTIVE":
        query["status"] = {"$ne": "RESOLVED"}
    elif status:
        query["status"] = status
    if type:
        query["type"] = type
    res = await paginate("unmatched_transactions", query, [("created_at", -1)], page, size)
    counts = await db.unmatched_transactions.aggregate([{"$match": {**city_scope(member), "status": {"$ne": "RESOLVED"}}},
                                                        {"$group": {"_id": "$type", "n": {"$sum": 1}}}]).to_list(50)
    res["open_by_type"] = {c["_id"]: c["n"] for c in counts}
    return res


async def _exc(eid: str, member: dict) -> dict:
    e = await db.unmatched_transactions.find_one({"id": eid, **city_scope(member)}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Not found")
    return e


@router.get("/exceptions/{eid}")
async def exception_detail(eid: str, member: dict = Depends(require_role(*STAFF))):
    e = await _exc(eid, member)
    btx = await db.bank_transactions.find_one({"id": e["bank_txn_id"]}, {"_id": 0, "raw": 0}) if e.get("bank_txn_id") else None
    req = await db.payment_requests.find_one({"id": e["payment_id"]}, {"_id": 0}) if e.get("payment_id") else None
    candidates = []
    if btx and btx.get("utr") and member["role"] != "supervisor":
        candidates = await db.payment_requests.find({"claimed_utr": btx["utr"]}, {"_id": 0}).to_list(10)
    return clean({"exception": e, "bank_transaction": btx, "payment_request": req, "utr_candidates": candidates})


class Comment(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/exceptions/{eid}/comments")
async def add_comment(eid: str, body: Comment, member: dict = Depends(require_role(*STAFF))):
    await _exc(eid, member)
    c = {"by": member["email"], "role": member["role"], "text": body.text, "at": now()}
    await db.unmatched_transactions.update_one({"id": eid}, {"$push": {"comments": c}, "$set": {"updated_at": now()}})
    await audit(member, "EXCEPTION_COMMENT", "exception", eid, reason=body.text[:200])
    return clean(c)


class Escalate(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/exceptions/{eid}/escalate")
async def escalate(eid: str, body: Escalate, member: dict = Depends(require_role(*STAFF))):
    e = await _exc(eid, member)
    if e["status"] == "RESOLVED":
        raise HTTPException(409, "Already resolved")
    await db.unmatched_transactions.update_one({"id": eid}, {"$set": {"status": "ESCALATED", "escalated_by": member["email"], "updated_at": now()},
                                                             "$push": {"comments": {"by": member["email"], "role": member["role"],
                                                                                    "text": f"ESCALATED: {body.reason}", "at": now()}}})
    await audit(member, "EXCEPTION_ESCALATED", "exception", eid, e["status"], "ESCALATED", body.reason)
    return {"ok": True}


class Resolve(BaseModel):
    action: str = Field(pattern="^(LINK_TO_PAYMENT|RETRY_SYNC|CLOSE_NO_ACTION)$")
    reason: str = Field(min_length=5, max_length=1000)
    evidence_ref: str | None = Field(default=None, max_length=300)
    payment_id: str | None = None


@router.post("/exceptions/{eid}/resolve")
async def resolve(eid: str, body: Resolve, member: dict = Depends(require_role(*STAFF))):
    e = await _exc(eid, member)
    if e["status"] == "RESOLVED":
        raise HTTPException(409, "Already resolved")
    is_sup = member["role"] == "supervisor"
    if is_sup and (body.action == "LINK_TO_PAYMENT" or e["type"] not in OPERATIONAL_TYPES):
        raise HTTPException(403, "Supervisors can only resolve operational exceptions; escalate this one to Finance")
    outcome = {}
    if body.action == "LINK_TO_PAYMENT":
        if not body.evidence_ref or not body.payment_id or not e.get("bank_txn_id"):
            raise HTTPException(422, "Linking requires a bank transaction, a payment request and an evidence reference")
        btx = await db.bank_transactions.find_one({"id": e["bank_txn_id"]}, {"_id": 0})
        if not btx or not btx.get("utr") or btx["direction"] != "CREDIT" or btx.get("matched_transaction_id"):
            raise HTTPException(422, "Bank transaction must be an unassigned credit with a bank UTR")
        req = await db.payment_requests.find_one({"id": body.payment_id}, {"_id": 0})
        if not req or req["status"] not in CLAIMABLE:
            raise HTTPException(422, "Payment request not found or not open for confirmation")
        if req.get("is_simulated"):
            raise HTTPException(422, "Real bank credits cannot be linked to SIMULATED (mock provider) requests")
        if round(req["amount_requested"], 2) != round(btx["amount"], 2):
            raise HTTPException(422, "Bank amount does not equal the payable amount; cannot link")
        outcome = await record_success(req, amount=btx["amount"], provider=req["provider"], provider_txn_id=f"BANK-{btx['utr']}",
                                       utr=btx["utr"], payer_vpa=btx.get("payer_vpa"), source="MANUAL_RESOLUTION",
                                       is_simulated=False, actor=member, reason=body.reason, evidence_ref=body.evidence_ref,
                                       recon_status="MATCHED")
        if outcome["outcome"] != "SUCCESS":
            raise HTTPException(409, f"Could not credit: {outcome['outcome']}")
        await db.bank_transactions.update_one({"id": btx["id"]}, {"$set": {"recon_status": "MATCHED", "matched_payment_id": req["id"],
                                                                           "matched_transaction_id": outcome["transaction_id"]}})
    elif body.action == "RETRY_SYNC":
        logs = await db.myvolt_sync_logs.find({"transaction_id": e.get("transaction_id"), "status": "SYNC_FAILED"}, {"_id": 0}).to_list(10)
        if not logs:
            raise HTTPException(422, "No failed sync found for this exception")
        for lg in logs:
            await sync.retry_now("myvolt_sync_logs", lg["id"], member)
    resolution = {"action": body.action, "by": member["email"], "user_id": member["user_id"], "at": now(), "before_status": e["status"],
                  "after_status": "RESOLVED", "reason": body.reason, "evidence_ref": body.evidence_ref, "payment_id": body.payment_id,
                  "outcome": outcome}
    await db.unmatched_transactions.update_one({"id": eid}, {"$set": {"status": "RESOLVED", "resolution": resolution, "updated_at": now()}})
    await audit(member, "EXCEPTION_RESOLVED", "exception", eid, e["status"], "RESOLVED", body.reason, body.evidence_ref,
                meta={"action": body.action, "payment_id": body.payment_id})
    return clean(resolution)


# ---------- Reports ----------
IST_DAY = {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at", "timezone": "Asia/Kolkata"}}
IST_MONTH = {"$dateToString": {"format": "%Y-%m", "date": "$created_at", "timezone": "Asia/Kolkata"}}
GROUP_COLS = [("key", "Group"), ("count", "Payments"), ("amount", "Amount (INR)"), ("simulated_amount", "Simulated (INR)")]
LIST_TXN = [("created_at", "Time"), ("id", "Transaction"), ("payment_id", "Payment"), ("driver_name", "Driver"), ("vehicle_reg", "Vehicle"),
            ("city", "City"), ("provider", "Provider"), ("utr", "UTR"), ("status", "Status"), ("amount", "Amount (INR)")]
REPORTS = {
    "daily_collection": "Daily collection", "monthly_collection": "Monthly collection", "city_collection": "City-wise collection",
    "vehicle_collection": "Vehicle-wise collection", "driver_payments": "Driver-wise payments", "pending_collection": "Pending collection",
    "outstanding_rental": "Outstanding rental", "bank_reconciliation": "Bank reconciliation", "unmatched_payments": "Unmatched payments",
    "failed_transactions": "Failed transactions", "reversal_refund": "Reversals & refunds", "provider_transactions": "Provider-wise transactions",
    "settlement": "Settlement report",
}


async def _group(match: dict, key) -> list[dict]:
    rows = await db.payment_transactions.aggregate([
        {"$match": match}, {"$group": {"_id": key, "count": {"$sum": 1}, "amount": {"$sum": "$amount"},
                                       "simulated_amount": {"$sum": {"$cond": ["$is_simulated", "$amount", 0]}}}}, {"$sort": {"_id": 1}}]).to_list(10000)
    return [{"key": r["_id"], "count": r["count"], "amount": round(r["amount"], 2), "simulated_amount": round(r["simulated_amount"], 2)} for r in rows]


async def build_report(rtype: str, date_from, date_to, city) -> tuple[list, list]:
    lo, hi = date_range(date_from, date_to, default_days=30)
    base = {"created_at": {"$gte": lo, "$lt": hi}, **({"city": city} if city else {})}
    paid = {**base, "kind": "PAYMENT", "status": "SUCCESS"}
    find = lambda coll, q, s, n=5000: db[coll].find(q, {"_id": 0}).sort(s, -1).to_list(n)
    if rtype == "daily_collection":
        return GROUP_COLS, await _group(paid, IST_DAY)
    if rtype == "monthly_collection":
        return GROUP_COLS, await _group(paid, IST_MONTH)
    if rtype == "city_collection":
        return GROUP_COLS, await _group(paid, "$city")
    if rtype == "vehicle_collection":
        return GROUP_COLS, await _group(paid, "$vehicle_reg")
    if rtype == "driver_payments":
        return GROUP_COLS, await _group(paid, "$driver_name")
    if rtype == "provider_transactions":
        rows = await db.payment_transactions.aggregate([{"$match": base}, {"$group": {"_id": {"p": "$provider", "s": "$status"},
                                                                                      "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}},
                                                        {"$sort": {"_id.p": 1}}]).to_list(1000)
        return [("provider", "Provider"), ("status", "Status"), ("count", "Count"), ("amount", "Amount (INR)")], \
            [{"provider": r["_id"]["p"], "status": r["_id"]["s"], "count": r["count"], "amount": round(r["amount"], 2)} for r in rows]
    if rtype == "failed_transactions":
        return LIST_TXN, await find("payment_transactions", {**base, "status": {"$in": ["FAILED", "AMOUNT_MISMATCH", "DUPLICATE"]}}, "created_at")
    if rtype == "reversal_refund":
        return LIST_TXN, await find("payment_transactions", {**base, "kind": {"$in": ["REVERSAL", "REFUND"]}}, "created_at")
    if rtype == "pending_collection":
        cols = [("created_at", "Created"), ("id", "Payment"), ("driver_name", "Driver"), ("vehicle_reg", "Vehicle"), ("city", "City"),
                ("provider", "Provider"), ("status", "Status"), ("total_payable", "Payable (INR)")]
        return cols, await find("payment_requests", {**base, "status": {"$in": ["INITIATED", "PENDING", "EXPIRED", "FAILED"]}}, "created_at")
    if rtype == "outstanding_rental":
        cols = [("id", "Driver ID"), ("name", "Driver"), ("vehicle_reg", "Vehicle"), ("city", "City"), ("daily_rent", "Daily rent (INR)"),
                ("outstanding_amount", "Outstanding (INR)")]
        return cols, await find("drivers", {"outstanding_amount": {"$gt": 0}, **({"city": city} if city else {})}, "outstanding_amount")
    if rtype == "bank_reconciliation":
        rows = await db.bank_transactions.aggregate([{"$match": {"txn_time": {"$gte": lo, "$lt": hi}}},
                                                     {"$group": {"_id": {"t": "$entry_type", "s": "$recon_status"}, "count": {"$sum": 1},
                                                                 "amount": {"$sum": "$amount"}}}]).to_list(100)
        return [("entry_type", "Entry type"), ("status", "Reconciliation status"), ("count", "Rows"), ("amount", "Amount (INR)")], \
            [{"entry_type": r["_id"]["t"], "status": r["_id"]["s"], "count": r["count"], "amount": round(r["amount"], 2)} for r in rows]
    if rtype == "unmatched_payments":
        cols = [("created_at", "Created"), ("id", "Exception"), ("type", "Type"), ("status", "Status"), ("city", "City"),
                ("payment_id", "Payment"), ("bank_txn_id", "Bank txn"), ("amount", "Amount (INR)"), ("details", "Details")]
        return cols, await find("unmatched_transactions", base, "created_at")
    if rtype == "settlement":
        cols = [("settlement_time", "Settlement time"), ("reference", "Reference"), ("amount", "Credited (INR)"),
                ("expected_amount", "Expected (INR)"), ("difference", "Difference (INR)"), ("transaction_count", "Txns"), ("status", "Status")]
        return cols, await find("settlement_records", {"settlement_time": {"$gte": lo, "$lt": hi}}, "settlement_time")
    raise HTTPException(404, "Unknown report")


def _fmt(v):
    if hasattr(v, "astimezone"):
        return v.astimezone(IST).strftime("%Y-%m-%d %H:%M")
    return "" if v is None else v


@router.get("/reports")
async def report_list(member: dict = Depends(require_role(*FINANCE))):
    return [{"type": k, "name": v} for k, v in REPORTS.items()]


@router.get("/reports/{rtype}")
async def report(rtype: str, date_from: str | None = None, date_to: str | None = None, city: str | None = None, format: str = "json",
                 member: dict = Depends(require_role(*FINANCE))):
    cols, rows = await build_report(rtype, date_from, date_to, city)
    table = [[_fmt(r.get(k)) for k, _ in cols] for r in rows]
    if format == "json":
        return {"name": REPORTS[rtype], "columns": [{"key": k, "label": lbl} for k, lbl in cols],
                "rows": [dict(zip([k for k, _ in cols], t)) for t in table]}
    await audit(member, "REPORT_EXPORTED", "report", rtype, meta={"format": format, "from": date_from, "to": date_to, "city": city})
    fname = f"rupay39_{rtype}_{date_from or 'last30'}_{date_to or 'today'}"
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([lbl for _, lbl in cols])
        w.writerows(table)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'})
    if format == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = REPORTS[rtype][:30]
        ws.append([lbl for _, lbl in cols])
        for t in table:
            ws.append(t)
        for i, (k, _) in enumerate(cols, 1):
            if "amount" in k or k in ("difference", "daily_rent", "total_payable", "outstanding_amount"):
                for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
                    for c in row:
                        c.number_format = '[$₹-4009] #,##,##0.00'
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}.xlsx"'})
    raise HTTPException(422, "format must be json, csv or xlsx")
