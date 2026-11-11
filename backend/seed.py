"""Startup bootstrap: provider config, roles, settings, and (optionally) clearly-labelled DEMO fleet data."""
import os
import random
from datetime import timedelta

from core import db, now, new_id, short_code, ist_today, ist_day_bounds, get_settings, IST, log
from rbac import ROLES, ROLE_LABELS, PERMISSIONS

CITY_META = [("Chennai", "TN", "TN01"), ("Coimbatore", "TN", "TN38"), ("Madurai", "TN", "TN59"), ("Bengaluru", "KA", "KA01"), ("Mysuru", "KA", "KA09")]
RENTS = {"Chennai": 900, "Coimbatore": 850, "Madurai": 800, "Bengaluru": 1000, "Mysuru": 850}


async def bootstrap():
    await get_settings()
    for code, enabled, mode, status, notes in [
        ("MOCK", True, "SIMULATED", "ACTIVE", "Simulated provider for testing. Never real money."),
        ("STATIC_QR", True, "LIVE_MANUAL", "ACTIVE", "Existing Kotak static merchant QR. Confirmed only via bank statement UTR match."),
        ("KOTAK", False, "SANDBOX", "AWAITING_DOCUMENTATION", "Awaiting Kotak API documentation, credentials and production approval."),
    ]:
        await db.payment_provider_config.update_one({"code": code}, {"$setOnInsert": {
            "code": code, "enabled": enabled, "mode": mode, "status": status, "notes": notes, "credentials_encrypted": {}, "created_at": now()}},
            upsert=True)
    for r in ROLES:
        await db.roles.update_one({"code": r}, {"$set": {"code": r, "label": ROLE_LABELS[r], "permissions": PERMISSIONS[r]}}, upsert=True)
    for p in sorted({p for ps in PERMISSIONS.values() for p in ps}):
        await db.permissions.update_one({"code": p}, {"$set": {"code": p}}, upsert=True)
    if os.environ.get("SEED_DEMO_DATA", "").lower() == "true" and not await db.drivers.count_documents({}, limit=1):
        await seed_demo()


def _req_doc(drv, veh, created, status, provider="MOCK"):
    total = drv["daily_rent"]
    return {"id": f"PAY-{created.astimezone(IST).strftime('%Y%m%d')}-{short_code(6)}", "internal_ref": f"R39{short_code(12)}",
            "driver_id": drv["id"], "vehicle_id": veh["id"], "driver_name": drv["name"], "vehicle_reg": veh["registration_no"],
            "city": drv["city"], "rental_amount": total, "outstanding_amount": 0.0, "total_payable": total, "amount_requested": total,
            "is_partial": False, "provider": provider, "method": random.choice(["UPI_QR", "UPI_INTENT"]), "is_simulated": True,
            "status": status, "reconciliation_status": "MATCHED" if status == "SUCCESS" else "UNMATCHED",
            "sync_status": "SYNCED" if status == "SUCCESS" else "NOT_SYNCED", "utr": None, "claimed_utr": None, "provider_txn_id": None,
            "client_id": "DEMO-SEED", "created_at": created, "expires_at": created + timedelta(minutes=30), "confirmed_at": None,
            "late_confirmation": False, "receipt_no": None, "demo": True,
            "instructions": {"type": "UPI_QR", "simulated": True, "note": "DEMO seed record"}}


