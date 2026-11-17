# RUPAY39 | Enterprise Payment Gateway & Bank Reconciliation Platform
### Official Platform Operational Manual & Integration Guide
**Powered by Route39 Mobility**

---

## 1. Platform Overview

**RUPAY39** is a self-hosted, enterprise-grade payment gateway and bank reconciliation platform designed for fleet operations, EV battery leasing, ride-hailing networks, and business collections.

Like Razorpay and Cashfree, RUPAY39 provides:
- **Dynamic UPI QR Code Generation**: Instant QR codes with custom amounts, merchant VPA, and locked transaction references.
- **Mobile UPI Intent Engine**: 1-tap app launch buttons for Google Pay (`tez://`), PhonePe (`phonepe://`), Paytm (`paytmmp://`), and standard BHIM/banking apps (`upi://`).
- **Real-Time 1.5s Auto-Confirmation**: Listens for bank settlement and immediately updates the payer's screen with celebratory animations and official receipts.
- **Idempotent Financial Ledger**: Prevents duplicate payments, duplicate UTR credits, and phantom claims.
- **Automated Bank Reconciliation**: Upload Kotak / HDFC / ICICI bank statements (CSV/Excel) and reconcile thousands of collections in seconds.

---

## 2. Architecture & Tech Stack

```
                          ┌─────────────────────────────┐
                          │   Driver App / Rider App    │
                          │   Web Checkout / ERP Client │
                          └──────────────┬──────────────┘
                                         │  (HTTPS / X-API-Key)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             RUPAY39 PLATFORM                                │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ FRONTEND (React 19 + Tailwind + UI)  │ BACKEND (FastAPI + Python 3.14)      │
│ • Hosted Checkout (/pay/:orderId)    │ • Checkout Router (/api/checkout)    │
│ • Payment Links Portal (Razorpay UI) │ • Partner V1 APIs (/api/v1)          │
│ • Admin Financial Dashboard          │ • Native JWT Authentication Engine   │
│ • Interactive Developer Playground   │ • Bank Statement Reconciliation Core │
│ • Printable Tax Receipts Engine      │ • Idempotent UTR & Receipt Engine    │
├──────────────────────────────────────┴──────────────────────────────────────┤
│ DATABASE: MongoDB 7.0 with Unique Index Locks on UTR, Ref, Orders & Users   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. User Roles & Security

| Role | Access Scope | Intended Users |
| :--- | :--- | :--- |
| **Super Admin** | Full access to all cities, API key issuance, user management, audit logs, provider credentials. | CTO, Head of Engineering, Platform Owner |
| **Finance Admin** | Payments, Bank Transactions, Reconciliation, Exceptions, Settlements, Reports, Providers. | CFO, Finance Team, Accounts Managers |
| **Supervisor** | Drivers, Vehicles, Unmatched Disputes, Payment Requests (scoped to assigned cities e.g. Chennai). | Hub Supervisors, Depot Managers |
| **API Client** | Service-to-service authenticated machine access via `X-API-Key`. | Driver Mobile Apps, EV Rent Backend, MyVolt ERP |

> **No Default Hardcoded Passwords**: All user passwords are encrypted using multi-round bcrypt. Credentials can be managed directly in the Admin console.

---

## 4. How Companies & Apps Integrate with Rupay39

Rupay39 supports 3 integration models:

### Method A: Mobile Driver / Rider App Integration (Recommended)
This is the standard integration flow used by Uber, Ola, and Swiggy:

```
[Driver App]                  [Rupay39 Gateway]                [Bank / UPI]
     │                                │                             │
     │ 1. POST /api/checkout/orders   │                             │
     ├───────────────────────────────>│                             │
     │    (amount, driver_id, name)   │                             │
     │                                │                             │
     │ 2. Returns checkout_url        │                             │
     │<───────────────────────────────┤                             │
     │                                │                             │
     │ 3. App opens checkout_url      │                             │
     │    in In-App WebView           │                             │
     ├───────────────────────────────>│                             │
     │                                │  4. User pays on GPay/PhonePe│
     │                                ├────────────────────────────>│
     │                                │                             │
     │                                │  5. Instant Bank Callback   │
     │                                │<────────────────────────────┤
     │                                │                             │
     │ 6. WebView animates Success!   │                             │
     │    & redirects to Driver App   │                             │
     │<───────────────────────────────┤                             │
```

#### Step 1: Create Checkout Order from your Backend
```bash
POST http://localhost:8010/api/checkout/orders
Headers:
  Content-Type: application/json
  X-API-Key: r39_ev_rent_g_ut-3KCGV4aRDvgz4jHaQW6_h0SRN9Po85RxXeHlO8

