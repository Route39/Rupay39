"""Bank statement import + reconciliation. Matching uses ONLY bank UTR references, never amount/time similarity."""
import io
import csv
import hashlib
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core import db, now, new_id, audit, get_settings, IST
from engine import record_success, create_exception

TARGET_FIELDS = ["utr", "amount", "txn_time", "payer_vpa", "payer_name", "description", "direction", "credit_amount", "debit_amount"]


def read_table(filename: str, content: bytes) -> list[dict]:
    name = filename.lower()
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        rows = list(wb.active.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h).strip() if h is not None else f"col{i}" for i, h in enumerate(rows[0])]
        return [{headers[i]: ("" if v is None else v) for i, v in enumerate(r) if i < len(headers)} for r in rows[1:] if any(r)]
    if name.endswith(".csv"):
        text = content.decode("utf-8-sig", errors="replace")
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(io.StringIO(text))]
    raise HTTPException(422, "Only .csv and .xlsx files are supported")


def _amount(v) -> float | None:
    if v in (None, ""):
        return None
    try:
        return round(float(str(v).replace(",", "").replace("₹", "").replace("INR", "").strip()), 2)
    except ValueError:
        return None


def _time(v):
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=IST)).astimezone(timezone.utc)
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
                "%d-%m-%Y %H:%M", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=IST).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def normalise(row: dict, mapping: dict, keywords: list[str]) -> dict:
    get = lambda f: row.get(mapping.get(f) or "", "") if mapping.get(f) else ""
    credit, debit = _amount(get("credit_amount")), _amount(get("debit_amount"))
    amount = _amount(get("amount"))
    direction = str(get("direction")).strip().upper()
    if credit:
        amount, direction = credit, "CREDIT"
    elif debit:
        amount, direction = debit, "DEBIT"
    direction = "DEBIT" if direction.startswith(("D", "DR")) else "CREDIT"
    desc = str(get("description"))
    utr = "".join(ch for ch in str(get("utr")) if ch.isalnum()) or None
    is_settlement = any(k.upper() in desc.upper() for k in keywords if k)
    return {"utr": utr, "amount": amount, "txn_time": _time(get("txn_time")), "payer_vpa": str(get("payer_vpa")) or None,
            "payer_name": str(get("payer_name")) or None, "description": desc, "direction": direction,
            "entry_type": "SETTLEMENT" if is_settlement else "TRANSACTION"}


async def import_statement(filename: str, content: bytes, mapping: dict, source: str, actor: dict) -> dict:
    if not mapping.get("amount") and not mapping.get("credit_amount"):
        raise HTTPException(422, "Map at least the amount or credit column")
    settings = await get_settings()
    rows = read_table(filename, content)
    import_id = new_id("IMP")
    stats = {"import_id": import_id, "rows": len(rows), "imported": 0, "skipped_duplicate_rows": 0, "invalid": 0, "settlements": 0}
    for raw in rows:
        n = normalise(raw, mapping, settings["settlement_keywords"])
        if n["amount"] is None or n["txn_time"] is None:
            stats["invalid"] += 1
            continue
        row_hash = hashlib.sha256(f"{n['utr']}|{n['amount']}|{n['txn_time'].isoformat()}|{n['direction']}|{n['description']}".encode()).hexdigest()
        doc = {"id": new_id("BTX"), "import_id": import_id, "source": source, "row_hash": row_hash, **n,
               "recon_status": "UNDER_REVIEW" if n["entry_type"] == "TRANSACTION" else "SETTLEMENT", "matched_payment_id": None,
               "matched_transaction_id": None, "raw": {k: str(v) for k, v in raw.items()}, "imported_at": now()}
        try:
            await db.bank_transactions.insert_one(doc)
        except DuplicateKeyError:
            stats["skipped_duplicate_rows"] += 1
            continue
        stats["imported"] += 1
        if n["entry_type"] == "SETTLEMENT" and n["direction"] == "CREDIT":
            stats["settlements"] += 1
            await db.settlement_records.insert_one({"id": new_id("STL"), "bank_txn_id": doc["id"], "amount": n["amount"],
                                                    "settlement_time": n["txn_time"], "description": n["description"],
                                                    "reference": n["utr"], "status": "UNRECONCILED", "created_at": now()})
    await audit(actor, "BANK_STATEMENT_IMPORTED", "bank_import", import_id, meta={**stats, "filename": filename})
    stats["reconciliation"] = await run_reconciliation(actor, import_id=import_id)
    return stats


