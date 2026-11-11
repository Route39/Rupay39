# RUPAY39 mandatory 20 payment/reconciliation cases + RBAC (module-level so xdist keeps them on one worker, sequential)
import io
import json
import time
import uuid
import hmac
import hashlib
import random
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo.errors import DuplicateKeyError

from conftest import BASE_URL, MOCK_SECRET

IST = timezone(timedelta(hours=5, minutes=30))


def utr():
    return str(random.randint(10 ** 11, 10 ** 12 - 1))


def new_req(client, did, provider="MOCK", amount=None):
    body = {"driver_id": did, "provider": provider, "method": "UPI_QR"}
    if amount is not None:
        body["amount"] = amount
    r = client.post("/api/admin/payment-requests", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def sim(client, pid, outcome, u=None):
    r = client.post(f"/api/admin/payment-requests/{pid}/simulate", json={"outcome": outcome, **({"utr": u} if u else {})})
    assert r.status_code == 200, r.text
    return r.json()


def detail(client, pid):
    r = client.get(f"/api/admin/payment-requests/{pid}")
    assert r.status_code == 200, r.text
    return r.json()


def wait_sync(client, pid, want="SYNCED", timeout=30, target="myvolt_sync"):
    d = None
    for _ in range(timeout // 3):
        d = detail(client, pid)
        if d[target] and all(x["status"] == want for x in d[target]):
            return d
        time.sleep(3)
    return d


# 1 successful verified payment
def test_01_success_receipt_and_sync(finance, make_driver):
    did, _ = make_driver()
    req = new_req(finance, did)
    assert req["status"] == "PENDING" and req["is_simulated"] is True
    res = sim(finance, req["id"], "success")
    assert res["result"]["outcome"] == "SUCCESS", res
    assert res["result"]["receipt_no"].startswith("R39-RCPT")
    d = detail(finance, req["id"])
    assert d["request"]["status"] == "SUCCESS" and d["receipt"]["receipt_no"] == res["result"]["receipt_no"]
    assert len(d["myvolt_sync"]) == 1 and len(d["evrent_sync"]) == 1
    d = wait_sync(finance, req["id"])
    assert all(x["status"] == "SYNCED" for x in d["myvolt_sync"]), d["myvolt_sync"]
    d = wait_sync(finance, req["id"], target="evrent_sync")
    assert all(x["status"] == "SYNCED" for x in d["evrent_sync"]), d["evrent_sync"]
    r = finance.get(f"/api/admin/receipts/{res['result']['receipt_no']}")
    assert r.status_code == 200 and r.json()["receipt"]["amount"] == 300.0


# 2 failed payment
def test_02_failed(finance, make_driver):
    did, _ = make_driver()
    req = new_req(finance, did)
    res = sim(finance, req["id"], "failed")
    assert res["result"]["outcome"] == "FAILED"
    d = detail(finance, req["id"])
    assert d["request"]["status"] == "FAILED" and d["receipt"] is None


# 3 duplicate callback
def test_03_duplicate_callback(finance, make_driver):
    did, _ = make_driver()
    req = new_req(finance, did)
    sim(finance, req["id"], "success")
    res = sim(finance, req["id"], "duplicate_callback")
    assert res["result"]["status"] == "duplicate_callback_ignored", res
    d = detail(finance, req["id"])
    assert len([t for t in d["transactions"] if t["kind"] == "PAYMENT"]) == 1


# 4 duplicate UTR
def test_04_duplicate_utr(finance, make_driver):
    u = utr()
    a, _ = make_driver()
    b, _ = make_driver()
    ra, rb = new_req(finance, a), new_req(finance, b)
    assert sim(finance, ra["id"], "success", u)["result"]["outcome"] == "SUCCESS"
    res = sim(finance, rb["id"], "success", u)
    assert res["result"]["outcome"] == "DUPLICATE_UTR", res
    d = detail(finance, rb["id"])
    assert d["request"]["status"] != "SUCCESS"
    assert any(e["type"] == "DUPLICATE_TRANSACTION" for e in d["exceptions"])


# 5 incorrect amount
def test_05_amount_mismatch(finance, make_driver):
    did, _ = make_driver()
    req = new_req(finance, did)
    res = sim(finance, req["id"], "wrong_amount")
    assert res["result"]["outcome"] == "AMOUNT_MISMATCH"
    d = detail(finance, req["id"])
    assert d["request"]["status"] != "SUCCESS"
    assert d["transactions"][0]["status"] == "AMOUNT_MISMATCH"
    assert any(e["type"] == "AMOUNT_MISMATCH" for e in d["exceptions"])


def _csv(rows):
    buf = io.StringIO()
    buf.write("Txn Date,Description,UTR,Credit,Debit\n")
    for r in rows:
        buf.write(",".join(str(x) for x in r) + "\n")
    return buf.getvalue().encode()


MAPPING = {"txn_time": "Txn Date", "description": "Description", "utr": "UTR", "credit_amount": "Credit", "debit_amount": "Debit"}


def _import(finance, created, rows):
    content = _csv(rows)
    p = finance.post("/api/bank/preview", files={"file": ("TEST_stmt.csv", content, "text/csv")})
    assert p.status_code == 200, p.text
    assert "UTR" in p.json()["headers"]
    r = finance.post("/api/bank/import", files={"file": ("TEST_stmt.csv", content, "text/csv")},
                     data={"mapping": json.dumps(MAPPING), "source": "TEST"})
    assert r.status_code == 200, r.text
    created["imports"].append(r.json()["import_id"])
    return r.json()


def _btx(finance, u):
    r = finance.get("/api/bank/transactions", params={"q": u})
    assert r.status_code == 200
    items = [i for i in r.json()["items"] if i.get("utr") == u]
    assert items, f"bank row {u} missing"
    return items[0]


NOWS = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")


# 6 static QR: same amount no claims -> MISSING_IN_SYSTEM; two claims same UTR -> AMBIGUOUS_MATCH
def test_06_static_qr_no_auto_assign_and_ambiguous(finance, admin, make_driver, created):
    provs = {p["code"]: p for p in admin.get("/api/providers").json()}
    if not provs.get("STATIC_QR", {}).get("enabled"):
        pytest.skip("STATIC_QR provider disabled")
    a, _ = make_driver()
    b, _ = make_driver()
    ra, rb = new_req(finance, a, "STATIC_QR"), new_req(finance, b, "STATIC_QR")
    u1, u2, u3 = utr(), utr(), utr()
    res = _import(finance, created, [(NOWS, "UPI CR", u1, 300, ""), (NOWS, "UPI CR", u2, 300, "")])
    assert res["imported"] == 2
    assert _btx(finance, u1)["recon_status"] == "MISSING_IN_SYSTEM"
    assert _btx(finance, u2)["recon_status"] == "MISSING_IN_SYSTEM"
    for r in (ra, rb):
        assert detail(finance, r["id"])["request"]["status"] == "PENDING"
    # two requests claim same UTR (admin client key needed -> use mongo-free path: partner API)
    key = admin.post("/api/api-clients", json={"name": "TEST_ambig", "system": "EV_RENT"}).json()
    created["clients"].append(key["id"])
    h = {"X-API-Key": key["api_key"]}
    for r in (ra, rb):
        x = requests.post(f"{BASE_URL}/api/v1/payments/{r['id']}/utr", json={"utr": u3}, headers=h)
        assert x.status_code == 200, x.text
    assert x.json()["conflict"] is True
    _import(finance, created, [(NOWS, "UPI CR", u3, 300, "")])
    bt = _btx(finance, u3)
    assert bt["recon_status"] == "UNDER_REVIEW"
    ex = finance.get("/api/exceptions", params={"q": bt["id"]}).json()["items"]
    assert any(e["type"] == "AMBIGUOUS_MATCH" for e in ex)
    for r in (ra, rb):
        assert detail(finance, r["id"])["request"]["status"] == "PENDING"


# 7 delayed confirmation  & 8 timeout
def test_07_08_expiry_and_late_confirmation(finance, make_driver, mdb):
    did, _ = make_driver()
    req = new_req(finance, did)
    mdb.payment_requests.update_one({"id": req["id"]}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}})
    st = None
    for _ in range(8):
        st = detail(finance, req["id"])["request"]["status"]
        if st == "EXPIRED":
            break
        time.sleep(3)
    assert st == "EXPIRED"  # case 8
    res = sim(finance, req["id"], "success")
    assert res["result"]["outcome"] == "SUCCESS"
    d = detail(finance, req["id"])
    assert d["request"]["status"] == "SUCCESS" and d["request"]["late_confirmation"] is True
    assert any(e["type"] == "DELAYED_CONFIRMATION" for e in d["exceptions"])


