"""Tests for Hosted Checkout and Dynamic UPI Intent Engine."""
import pytest
from httpx import AsyncClient, ASGITransport
from server import app


@pytest.mark.asyncio
async def test_create_and_poll_checkout_order():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create Checkout Order
        res = await client.post("/api/checkout/orders", json={
            "amount": 750.50,
            "purpose": "Fleet Daily Recharge",
            "customer_name": "Test Driver",
            "customer_phone": "+919988776655",
        })
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["order_id"].startswith("ord_r39_")
        assert data["amount"] == 750.50
        assert data["status"] == "PENDING"
        assert "upi://pay?" in data["upi_intent_url"]
        assert "tez://upi/pay?" in data["upi_uris"]["gpay"]
        assert "phonepe://pay?" in data["upi_uris"]["phonepe"]
        assert "paytmmp://upi/pay?" in data["upi_uris"]["paytm"]

        order_id = data["order_id"]

        # 2. Poll Order Status (Public)
        poll_res = await client.get(f"/api/checkout/orders/{order_id}")
        assert poll_res.status_code == 200
        poll_data = poll_res.json()
        assert poll_data["order_id"] == order_id
        assert poll_data["status"] == "PENDING"
        assert poll_data["amount"] == 750.50
        assert poll_data["receipt_no"] is None

        # 3. Simulate Instant Payment
        sim_res = await client.post(f"/api/checkout/orders/{order_id}/simulate-pay")
        assert sim_res.status_code == 200, sim_res.text
        sim_data = sim_res.json()
        assert sim_data["status"] == "SUCCESS"
        assert sim_data["receipt_no"].startswith("R39-RCPT-")
        assert sim_data["utr"] is not None

        # 4. Verify Poll detects SUCCESS instantly with receipt link
        after_poll = await client.get(f"/api/checkout/orders/{order_id}")
        assert after_poll.status_code == 200
        after_data = after_poll.json()
        assert after_data["status"] == "SUCCESS"
        assert after_data["receipt_no"] == sim_data["receipt_no"]
        assert after_data["utr"] == sim_data["utr"]
        assert after_data["receipt_url"] == f"/receipts/{sim_data['receipt_no']}"

        # 5. Verify Public Receipt endpoint
        rcpt_res = await client.get(f"/api/checkout/receipts/{sim_data['receipt_no']}")
        assert rcpt_res.status_code == 200
        rcpt_data = rcpt_res.json()
        assert rcpt_data["receipt"]["amount"] == 750.50
        assert rcpt_data["receipt"]["receipt_no"] == sim_data["receipt_no"]

