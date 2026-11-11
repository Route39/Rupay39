# Shared fixtures: Clerk session tokens for role users, mongo access for TEST_ fixture drivers, cleanup by id
import os
import time
import uuid
import random
import pytest
import requests
from pathlib import Path
from dotenv import dotenv_values
from pymongo import MongoClient

_fe = dotenv_values(Path("/app/frontend/.env"))
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe["REACT_APP_BACKEND_URL"]).rstrip("/")
_be = dotenv_values(Path("/app/backend/.env"))  # never printed
CLERK_SK = _be.get("CLERK_SECRET_KEY")
MOCK_SECRET = _be.get("MOCK_WEBHOOK_SECRET")
CLERK_API = "https://api.clerk.com/v1"
UA = {"User-Agent": "rupay39-tests/1.0"}

USERS = {
    "admin": "user_3LgeJQ3SuvkCt31QNmPwdcKKWLr",
    "finance": "user_3LgeJMz1QhyL139GfcSHejpbACw",
    "supervisor": "user_3LgeJNmftMSFuejXAFvy22l6WwT",
    "pending": "user_3LgeJSgSdlqqfraJywxgSbWMFoL",
}


class ClerkClient:
    """requests wrapper that refreshes the 60s Clerk JWT transparently."""
    def __init__(self, user_id):
        self.user_id = user_id
        h = {**UA, "Authorization": f"Bearer {CLERK_SK}"}
        r = requests.post(f"{CLERK_API}/sessions", json={"user_id": user_id}, headers=h, timeout=20)
        r.raise_for_status()
        self.sid = r.json()["id"]
        self._h = h
        self._tok, self._at = None, 0

    def token(self):
        if not self._tok or time.time() - self._at > 25:
            r = requests.post(f"{CLERK_API}/sessions/{self.sid}/tokens", json={}, headers=self._h, timeout=20)
            r.raise_for_status()
            self._tok, self._at = r.json()["jwt"], time.time()
        return self._tok

    def req(self, method, path, **kw):
        headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {self.token()}"}
        return requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=60, **kw)

    def get(self, p, **kw): return self.req("GET", p, **kw)
    def post(self, p, **kw): return self.req("POST", p, **kw)
    def patch(self, p, **kw): return self.req("PATCH", p, **kw)


_clients = {}


def clerk(role):
    if role not in _clients:
        if not CLERK_SK:
            pytest.skip("CLERK_SECRET_KEY unavailable")
        _clients[role] = ClerkClient(USERS[role])
    return _clients[role]


@pytest.fixture(scope="session")
def admin(): return clerk("admin")


@pytest.fixture(scope="session")
def finance(): return clerk("finance")


@pytest.fixture(scope="session")
def supervisor(): return clerk("supervisor")


@pytest.fixture(scope="session")
def pending(): return clerk("pending")


@pytest.fixture(scope="session")
def mdb():
    c = MongoClient(_be["MONGO_URL"])
    yield c[_be["DB_NAME"]]
    c.close()


@pytest.fixture(scope="session")
def created():
    return {"drivers": [], "imports": [], "clients": []}


@pytest.fixture(scope="session")
def make_driver(mdb, created):
    def _make(city="Chennai", rent=300.0, outstanding=0.0):
        n = uuid.uuid4().hex[:6].upper()
        did, vid = f"TEST_DRV-{n}", f"TEST_VEH-{n}"
        reg = f"TEST{random.randint(100000, 999999)}"
        mdb.drivers.insert_one({"id": did, "external_id": f"TEST-{n}", "name": f"TEST_Driver {n}", "city": city, "state": "TN",
                                "vehicle_id": vid, "vehicle_reg": reg, "daily_rent": rent, "outstanding_amount": outstanding,
                                "status": "ACTIVE", "source": "TEST", "rent_paid_for": None})
        mdb.vehicles.insert_one({"id": vid, "registration_no": reg, "city": city, "driver_id": did, "driver_name": f"TEST_Driver {n}",
                                 "model": "TEST", "status": "ACTIVE", "source": "TEST"})
        created["drivers"].append(did)
        return did, vid
    return _make


@pytest.fixture(scope="session", autouse=True)
def _cleanup(mdb, created, admin):
    yield
    ids = created["drivers"]
    if ids:
        pids = [p["id"] for p in mdb.payment_requests.find({"driver_id": {"$in": ids}}, {"id": 1})]
        mdb.payment_transactions.delete_many({"driver_id": {"$in": ids}})
        mdb.payment_receipts.delete_many({"payment_id": {"$in": pids}})
        mdb.myvolt_sync_logs.delete_many({"payment_id": {"$in": pids}})
        mdb.evrent_sync_logs.delete_many({"payment_id": {"$in": pids}})
        mdb.unmatched_transactions.delete_many({"payment_id": {"$in": pids}})
        mdb.payment_requests.delete_many({"id": {"$in": pids}})
        mdb.vehicles.delete_many({"driver_id": {"$in": ids}})
        mdb.drivers.delete_many({"id": {"$in": ids}})
    for imp in created["imports"]:
        bids = [b["id"] for b in mdb.bank_transactions.find({"import_id": imp}, {"id": 1})]
        mdb.unmatched_transactions.delete_many({"bank_txn_id": {"$in": bids}})
        mdb.bank_transactions.delete_many({"import_id": imp})
    for cid in created["clients"]:
        try:
            admin.post(f"/api/api-clients/{cid}/revoke")
        except Exception:
            pass
    # always restore toggles
    try:
        admin.patch("/api/settings", json={"allow_partial_payments": False, "myvolt_simulate_failure": False})
    except Exception:
        pass
