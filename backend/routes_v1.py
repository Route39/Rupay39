"""Partner APIs for the EV Rent backend (service-to-service, X-API-Key) and provider webhooks."""
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core import db, clean, now
from rbac import require_api_client
from engine import create_payment_request, process_callback, submit_utr, payable_for, create_exception

router = APIRouter(prefix="/api/v1", tags=["EV Rent Partner API"])
hooks = APIRouter(prefix="/api/webhooks", tags=["Provider webhooks"])
_buckets: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, window: int = 60):
    q = _buckets[key]
    t = time.monotonic()
    while q and q[0] < t - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Rate limit exceeded")
    q.append(t)


async def partner(request: Request) -> dict:
    client = await require_api_client(request)
    rate_limit(f"cli:{client['id']}", 600)
    return client


async def evrent(request: Request) -> dict:
    client = await partner(request)
    if client.get("system") != "EV_RENT":
        raise HTTPException(403, "Only EV Rent clients may perform this action")
    return client


PUBLIC_FIELDS = ["id", "internal_ref", "driver_id", "vehicle_id", "driver_name", "vehicle_reg", "city", "rental_amount", "outstanding_amount",
                 "total_payable", "amount_requested", "is_partial", "provider", "method", "status", "reconciliation_status", "utr",
                 "claimed_utr", "created_at", "expires_at", "confirmed_at", "receipt_no", "is_simulated", "instructions"]


def public(req: dict) -> dict:
    out = {k: req.get(k) for k in PUBLIC_FIELDS}
    out["payment_id"] = out.pop("id")
    return clean(out)


class CreatePayment(BaseModel):
    driver_id: str = Field(min_length=1, max_length=64)
    vehicle_id: str = Field(min_length=1, max_length=64)
    amount: float | None = Field(default=None, gt=0, description="Optional. Must equal the authorised payable amount unless partial payments are enabled.")
    method: str = Field(default="UPI_QR", pattern="^(UPI_QR|UPI_INTENT)$")
    provider: str | None = Field(default=None, description="Defaults to the configured primary provider")


@router.post("/payments/create", summary="Create payment request")
async def create(body: CreatePayment, request: Request, client: dict = Depends(evrent)):
    req = await create_payment_request(driver_id=body.driver_id, vehicle_id=body.vehicle_id, amount=body.amount, method=body.method,
                                       provider_code=body.provider, client_id=client["id"],
                                       idempotency_key=request.headers.get("idempotency-key"),
                                       actor={"user_id": client["id"], "email": client["name"], "role": "api_client"})
    return public(req)


async def _req(pid: str) -> dict:
    req = await db.payment_requests.find_one({"id": pid}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Payment not found")
    return req


@router.get("/payments/{payment_id}", summary="Get payment status")
async def status(payment_id: str, client: dict = Depends(partner)):
    return public(await _req(payment_id))


@router.get("/payments/{payment_id}/instructions", summary="Get payment instructions")
async def instructions(payment_id: str, client: dict = Depends(partner)):
    req = await _req(payment_id)
    return {"payment_id": payment_id, "status": req["status"], "expires_at": clean(req["expires_at"]), "instructions": req.get("instructions")}


@router.get("/payments/{payment_id}/receipt", summary="Get payment receipt")
async def receipt(payment_id: str, client: dict = Depends(partner)):
    r = await db.payment_receipts.find_one({"payment_id": payment_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "No receipt: payment not verified")
    return clean(r)


class UTRIn(BaseModel):
    utr: str = Field(min_length=10, max_length=22)


@router.post("/payments/{payment_id}/utr", summary="Submit UTR claim (static QR)")
async def utr(payment_id: str, body: UTRIn, client: dict = Depends(evrent)):
    return await submit_utr(payment_id, body.utr)


class DisputeIn(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)
    utr: str | None = None


@router.post("/payments/{payment_id}/dispute", summary="Raise driver payment dispute")
async def dispute(payment_id: str, body: DisputeIn, client: dict = Depends(evrent)):
    req = await _req(payment_id)
    key = f"disp:{payment_id}:{now().date()}"
    existing = await db.unmatched_transactions.find_one({"dedupe_key": key}, {"_id": 0, "id": 1})
    if existing:
        return {"payment_id": payment_id, "exception_id": existing["id"], "status": "UNDER_REVIEW", "duplicate": True}
    exc = await create_exception("DRIVER_DISPUTE", city=req["city"], payment_id=payment_id, amount=req["amount_requested"],
                                 details=f"Driver dispute: {body.reason}" + (f" (UTR {body.utr})" if body.utr else ""),
                                 driver_id=req["driver_id"], dedupe_key=key)
    return {"payment_id": payment_id, "exception_id": exc["id"] if exc else None, "status": "UNDER_REVIEW"}


@router.get("/drivers/{driver_id}/payments", summary="Driver payment history")
async def history(driver_id: str, page: int = 1, size: int = 20, client: dict = Depends(partner)):
    size = max(1, min(size, 100))
    q = {"driver_id": driver_id}
    total = await db.payment_requests.count_documents(q)
    items = await db.payment_requests.find(q, {"_id": 0}).sort("created_at", -1).skip((max(page, 1) - 1) * size).limit(size).to_list(size)
    return {"items": [public(i) for i in items], "total": total, "page": page, "size": size}


@router.get("/drivers/{driver_id}/outstanding", summary="Driver outstanding balance")
async def outstanding(driver_id: str, client: dict = Depends(partner)):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    return {"driver_id": driver_id, "vehicle_id": d.get("vehicle_id"), **payable_for(d), "source": d.get("source"),
            "note": "Mirror of MyVolt rental data; MyVolt remains authoritative."}


@router.get("/transactions/check", summary="Check a transaction reference (UTR)")
async def check_ref(utr: str, client: dict = Depends(partner)):
    txn = await db.payment_transactions.find_one({"utr": utr, "kind": "PAYMENT"}, {"_id": 0})
    if txn:
        return {"utr": utr, "found": True, "verified": txn["status"] == "SUCCESS", "payment_id": txn["payment_id"], "status": txn["status"]}
    claimed = await db.payment_requests.count_documents({"claimed_utr": utr})
    return {"utr": utr, "found": False, "verified": False, "claimed_by_requests": claimed,
            "note": "Not yet confirmed by bank/provider. Screenshots are not accepted as proof."}


@hooks.post("/{provider}", summary="Provider payment callback")
async def webhook(provider: str, request: Request):
    rate_limit(f"hook:{request.client.host if request.client else 'x'}", 1200)
    raw = await request.body()
    code, body = await process_callback(provider.upper(), raw, {k.lower(): v for k, v in request.headers.items()})
    return JSONResponse(status_code=code, content=body)