# 9 reversal / 10 refund
@pytest.mark.parametrize("kind,final", [("reversal", "REVERSED"), ("refund", "REFUNDED")])
def test_09_10_reversal_refund(finance, make_driver, mdb, kind, final):
    did, _ = make_driver()
    req = new_req(finance, did)
    sim(finance, req["id"], "success")
    assert mdb.drivers.find_one({"id": did})["outstanding_amount"] == 0
    res = sim(finance, req["id"], kind)
    assert res["result"]["outcome"] == final, res
    d = detail(finance, req["id"])
    assert d["request"]["status"] == final
    orig = [t for t in d["transactions"] if t["kind"] == "PAYMENT"][0]
    assert orig["status"] == final
    assert mdb.drivers.find_one({"id": did})["outstanding_amount"] == 300


# 11 partial payment
def test_11_partial(admin, finance, make_driver):
    did, _ = make_driver()
    r = finance.post("/api/admin/payment-requests", json={"driver_id": did, "provider": "MOCK", "amount": 100})
    assert r.status_code == 422
    try:
        assert admin.patch("/api/settings", json={"allow_partial_payments": True}).status_code == 200
        r = finance.post("/api/admin/payment-requests", json={"driver_id": did, "provider": "MOCK", "amount": 100})
        assert r.status_code == 200, r.text
        assert r.json()["is_partial"] is True and r.json()["amount_requested"] == 100
    finally:
        assert admin.patch("/api/settings", json={"allow_partial_payments": False}).json()["allow_partial_payments"] is False