async def _item(run_id, btx, status, payment_id=None, txn_id=None, note=""):
    await db.bank_reconciliation.insert_one({"id": new_id("REC"), "record_type": "ITEM", "run_id": run_id, "bank_txn_id": btx["id"] if btx else None,
                                             "payment_id": payment_id, "transaction_id": txn_id, "status": status, "note": note,
                                             "utr": btx.get("utr") if btx else None, "amount": btx.get("amount") if btx else None,
                                             "created_at": now()})


async def _set_btx(btx, status, payment_id=None, txn_id=None):
    await db.bank_transactions.update_one({"id": btx["id"]}, {"$set": {"recon_status": status, "matched_payment_id": payment_id,
                                                                        "matched_transaction_id": txn_id, "reconciled_at": now()}})


async def reconcile_bank_row(btx: dict, run_id: str, actor: dict | None) -> str:
    utr = btx.get("utr")
    if btx["direction"] != "CREDIT":
        await _set_btx(btx, "MATCHED")
        return "SKIPPED_DEBIT"
    if not utr:
        await _set_btx(btx, "UNMATCHED")
        await create_exception("UNMATCHED_BANK_TXN", amount=btx["amount"], bank_txn_id=btx["id"],
                               details="Bank credit without UTR reference - cannot be assigned automatically", dedupe_key=f"btx:{btx['id']}")
        await _item(run_id, btx, "UNMATCHED", note="No UTR")
        return "UNMATCHED"
    dup = await db.bank_transactions.find_one({"utr": utr, "direction": "CREDIT", "entry_type": "TRANSACTION", "id": {"$ne": btx["id"]},
                                               "recon_status": {"$ne": "DUPLICATE"}, "imported_at": {"$lt": btx["imported_at"]}})
    if dup:
        await _set_btx(btx, "DUPLICATE")
        await create_exception("DUPLICATE_TRANSACTION", amount=btx["amount"], bank_txn_id=btx["id"],
                               details=f"UTR {utr} appears more than once in bank records", dedupe_key=f"btxdup:{btx['id']}")
        await _item(run_id, btx, "DUPLICATE", note=f"Duplicate of {dup['id']}")
        return "DUPLICATE"
    txn = await db.payment_transactions.find_one({"utr": utr, "kind": "PAYMENT"}, {"_id": 0})
    if txn:
        if round(txn["amount"], 2) == round(btx["amount"], 2):
            await _set_btx(btx, "MATCHED", txn["payment_id"], txn["id"])
            await db.payment_transactions.update_one({"id": txn["id"]}, {"$set": {"reconciliation_status": "MATCHED", "bank_txn_id": btx["id"]}})
            await db.payment_requests.update_one({"id": txn["payment_id"]}, {"$set": {"reconciliation_status": "MATCHED"}})
            await _item(run_id, btx, "MATCHED", txn["payment_id"], txn["id"])
            return "MATCHED"
        await _set_btx(btx, "AMOUNT_MISMATCH", txn["payment_id"], txn["id"])
        await db.payment_transactions.update_one({"id": txn["id"]}, {"$set": {"reconciliation_status": "AMOUNT_MISMATCH"}})
        await create_exception("AMOUNT_MISMATCH", city=txn["city"], payment_id=txn["payment_id"], bank_txn_id=btx["id"], amount=btx["amount"],
                               details=f"Bank {btx['amount']:.2f} vs system {txn['amount']:.2f} for UTR {utr}", dedupe_key=f"btxamt:{btx['id']}")
        await _item(run_id, btx, "AMOUNT_MISMATCH", txn["payment_id"], txn["id"])
        return "AMOUNT_MISMATCH"
    claims = await db.payment_requests.find({"claimed_utr": utr, "provider": "STATIC_QR"}, {"_id": 0}).to_list(10)
    if len(claims) > 1:
        await _set_btx(btx, "UNDER_REVIEW")
        await create_exception("AMBIGUOUS_MATCH", amount=btx["amount"], bank_txn_id=btx["id"], city=claims[0]["city"],
                               details=f"UTR {utr} claimed by {len(claims)} requests: " + ", ".join(c["id"] for c in claims),
                               dedupe_key=f"amb:{btx['id']}")
        await _item(run_id, btx, "UNDER_REVIEW", note="Multiple claims")
        return "UNDER_REVIEW"
    if not claims:
        await _set_btx(btx, "MISSING_IN_SYSTEM")
        await create_exception("UNMATCHED_BANK_TXN", amount=btx["amount"], bank_txn_id=btx["id"],
                               details=f"UTR {utr} has no matching payment request or claim", dedupe_key=f"btx:{btx['id']}")
        await _item(run_id, btx, "MISSING_IN_SYSTEM")
        return "MISSING_IN_SYSTEM"
    req = claims[0]
    if round(btx["amount"], 2) != round(req["amount_requested"], 2):
        await _set_btx(btx, "AMOUNT_MISMATCH", req["id"])
        await create_exception("AMOUNT_MISMATCH", city=req["city"], payment_id=req["id"], bank_txn_id=btx["id"], amount=btx["amount"],
                               details=f"Bank {btx['amount']:.2f} vs payable {req['amount_requested']:.2f} for UTR {utr}",
                               dedupe_key=f"btxamt:{btx['id']}", driver_id=req["driver_id"])
        await _item(run_id, btx, "AMOUNT_MISMATCH", req["id"])
        return "AMOUNT_MISMATCH"
    res = await record_success(req, amount=btx["amount"], provider="STATIC_QR", provider_txn_id=f"BANK-{utr}", utr=utr,
                               payer_vpa=btx.get("payer_vpa"), source="BANK_STATEMENT", is_simulated=False, actor=actor,
                               reason="UTR matched on bank statement", evidence_ref=btx["id"], recon_status="MATCHED")
    if res["outcome"] == "SUCCESS":
        await _set_btx(btx, "MATCHED", req["id"], res["transaction_id"])
        await db.payment_transactions.update_one({"id": res["transaction_id"]}, {"$set": {"bank_txn_id": btx["id"]}})
        await _item(run_id, btx, "MATCHED", req["id"], res["transaction_id"])
        return "MATCHED"
    await _set_btx(btx, "DUPLICATE", req["id"])
    await _item(run_id, btx, "DUPLICATE", req["id"], note=res["outcome"])
    return "DUPLICATE"


