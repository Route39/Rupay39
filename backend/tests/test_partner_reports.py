# EV Rent partner API (X-API-Key) + Reports exports
import random
import pytest
import requests

from conftest import BASE_URL


@pytest.fixture(scope="module")
def api_key(admin, created):
    r = admin.post("/api/api-clients", json={"name": "TEST_partner", "system": "EV_RENT"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["api_key"].startswith("r39_ev_rent_")
    created["clients"].append(d["id"])
    return d["api_key"]


def H(k): return {"X-API-Key": k}


def test_partner_invalid_key():
    assert requests.get(f"{BASE_URL}/api/v1/drivers/DRV-0001/outstanding", headers=H("bad")).status_code == 401
    assert requests.get(f"{BASE_URL}/api/v1/drivers/DRV-0001/outstanding").status_code == 401


def test_partner_flow(api_key, make_driver, finance):
    did, vid = make_driver()
    o = requests.get(f"{BASE_URL}/api/v1/drivers/{did}/outstanding", headers=H(api_key))
    assert o.status_code == 200 and o.json()["total_payable"] == 300.0
    bad = requests.post(f"{BASE_URL}/api/v1/payments/create", json={"driver_id": did, "vehicle_id": vid, "amount": 250, "provider": "MOCK"}, headers=H(api_key))
    assert bad.status_code == 422
    k = requests.post(f"{BASE_URL}/api/v1/payments/create", json={"driver_id": did, "vehicle_id": vid, "provider": "KOTAK"}, headers=H(api_key))
    assert k.status_code == 422, k.text
    c = requests.post(f"{BASE_URL}/api/v1/payments/create", json={"driver_id": did, "vehicle_id": vid, "provider": "MOCK"}, headers=H(api_key))
    assert c.status_code == 200, c.text
    p = c.json()
    pid = p["payment_id"]
    assert p["status"] == "PENDING" and p["amount_requested"] == 300.0 and "client_id" not in p
    g = requests.get(f"{BASE_URL}/api/v1/payments/{pid}", headers=H(api_key))
    assert g.status_code == 200 and g.json()["payment_id"] == pid
    ins = requests.get(f"{BASE_URL}/api/v1/payments/{pid}/instructions", headers=H(api_key)).json()
    assert ins["instructions"]["upi_uri"].startswith("upi://pay")
    assert requests.get(f"{BASE_URL}/api/v1/payments/{pid}/receipt", headers=H(api_key)).status_code == 404
    # UTR submit on MOCK request -> 422 (static QR only)
    assert requests.post(f"{BASE_URL}/api/v1/payments/{pid}/utr", json={"utr": "123456789012"}, headers=H(api_key)).status_code == 422
    u = str(random.randint(10 ** 11, 10 ** 12 - 1))
    s = finance.post(f"/api/admin/payment-requests/{pid}/simulate", json={"outcome": "success", "utr": u}).json()
    assert s["result"]["outcome"] == "SUCCESS"
    rc = requests.get(f"{BASE_URL}/api/v1/payments/{pid}/receipt", headers=H(api_key))
    assert rc.status_code == 200 and rc.json()["utr"] == u
    chk = requests.get(f"{BASE_URL}/api/v1/transactions/check", params={"utr": u}, headers=H(api_key)).json()
    assert chk["found"] and chk["verified"] and chk["payment_id"] == pid
    chk2 = requests.get(f"{BASE_URL}/api/v1/transactions/check", params={"utr": "999999999999"}, headers=H(api_key)).json()
    assert chk2["found"] is False and chk2["verified"] is False
    hist = requests.get(f"{BASE_URL}/api/v1/drivers/{did}/payments", headers=H(api_key)).json()
    assert hist["total"] == 1 and hist["items"][0]["status"] == "SUCCESS"
    dsp = requests.post(f"{BASE_URL}/api/v1/payments/{pid}/dispute", json={"reason": "TEST dispute reason"}, headers=H(api_key))
    assert dsp.status_code == 200 and dsp.json()["status"] == "UNDER_REVIEW"
    assert requests.get(f"{BASE_URL}/api/v1/payments/PAY-NOPE", headers=H(api_key)).status_code == 404


def test_reports_all_types(finance):
    types = finance.get("/api/reports").json()
    assert len(types) == 13
    failures = []
    for t in types:
        for fmt in ("json", "csv", "xlsx"):
            r = finance.get(f"/api/reports/{t['type']}", params={"format": fmt})
            if r.status_code != 200:
                failures.append((t["type"], fmt, r.status_code, r.text[:200]))
            elif fmt == "json":
                assert "columns" in r.json() and "rows" in r.json()
            elif fmt == "xlsx":
                assert r.content[:2] == b"PK"
    assert not failures, failures


def test_reports_supervisor_forbidden(supervisor):
    assert supervisor.get("/api/reports").status_code == 403


def test_admin_misc_endpoints(admin):
    for p in ["/api/admin/me", "/api/admin/dashboard", "/api/admin/payment-requests", "/api/admin/transactions", "/api/admin/drivers",
              "/api/admin/vehicles", "/api/admin/lookups", "/api/users", "/api/roles", "/api/providers", "/api/api-clients",
              "/api/sync-logs/myvolt", "/api/sync-logs/evrent", "/api/webhooks", "/api/audit-logs", "/api/settings",
              "/api/exceptions", "/api/reconciliation/runs", "/api/reconciliation/items", "/api/reconciliation/summary",
              "/api/settlements", "/api/bank/transactions", "/api/public/branding"]:
        r = admin.get(p)
        assert r.status_code == 200, (p, r.status_code, r.text[:200])
    assert admin.patch("/api/providers/KOTAK", json={"enabled": True}).status_code == 409
    assert admin.post("/api/reconciliation/run").status_code == 200
