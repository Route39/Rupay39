# RUPAY39 — Payment Management & Reconciliation Platform

> **A Route39 Mobility Technology Platform**  
> Independent payment engine, automated reconciliation, bank statement imports, and multi-tenant financial reporting built for high-scale fleet operations.

---

## 🚀 Overview

**RUPAY39** is a production-ready, dedicated payment and reconciliation platform developed for Route39 Mobility. It unifies driver rental collections, bank settlement tracking, and enterprise ERP synchronization (such as MyVolt and EV Rent Driver Apps).

### Core Features
- **Payment Engine**: Real-time payment request lifecycle management, dynamic QR code generation, simulated gateway provider, and static QR fallback workflows.
- **Automated Reconciliation**: Multi-format bank statement ingestion (CSV/XLSX), UTR-based transaction matching, dispute handling, and automated exception queues.
- **Enterprise Integrations**: Outbox pattern synchronization with exponential backoff for ERP systems (MyVolt) and driver fleet applications (EV Rent).
- **Role-Based Access Control (RBAC)**: Fine-grained permissions with Clerk Authentication across Super Admin, Finance Admin, and City Supervisor roles.
- **Financial Auditing & Reporting**: 13 exportable finance reports (CSV, XLSX, PDF) with full idempotency guarantees and tamper-evident audit logging.
- **Built for Scale**: Designed to manage transaction flows for 5,000+ commercial electric vehicles.

---

## 🛠 Tech Stack

| Domain | Technologies |
|---|---|
| **Backend** | Python 3.10+, FastAPI, Starlette, Motor / PyMongo (MongoDB), Fernet Encryption, Pytest |
| **Frontend** | React 18, Tailwind CSS, Shadcn UI, Lucide Icons, Craco |
| **Authentication** | Clerk Auth (Google & Email/Password OAuth), Role-Gated RBAC |
| **Database** | MongoDB with strict unique indices for idempotency and transaction integrity |

---

## 📂 Project Structure

```text
Rupay39/
├── backend/
│   ├── server.py             # FastAPI application entry point & lifecycle hooks
│   ├── core.py               # Database connections, encryption & audit helpers
│   ├── engine.py             # Core payment state engine & idempotency checks
│   ├── recon.py              # Bank statement parser & reconciliation engine
│   ├── providers.py          # Payment gateway adapters (Mock, Static QR, Bank)
│   ├── rbac.py               # Role definitions and access guards
│   ├── sync.py               # Outbox worker for ERP synchronization
│   ├── routes_admin.py       # Administrative endpoints (Users, Vehicles, Drivers)
│   ├── routes_finance.py     # Settlements, reports, and exception management
│   ├── routes_system.py      # System settings, logs, and diagnostics
│   ├── routes_v1.py          # External Partner API (X-API-Key protected)
│   ├── requirements.txt      # Python dependencies
│   └── tests/                # Comprehensive test suite (20+ mandatory cases)
├── frontend/
│   ├── src/
│   │   ├── pages/            # Dashboard, Payments, Reconciliation, Reports, etc.
│   │   ├── components/       # UI component library & AppShell navigation
│   │   ├── context/          # User context & role providers
│   │   └── lib/              # API clients & currency formatters
│   └── package.json          # Frontend dependencies & scripts
├── memory/
│   └── PRD.md                # Product Requirements Document
└── README.md
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Python** 3.10+
- **Node.js** 18+ & **npm** or **yarn**
- **MongoDB** running locally or a MongoDB Atlas URI

---

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables (create .env)
# MONGO_URL=mongodb://localhost:27017/rupay39
# ADMIN_EMAIL=support@route39.in
# SECRET_KEY=your-encryption-secret

# Run backend server
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Interactive API documentation will be available at:
- **Swagger UI**: [http://localhost:8000/api/docs](http://localhost:8000/api/docs)
- **ReDoc**: [http://localhost:8000/api/redoc](http://localhost:8000/api/redoc)

---

### 3. Frontend Setup

```bash
cd frontend

# Install packages
npm install

# Configure environment variables (create .env)
# REACT_APP_BACKEND_URL=http://localhost:8000
# REACT_APP_CLERK_PUBLISHABLE_KEY=your_clerk_key

# Start development server
npm start
```

Access the UI at: [http://localhost:3000](http://localhost:3000)

---

## 🧪 Testing

The platform includes an automated pytest suite covering 20+ mandatory end-to-end payment and reconciliation test cases:

```bash
cd backend
pytest -v
```

---

## 🔒 Security & Idempotency Guarantees
- Strict compound indexes on `(provider, provider_txn_id)` and `(utr, kind)` prevent duplicate crediting.
- Partner endpoints require `X-API-Key` headers scoped strictly per client tenant.
- Sensitive credentials and keys are symmetrically encrypted at rest via cryptography Fernet keys.

---

## 📄 License & Ownership
Copyright © Route39 Mobility. All rights reserved.
