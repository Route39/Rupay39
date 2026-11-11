"""Provider-independent payment adapter layer. Add a provider by subclassing PaymentProvider."""
import os
import hmac
import json
import hashlib
from dataclasses import dataclass
from urllib.parse import urlencode


class ProviderNotAvailable(Exception):
    pass


@dataclass
class ProviderEvent:
    event_id: str
    event_type: str  # PAYMENT | REVERSAL | REFUND
    status: str  # SUCCESS | FAILED
    internal_ref: str
    provider_txn_id: str
    amount: float
    merchant_id: str
    utr: str | None = None
    payer_vpa: str | None = None
    original_txn_id: str | None = None


class PaymentProvider:
    code = "BASE"
    name = "Base"
    is_simulated = False
    supports_callbacks = False
    methods: list[str] = []

    async def initiate(self, req: dict, settings: dict) -> dict:
        raise ProviderNotAvailable(f"{self.code} does not support payment initiation")

    def verify_signature(self, raw: bytes, headers: dict) -> bool:
        return False

    def parse_callback(self, raw: bytes) -> ProviderEvent:
        raise ProviderNotAvailable(f"{self.code} does not support callbacks")

    async def enquire(self, req: dict) -> dict:
        raise ProviderNotAvailable(f"{self.code} does not support transaction enquiry")

    def merchant_id(self) -> str:
        return ""


class MockProvider(PaymentProvider):
    """SIMULATED provider for development/testing. Never moves real money."""
    code = "MOCK"
    name = "Mock Provider (SIMULATED)"
    is_simulated = True
    supports_callbacks = True
    methods = ["UPI_QR", "UPI_INTENT"]

    def merchant_id(self) -> str:
        return "MOCK-MERCHANT-R39"

    async def initiate(self, req: dict, settings: dict) -> dict:
        params = {"pa": "mock.route39@simulated", "pn": "RUPAY39 SIMULATED", "am": f"{req['total_payable']:.2f}",
                  "tr": req["internal_ref"], "tn": f"Rent {req['vehicle_reg']}", "cu": "INR"}
        uri = "upi://pay?" + urlencode(params)
        return {"type": req["method"], "simulated": True, "upi_uri": uri, "qr_payload": uri,
                "note": "SIMULATED payment - no real money moves. For testing only."}

    def sign(self, raw: bytes) -> str:
        return hmac.new(os.environ["MOCK_WEBHOOK_SECRET"].encode(), raw, hashlib.sha256).hexdigest()

    def verify_signature(self, raw: bytes, headers: dict) -> bool:
        sig = headers.get("x-mock-signature", "")
        return bool(sig) and hmac.compare_digest(self.sign(raw), sig)

    def parse_callback(self, raw: bytes) -> ProviderEvent:
        d = json.loads(raw)
        return ProviderEvent(
            event_id=str(d["event_id"]), event_type=d.get("event_type", "PAYMENT"), status=d["status"],
            internal_ref=d["internal_ref"], provider_txn_id=str(d["provider_txn_id"]), amount=float(d["amount"]),
            merchant_id=d.get("merchant_id", ""), utr=d.get("utr"), payer_vpa=d.get("payer_vpa"),
            original_txn_id=d.get("original_txn_id"))

    async def enquire(self, req: dict) -> dict:
        return {"simulated": True, "status": req["status"], "internal_ref": req["internal_ref"]}


class StaticQRProvider(PaymentProvider):
    """Interim workflow on the existing Kotak static merchant QR. Payments are confirmed ONLY via bank statement UTR match."""
    code = "STATIC_QR"
    name = "Kotak Static QR (interim)"
    methods = ["UPI_QR"]

    async def initiate(self, req: dict, settings: dict) -> dict:
        return {"type": "STATIC_QR", "simulated": False, "qr_image_url": settings.get("static_qr_image_url") or None,
                "vpa": settings.get("static_qr_vpa") or None, "payee_name": settings.get("static_qr_merchant_name"),
                "amount": req["total_payable"], "reference": req["internal_ref"],
                "note": "Scan the Route39 merchant QR, pay the exact amount, then submit the 12-digit UPI reference (UTR). "
                        "Payment is confirmed only after the bank statement is reconciled."}


class KotakProvider(PaymentProvider):
    """Placeholder. Implement strictly from Kotak's approved API documentation once provided.
    No endpoints, signature schemes or payload formats are assumed here."""
    code = "KOTAK"
    name = "Kotak Mahindra Bank (awaiting API access)"
    methods = ["UPI_QR", "UPI_INTENT"]
    REQUIRED_ENV = ["KOTAK_API_BASE_URL", "KOTAK_CLIENT_ID", "KOTAK_CLIENT_SECRET", "KOTAK_MERCHANT_ID", "KOTAK_WEBHOOK_SECRET"]

    def configured(self) -> bool:
        return all(os.environ.get(k) for k in self.REQUIRED_ENV)

    async def initiate(self, req: dict, settings: dict) -> dict:
        raise ProviderNotAvailable("Kotak adapter is disabled until Kotak supplies approved API documentation and credentials")

    def verify_signature(self, raw: bytes, headers: dict) -> bool:
        return False  # reject every callback until the documented signature scheme is implemented


REGISTRY: dict[str, PaymentProvider] = {p.code: p for p in [MockProvider(), StaticQRProvider(), KotakProvider()]}


def get_provider(code: str) -> PaymentProvider:
    if code not in REGISTRY:
        raise ProviderNotAvailable(f"Unknown provider {code}")
    return REGISTRY[code]