# 12 multiple payments same driver + idempotency
def test_12_multiple_payments(admin, finance, make_driver, mdb, created):
    did, vid = make_driver()
    req = new_req(finance, did)
    sim(finance, req["id"], "success")
    r = finance.post("/api/admin/payment-requests", json={"driver_id": did, "provider": "MOCK"})
    assert r.status_code == 409
    mdb.drivers.update_one({"id": did}, {"$set": {"outstanding_amount": 50.0}})
    r2 = new_req(finance, did)
    assert r2["amount_requested"] == 50.0 and r2["id"] != req["id"]
    assert new_req(finance, did)["id"] == r2["id"]  # open request returned
    key = admin.post("/api/api-clients", json={"name": "TEST_idem", "system": "EV_RENT"}).json()
    created["clients"].append(key["id"])
    d2, v2 = make_driver()
    h = {"X-API-Key": key["api_key"], "Idempotency-Key": f"TEST-{uuid.uuid4()}"}
    a = requests.post(f"{BASE_URL}/api/v1/payments/create", json={"driver_id": d2, "vehicle_id": v2, "provider": "MOCK"}, headers=h)
    b = requests.post(f"{BASE_URL}/api/v1/payments/create", json={"driver_id": d2, "vehicle_id": v2, "provider": "MOCK"}, headers=h)
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["payment_id"] == b.json()["payment_id"]