async def run_reconciliation(actor: dict | None, import_id: str | None = None) -> dict:
    run_id = new_id("RUN")
    q = {"entry_type": "TRANSACTION", "recon_status": "UNDER_REVIEW", "matched_payment_id": None}
    if import_id:
        q["import_id"] = import_id
    counts: dict[str, int] = {}
    async for btx in db.bank_transactions.find(q, {"_id": 0}).sort("imported_at", 1):
        out = await reconcile_bank_row(btx, run_id, actor)
        counts[out] = counts.get(out, 0) + 1
    # Missing in bank: real (non-simulated) callback successes inside the statement window that the bank never reported.
    window = await db.bank_transactions.aggregate([{"$match": {"entry_type": "TRANSACTION"}},
                                                   {"$group": {"_id": None, "lo": {"$min": "$txn_time"}, "hi": {"$max": "$txn_time"}}}]).to_list(1)
    if window and window[0]["lo"]:
        res = await db.payment_transactions.update_many(
            {"kind": "PAYMENT", "status": "SUCCESS", "is_simulated": False, "reconciliation_status": "UNMATCHED",
             "created_at": {"$gte": window[0]["lo"], "$lte": window[0]["hi"]}},
            {"$set": {"reconciliation_status": "MISSING_IN_BANK"}})
        counts["MISSING_IN_BANK"] = res.modified_count
    await _reconcile_settlements()
    summary = {"run_id": run_id, "counts": counts}
    await db.bank_reconciliation.insert_one({"id": run_id, "record_type": "RUN", "import_id": import_id, "counts": counts,
                                             "run_by": (actor or {}).get("email", "system"), "created_at": now()})
    await audit(actor, "RECONCILIATION_RUN", "reconciliation", run_id, meta=summary)
    return summary


async def _reconcile_settlements() -> None:
    """A settlement credit is compared to the sum of individual bank-confirmed credits of the previous business day; never to one driver."""
    async for s in db.settlement_records.find({"status": "UNRECONCILED"}, {"_id": 0}):
        day_end = s["settlement_time"]
        from datetime import timedelta
        lo = day_end - timedelta(days=1)
        agg = await db.bank_transactions.aggregate([
            {"$match": {"entry_type": "TRANSACTION", "direction": "CREDIT", "recon_status": "MATCHED", "txn_time": {"$gte": lo, "$lt": day_end}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}]).to_list(1)
        expected = round(agg[0]["total"], 2) if agg else 0.0
        diff = round(s["amount"] - expected, 2)
        await db.settlement_records.update_one({"id": s["id"]}, {"$set": {
            "expected_amount": expected, "transaction_count": agg[0]["count"] if agg else 0, "difference": diff,
            "status": "RECONCILED" if diff == 0 else "DISCREPANCY", "reconciled_at": now()}})
