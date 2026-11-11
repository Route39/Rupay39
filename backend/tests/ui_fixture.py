# UI test helper: create (setup) or remove (cleanup <ids>) TEST_ drivers and their payment records
import sys, uuid, random
from pathlib import Path
from dotenv import dotenv_values
from pymongo import MongoClient
be = dotenv_values(Path("/app/backend/.env"))
db = MongoClient(be["MONGO_URL"])[be["DB_NAME"]]
if sys.argv[1] == "setup":
    n = uuid.uuid4().hex[:6].upper()
    did, vid, reg = f"TEST_DRV-{n}", f"TEST_VEH-{n}", f"TEST{random.randint(100000, 999999)}"
    db.drivers.insert_one({"id": did, "external_id": f"TEST-{n}", "name": f"TEST_UI Driver {n}", "city": "Chennai", "state": "TN", "vehicle_id": vid,
                           "vehicle_reg": reg, "daily_rent": 300.0, "outstanding_amount": 0.0, "status": "ACTIVE", "source": "TEST", "rent_paid_for": None})
    db.vehicles.insert_one({"id": vid, "registration_no": reg, "city": "Chennai", "driver_id": did, "driver_name": f"TEST_UI Driver {n}", "status": "ACTIVE", "source": "TEST"})
    print(did)
else:
    ids = sys.argv[2:]
    pids = [p["id"] for p in db.payment_requests.find({"driver_id": {"$in": ids}}, {"id": 1})]
    db.payment_transactions.delete_many({"driver_id": {"$in": ids}})
    for c in ("payment_receipts", "myvolt_sync_logs", "evrent_sync_logs", "unmatched_transactions"):
        db[c].delete_many({"payment_id": {"$in": pids}})
    db.payment_requests.delete_many({"id": {"$in": pids}})
    db.vehicles.delete_many({"driver_id": {"$in": ids}})
    db.drivers.delete_many({"id": {"$in": ids}})
    print("cleaned", ids, len(pids))