Body:
{
  "amount": 450.00,
  "purpose": "Daily EV Battery & Fleet Rent",
  "customer_name": "Ramesh Kumar",
  "customer_phone": "+919876543210",
  "driver_id": "DRV-0001",
  "redirect_url": "route39://payment-complete"
}
```

#### Step 2: Open `checkout_url` in Driver App
Your app simply opens the returned `checkout_url`:
```
http://localhost:3010/pay/ord_r39_2ce7d31298dd
```
- On **Android / iOS**: The driver taps **Google Pay**, **PhonePe**, or **Paytm** to launch the installed UPI app with amount locked.
- On **Desktop**: Displays the **Dynamic UPI QR Code** with live 15-minute countdown.

---

### Method B: Server-to-Server Backend Integration

#### In Node.js / Express:
```javascript
import axios from "axios";

const rupay = axios.create({
  baseURL: "http://localhost:8010/api",
  headers: {
    "X-API-Key": process.env.RUPAY39_API_KEY,
    "Content-Type": "application/json"
  }
});

// 1. Create a payment link
export async function generatePaymentLink(driverId, amount, purpose) {
  const { data } = await rupay.post("/checkout/orders", {
    amount,
    purpose,
    driver_id: driverId,
  });
  return data.checkout_url;
}

// 2. Poll / Verify payment confirmation
export async function checkPayment(orderId) {
  const { data } = await rupay.get(`/checkout/orders/${orderId}`);
  return {
    isPaid: data.status === "SUCCESS",
    receiptNo: data.receipt_no,
    utr: data.utr
  };
}
```

#### In Python:
```python
import requests

API_KEY = "r39_ev_rent_g_ut-3KCGV4aRDvgz4jHaQW6_h0SRN9Po85RxXeHlO8"
BASE_URL = "http://localhost:8010/api"

# 1. Create Payment
res = requests.post(f"{BASE_URL}/checkout/orders", json={
    "amount": 500.0,
    "purpose": "Daily Fleet Rental",
    "driver_id": "DRV-0001"
}, headers={"X-API-Key": API_KEY}).json()

print("Checkout Link for Driver:", res["checkout_url"])
```

---

### Method C: Drop-in Web Popup SDK (For Web Portals)

Any website or web dashboard can pop up the Rupay39 checkout modal using the included drop-in SDK:

```html
<script type="module">
  import { Rupay39Checkout } from "/lib/checkout.js";

  document.getElementById("pay-button").onclick = async () => {
    // 1. Create Order
    const order = await Rupay39Checkout.createOrder({
      amount: 600.00,
      purpose: "EV Battery Swap",
      customer_name: "Driver 101"
    });

    // 2. Open Modal
    Rupay39Checkout.open({
      orderId: order.order_id,
      onSuccess: (order) => {
        alert("Payment successful! Receipt: " + order.receipt_no);
        window.location.reload();
      },
      onClose: () => {
        console.log("Modal closed");
      }
    });
  };
</script>
```

---

## 5. Daily Operations Guide for Staff

### 1. Generating & Sharing Payment Links
1. Open **[http://localhost:3010/payment-links](http://localhost:3010/payment-links)**.
2. Click **Create Payment Link**.
3. Enter the amount (₹), driver name, phone number, and purpose.
4. Click **Generate Payment Link**.
5. Click the **WhatsApp Share** button or **Copy Link** to send it directly to the customer or driver.

### 2. Live Bank Statement Reconciliation
1. At the end of each shift or day, export your bank statement (Kotak / HDFC / ICICI) in CSV or Excel.
2. Navigate to **Reconciliation** (`/reconciliation`).
3. Upload the statement. Rupay39 parses the bank rows, runs hash deduplication, matches UTRs against open payment requests, and flags any unmatched or duplicate claims into the **Unmatched Payments** queue.
4. Total reconciled volume and bank settlement records are updated instantly.

### 3. Printing Official Tax Receipts
- Official receipts are issued at `/receipts/R39-RCPT-YYYYMMDD-XXXXXX`.
- Fully responsive with printable styles (`window.print()`), displaying company name, GST/PAN details, bank UTR, driver vehicle ID, and rental line-item components.

---

## 6. Production Deployment Instructions

### Backend (FastAPI / Uvicorn)
To run backend as a system service or container:
```bash
cd /Users/admin/Desktop/Rupay39/backend
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8010 --workers 4
```

### Frontend (Production Optimized)
The production build has already been generated via `yarn build` into `frontend/build`:
```bash
cd /Users/admin/Desktop/Rupay39/frontend
yarn build
# Serve with any static web server (Nginx, Caddy, Serve)
serve -s build -l 3010
```

### Production Checklist
- [x] Native bcrypt password authentication enabled.
- [x] Zero hardcoded passwords or fallback credentials.
- [x] All Emergent code purged.
- [x] Custom Route39 branding & favicons installed.
- [x] Dynamic UPI QR and mobile deep-link intent schemes configured.
- [x] All 24 backend automated tests passing.
- [x] Frontend compiling with 0 errors.