# 13 unmatched bank txn (no UTR) + 14 manual LINK_TO_PAYMENT
def test_13_14_unmatched_and_link(finance, admin, make_driver, created, mdb):
    u = utr()
    res = _import(finance, created, [(NOWS, "TEST no utr", "", 123, ""), (NOWS, "UPI CR", u, 300, "")])
    assert res["reconciliation"]["counts"].get("UNMATCHED", 0) >= 1
    nou = mdb.bank_transactions.find_one({"import_id": res["import_id"], "utr": None})
    assert nou["recon_status"] == "UNMATCHED"
    bt = _btx(finance, u)
    assert bt["recon_status"] == "MISSING_IN_SYSTEM"
    exc = [e for e in finance.get("/api/exceptions", params={"q": bt["id"]}).json()["items"] if e["type"] == "UNMATCHED_BANK_TXN"][0]
    did, _ = make_driver()
    provs = {p["code"]: p for p in admin.get("/api/providers").json()}
    prov = "STATIC_QR" if provs.get("STATIC_QR", {}).get("enabled") else "MOCK"
    req = new_req(finance, did, prov)
    bad = finance.post(f"/api/exceptions/{exc['id']}/resolve", json={"action": "LINK_TO_PAYMENT", "reason": "TEST link", "payment_id": req["id"]})
    assert bad.status_code == 422
    short = finance.post(f"/api/exceptions/{exc['id']}/resolve", json={"action": "LINK_TO_PAYMENT", "reason": "x", "payment_id": req["id"], "evidence_ref": "e"})
    assert short.status_code == 422
    ok = finance.post(f"/api/exceptions/{exc['id']}/resolve",
                      json={"action": "LINK_TO_PAYMENT", "reason": "TEST verified bank stmt", "payment_id": req["id"], "evidence_ref": "TEST-STMT-1"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["outcome"]["outcome"] == "SUCCESS" and ok.json()["by"]
    e2 = finance.get(f"/api/exceptions/{exc['id']}").json()["exception"]
    assert e2["status"] == "RESOLVED" and e2["resolution"]["evidence_ref"] == "TEST-STMT-1"
    assert detail(finance, req["id"])["request"]["status"] == "SUCCESS"
    logs = admin.get("/api/audit-logs", params={"q": exc["id"]}).json()["items"]
    assert any(l["action"] == "EXCEPTION_RESOLVED" for l in logs)


# 15 failed MyVolt sync + retry; 16 duplicate sync idempotency
def test_15_16_myvolt_failure_retry_and_idempotency(admin, finance, make_driver, mdb):
    did, _ = make_driver()
    try:
        admin.patch("/api/settings", json={"myvolt_simulate_failure": True})
        req = new_req(finance, did)
        sim(finance, req["id"], "success")
        d = wait_sync(finance, req["id"], want="RETRY_PENDING", timeout=30)
        log = d["myvolt_sync"][0]
        assert log["status"] == "RETRY_PENDING" and log["last_error"], log
    finally:
        admin.patch("/api/settings", json={"myvolt_simulate_failure": False})
    r = finance.post(f"/api/sync-logs/myvolt/{log['id']}/retry")
    assert r.status_code == 200, r.text
    d = wait_sync(finance, req["id"], timeout=30)
    assert d["myvolt_sync"][0]["status"] == "SYNCED", d["myvolt_sync"]
    # 16: duplicate callback produced no second log; unique index rejects second enqueue
    sim(finance, req["id"], "duplicate_callback")
    assert len(detail(finance, req["id"])["myvolt_sync"]) == 1
    doc = mdb.myvolt_sync_logs.find_one({"id": log["id"]}, {"_id": 0})
    with pytest.raises(DuplicateKeyError):
        mdb.myvolt_sync_logs.insert_one({**doc, "id": "TEST_dup"})


# 17 unauthorized admin access
def test_17_unauthorized(pending, finance):
    assert requests.get(f"{BASE_URL}/api/admin/me").status_code == 401
    assert requests.get(f"{BASE_URL}/api/admin/dashboard").status_code == 401
    assert pending.get("/api/admin/dashboard").status_code == 403
    assert pending.get("/api/admin/payment-requests").status_code == 403
    assert finance.get("/api/users").status_code == 403
    assert finance.get("/api/audit-logs").status_code == 403
    assert finance.patch("/api/settings", json={"allow_partial_payments": True}).status_code == 403
    assert finance.post("/api/api-clients", json={"name": "TEST_x", "system": "EV_RENT"}).status_code == 403


# 18 supervisor scope
def test_18_supervisor_scope(supervisor, finance, admin, make_driver, created):
    me = supervisor.get("/api/admin/me").json()
    assert me["role"] == "supervisor" and me.get("cities") == ["Chennai"], me
    blr, _ = make_driver("Bengaluru", 350)
    rb = new_req(finance, blr)
    assert supervisor.get(f"/api/admin/payment-requests/{rb['id']}").status_code == 404
    lst = supervisor.get("/api/admin/payment-requests", params={"size": 100}).json()["items"]
    assert all(i["city"] == "Chennai" for i in lst)
    che, vid = make_driver("Chennai")
    rc = new_req(finance, che)
    assert supervisor.get(f"/api/admin/payment-requests/{rc['id']}").status_code == 200
    key = admin.post("/api/api-clients", json={"name": "TEST_disp", "system": "EV_RENT"}).json()
    created["clients"].append(key["id"])
    dsp = requests.post(f"{BASE_URL}/api/v1/payments/{rc['id']}/dispute", json={"reason": "TEST paid but pending"},
                        headers={"X-API-Key": key["api_key"]}).json()
    eid = dsp["exception_id"]
    assert eid
    r = supervisor.post(f"/api/exceptions/{eid}/resolve", json={"action": "LINK_TO_PAYMENT", "reason": "TEST try link",
                                                                   "payment_id": rc["id"], "evidence_ref": "x"})
    assert r.status_code == 403
    assert supervisor.post(f"/api/exceptions/{eid}/comments", json={"text": "TEST comment"}).status_code == 200
    assert supervisor.post(f"/api/exceptions/{eid}/escalate", json={"reason": "TEST escalate"}).status_code == 200
    assert supervisor.get("/api/bank/transactions").status_code == 403


# 19 invalid webhook signature
def test_19_invalid_signature(mdb):
    body = json.dumps({"event_id": f"TEST-{uuid.uuid4()}", "status": "SUCCESS", "internal_ref": "X", "provider_txn_id": "x",
                       "amount": 1, "merchant_id": "MOCK-MERCHANT-R39"}).encode()
    t0 = datetime.now(timezone.utc) - timedelta(seconds=5)
    r = requests.post(f"{BASE_URL}/api/webhooks/MOCK", data=body, headers={"X-Mock-Signature": "deadbeef", "Content-Type": "application/json"})
    assert r.status_code == 401
    r = requests.post(f"{BASE_URL}/api/webhooks/MOCK", data=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 401
    assert mdb.payment_webhooks.count_documents({"result": "REJECTED_SIGNATURE", "received_at": {"$gte": t0}}) >= 2


def test_19b_valid_signed_webhook_direct(finance, make_driver):
    if not MOCK_SECRET:
        pytest.skip("no mock secret")
    did, _ = make_driver()
    req = new_req(finance, did)
    evt = {"event_id": f"TEST-{uuid.uuid4()}", "event_type": "PAYMENT", "status": "SUCCESS", "internal_ref": req["internal_ref"],
           "provider_txn_id": f"TEST-{uuid.uuid4()}", "amount": req["amount_requested"], "merchant_id": "MOCK-MERCHANT-R39", "utr": utr()}
    raw = json.dumps(evt).encode()
    sig = hmac.new(MOCK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    r = requests.post(f"{BASE_URL}/api/webhooks/MOCK", data=raw, headers={"X-Mock-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["outcome"] == "SUCCESS", r.text
    r = requests.post(f"{BASE_URL}/api/webhooks/MOCK", data=raw, headers={"X-Mock-Signature": sig, "Content-Type": "application/json"})
    assert r.json()["status"] == "duplicate_callback_ignored"


# 20 bank recon mismatch via CSV (UTR known, different amount)
def test_20_bank_amount_mismatch(finance, make_driver, created):
    did, _ = make_driver()
    u = utr()
    req = new_req(finance, did)
    sim(finance, req["id"], "success", u)
    res = _import(finance, created, [(NOWS, "UPI CR", u, 299, "")])
    assert res["reconciliation"]["counts"].get("AMOUNT_MISMATCH") == 1, res
    assert _btx(finance, u)["recon_status"] == "AMOUNT_MISMATCH"
    # re-import same file -> duplicate rows skipped
    res2 = _import(finance, created, [(NOWS, "UPI CR", u, 299, "")])
    assert res2["skipped_duplicate_rows"] == 1 and res2["imported"] == 0
