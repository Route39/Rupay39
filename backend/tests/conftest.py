# Shared fixtures: JWT session tokens for role users, mongo access for TEST_ fixture drivers, cleanup by id
import os
import sys
import time
import uuid
import random
import pytest
import requests
from pathlib import Path
from dotenv import dotenv_values
from pymongo import MongoClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
from auth import create_token

_fe = dotenv_values(Path("/app/frontend/.env")) if Path("/app/frontend/.env").exists() else dotenv_values(BACKEND_DIR.parent / "frontend" / ".env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL") or "http://localhost:8010").rstrip("/")
_be = dotenv_values(Path("/app/backend/.env")) if Path("/app/backend/.env").exists() else dotenv_values(BACKEND_DIR / ".env")
MOCK_SECRET = os.environ.get("MOCK_WEBHOOK_SECRET") or _be.get("MOCK_WEBHOOK_SECRET")
UA = {"User-Agent": "rupay39-tests/1.0"}

TEST_ROLES = {
    "admin": ("user_3LgeJQ3SuvkCt31QNmPwdcKKWLr", "support@route39.in", "admin"),
    "finance": ("user_3LgeJMz1QhyL139GfcSHejpbACw", "finance@route39.in", "finance_admin"),
    "supervisor": ("user_3LgeJNmftMSFuejXAFvy22l6WwT", "supervisor@route39.in", "supervisor"),
    "pending": ("user_3LgeJSgSdlqqfraJywxgSbWMFoL", "pending@route39.in", "pending"),
}

USERS = {k: v[0] for k, v in TEST_ROLES.items()}


class JwtClient:
    """requests wrapper that attaches JWT bearer token."""
    def __init__(self, role):
        self.role = role
        uid, email, r = TEST_ROLES[role]
        self.user_id = uid
        self.email = email
        self._tok = create_token(uid, email, r)

    def token(self):
        return self._tok

    def req(self, method, path, **kw):
        headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {self.token()}"}
        return requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=60, **kw)

    def get(self, p, **kw): return self.req("GET", p, **kw)
    def post(self, p, **kw): return self.req("POST", p, **kw)
    def patch(self, p, **kw): return self.req("PATCH", p, **kw)


_clients = {}


def get_client(role):
    if role not in _clients:
        _clients[role] = JwtClient(role)
    return _clients[role]


@pytest.fixture(scope="session")
def admin(): return get_client("admin")


@pytest.fixture(scope="session")
def finance(): return get_client("finance")


@pytest.fixture(scope="session")
def supervisor(): return get_client("supervisor")


@pytest.fixture(scope="session")
def pending(): return get_client("pending")


@pytest.fixture(scope="session")
def mdb():
    mongo_url = os.environ.get("MONGO_URL") or _be.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME") or _be.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    yield c[db_name]
    c.close()


@pytest.fixture(scope="session", autouse=True)
def setup_test_users(mdb):
    from datetime import datetime, timezone
    curr = datetime.now(timezone.utc)
    for role, (uid, email, r) in TEST_ROLES.items():
        cities = ["Chennai"] if role == "supervisor" else ["Chennai", "Coimbatore", "Madurai", "Bengaluru", "Mysuru"]
        mdb.users.update_one(
            {"user_id": uid},
            {"$set": {
                "id": uid, "user_id": uid, "email": email, "name": f"Test {role.title()}",
                "role": r, "cities": cities,
                "active": True, "created_at": curr, "updated_at": curr
            }},
            upsert=True
        )


@pytest.fixture(scope="session")
def created(mdb):
    """Tracks created ids for bulk cleanup after test run."""
    bag = {"driver": [], "vehicle": [], "request": [], "txn": [], "client": [], "clients": [], "imports": []}
    yield bag
    if bag["driver"]: mdb.drivers.delete_many({"id": {"$in": bag["driver"]}})
    if bag["vehicle"]: mdb.vehicles.delete_many({"id": {"$in": bag["vehicle"]}})
    if bag["request"]: mdb.payment_requests.delete_many({"id": {"$in": bag["request"]}})
    if bag["txn"]: mdb.payment_transactions.delete_many({"id": {"$in": bag["txn"]}})
    if bag["client"]: mdb.api_clients.delete_many({"id": {"$in": bag["client"]}})
    if bag["clients"]: mdb.api_clients.delete_many({"id": {"$in": bag["clients"]}})
    if bag["imports"]: mdb.bank_statement_imports.delete_many({"id": {"$in": bag["imports"]}})


@pytest.fixture
def make_driver(created, mdb):
    def factory(city="Chennai", outstanding=0.0, rent=300.0, state="TN"):
        uid = f"TEST-DRV-{uuid.uuid4().hex[:8]}"
        vid = f"TEST-VEH-{uuid.uuid4().hex[:8]}"
        reg = f"TN01TEST{random.randint(1000, 9999)}"
        created["driver"].append(uid)
        created["vehicle"].append(vid)
        mdb.drivers.insert_one({"id": uid, "name": f"Driver {uid}", "phone_masked": "+91 9XXXXX0000", "city": city,
                                "state": state, "vehicle_id": vid, "vehicle_reg": reg, "daily_rent": rent,
                                "outstanding_amount": outstanding, "status": "ACTIVE", "source": "TEST", "rent_paid_for": None})
        mdb.vehicles.insert_one({"id": vid, "registration_no": reg, "city": city, "state": state, "driver_id": uid,
                                 "driver_name": f"Driver {uid}", "status": "ACTIVE", "source": "TEST"})
        return uid, vid
    return factory