async def seed_demo():
    random.seed(39)
    drivers, vehicles = [], []
    n = 0
    for city, state, prefix in CITY_META:
        for _ in range(12 if city in ("Chennai", "Bengaluru") else 8):
            n += 1
            did, vid = f"DRV-{n:04d}", f"VEH-{n:04d}"
            reg = f"{prefix}{random.choice('ABCDEFGHJK')}{random.choice('ABCDEFGHJK')}{random.randint(1000, 9999)}"
            outstanding = random.choice([0, 0, 0, 0, 300, 450, 900, 150])
            drivers.append({"id": did, "external_id": f"MV-DEMO-{n:04d}", "name": f"Route39 Driver {n:03d}", "phone_masked": f"+91 9XXXXX{n:04d}",
                            "city": city, "state": state, "vehicle_id": vid, "vehicle_reg": reg, "daily_rent": float(RENTS[city]),
                            "outstanding_amount": float(outstanding), "status": "ACTIVE", "source": "DEMO", "rent_paid_for": None,
                            "created_at": now()})
            vehicles.append({"id": vid, "registration_no": reg, "city": city, "state": state, "driver_id": did, "driver_name": f"Route39 Driver {n:03d}",
                             "model": random.choice(["E-Auto L5M", "E-Auto L5N"]), "status": "ACTIVE", "source": "DEMO", "created_at": now()})
    await db.drivers.insert_many([dict(d) for d in drivers])
    await db.vehicles.insert_many([dict(v) for v in vehicles])
    reqs, txns, receipts = [], [], []
    today = ist_today()
    for back in range(60, -1, -1):
        day = today - timedelta(days=back)
        start, _ = ist_day_bounds(day)
        for drv, veh in zip(drivers, vehicles):
            roll = random.random()
            if back == 0 and roll > 0.55:
                continue
            created = start + timedelta(hours=random.randint(6, 20), minutes=random.randint(0, 59))
            if back == 0 and created > now():
                created = now() - timedelta(minutes=random.randint(5, 120))
            if roll < 0.80 or back == 0:
                status = "SUCCESS"
            elif roll < 0.86:
                status = "FAILED"
            else:
                status = "EXPIRED"
            r = _req_doc(drv, veh, created, status)
            if status in ("SUCCESS", "FAILED"):
                t = {"id": new_id("TXN"), "payment_id": r["id"], "kind": "PAYMENT", "provider": "MOCK", "provider_txn_id": new_id("MOCKTXN"),
                     "amount": r["total_payable"], "status": status, "source": "CALLBACK", "is_simulated": True, "payer_vpa": "driver@simulated",
                     "driver_id": drv["id"], "driver_name": drv["name"], "vehicle_reg": veh["registration_no"], "city": drv["city"],
                     "method": r["method"], "reconciliation_status": "MATCHED" if status == "SUCCESS" else "UNMATCHED",
                     "myvolt_sync_status": "SYNCED" if status == "SUCCESS" else "NOT_SYNCED", "created_at": created + timedelta(seconds=40),
                     "demo": True}
                if status == "SUCCESS":
                    t["utr"] = f"9{random.randint(10**10, 10**11 - 1)}"
                    rno = f"R39-RCPT-{created.astimezone(IST).strftime('%Y%m%d')}-{short_code(6)}"
                    t["receipt_no"] = rno
                    r.update(utr=t["utr"], provider_txn_id=t["provider_txn_id"], confirmed_at=t["created_at"], receipt_no=rno, transaction_id=t["id"])
                    receipts.append({"receipt_no": rno, "payment_id": r["id"], "transaction_id": t["id"], "amount": t["amount"], "driver_id": drv["id"],
                                     "driver_name": drv["name"], "vehicle_reg": veh["registration_no"], "city": drv["city"], "utr": t["utr"],
                                     "provider": "MOCK", "method": r["method"], "is_simulated": True, "rental_amount": r["rental_amount"],
                                     "outstanding_amount": 0.0, "issued_at": t["created_at"], "demo": True})
                    if back == 0:
                        drv["rent_paid_for"] = today.isoformat()
                txns.append(t)
            reqs.append(r)
    await db.payment_requests.insert_many(reqs)
    await db.payment_transactions.insert_many(txns)
    await db.payment_receipts.insert_many(receipts)
    for d in drivers:
        if d["rent_paid_for"]:
            await db.drivers.update_one({"id": d["id"]}, {"$set": {"rent_paid_for": d["rent_paid_for"]}})
    await _seed_static_qr_flow(drivers)
    log.info("DEMO seed: %s drivers, %s requests, %s transactions", len(drivers), len(reqs), len(txns))


async def _seed_static_qr_flow(drivers):
    """Runs the real static-QR + bank-import path on a few DEMO drivers so the exception queue has examples."""
    from engine import create_payment_request, submit_utr
    from recon import import_statement
    unpaid = [d for d in drivers if not d["rent_paid_for"]][:4]
    if len(unpaid) < 4:
        return
    system = {"user_id": "system", "email": "demo-seed", "role": "system"}
    utrs = ["612345678901", "612345678902", "612345678903"]
    reqs = []
    for d, u in zip(unpaid[:3], utrs):
        r = await create_payment_request(driver_id=d["id"], vehicle_id=d["vehicle_id"], amount=None, method="UPI_QR", provider_code="STATIC_QR",
                                         client_id="DEMO-SEED", idempotency_key=None, actor=system)
        await submit_utr(r["id"], u)
        reqs.append(r)
    t = now().astimezone(IST)
    fmt = lambda dt: dt.strftime("%d-%m-%Y %H:%M:%S")
    csv_rows = [
        "Txn Date,UPI Ref,Payer Name,Payer VPA,Narration,Dr/Cr,Amount",
        f"{fmt(t - timedelta(minutes=50))},{utrs[0]},DEMO PAYER A,demo.a@upi,UPI/CR/{utrs[0]},CR,{reqs[0]['total_payable']:.2f}",
        f"{fmt(t - timedelta(minutes=40))},{utrs[1]},DEMO PAYER B,demo.b@upi,UPI/CR/{utrs[1]},CR,{reqs[1]['total_payable'] - 100:.2f}",
        f"{fmt(t - timedelta(minutes=30))},612399999999,DEMO PAYER C,demo.c@upi,UPI/CR/612399999999,CR,900.00",
        f"{fmt(t - timedelta(minutes=20))},,DEMO PAYER D,,CASH DEPOSIT,CR,850.00",
        f"{fmt(t - timedelta(minutes=10))},STL{t.strftime('%Y%m%d')},KOTAK,,UPI SETTLEMENT BULK CR,CR,15400.00",
    ]
    mapping = {"txn_time": "Txn Date", "utr": "UPI Ref", "payer_name": "Payer Name", "payer_vpa": "Payer VPA", "description": "Narration",
               "direction": "Dr/Cr", "amount": "Amount"}
    await import_statement("demo_kotak_statement.csv", "\n".join(csv_rows).encode(), mapping, "DEMO_SEED", system)
