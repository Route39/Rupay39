# RUPAY39 — PRD

## Original problem statement
MASTER DEVELOPMENT PROMPT — RUPAY39, Independent Payment Management Platform (a Route39 Mobility technology platform). A separate FastAPI + MongoDB backend with its own admin dashboard, payment engine, verification engine and reconciliation engine. It integrates with the EV Rent Driver App (APIs only, no new driver app), MyVolt ERP (authenticated API sync with retry) and Kotak Mahindra Bank (modular adapter; sandbox/mock first; no invented endpoints; static QR interim workflow with UTR + bank-statement import; ambiguous payments go to an exception queue). Requirements: roles Supervisor / Finance Admin / Super Admin, audit logs, 13 finance reports (CSV/Excel/PDF), INR formatting, Midnight Navy / Electric Lime light theme, 15-section sidebar, idempotency, never credit twice, 20 mandatory test cases, design for 5,000+ vehicles. (Full original text is in the first user message of the job.)

## User choices
The user skipped the questions, so defaults were used: Emergent Clerk auth (email+password and Google); Phases 1–4; clearly labelled DEMO drivers and vehicles; X-API-Key for EV Rent; full-amount payments only (partial payments can be turned on in Settings). First Super Admin: support@route39.in (ADMIN_EMAIL).

## Architecture
- backend/: core.py (db, indexes, Fernet encryption, audit, paging), rbac.py (roles, Clerk member, city scope, API-key auth), providers.py (common interface: MOCK simulated, STATIC_QR, KOTAK disabled placeholder), engine.py (payment requests, verification engine, idempotent record_success, reversal/refund, expiry, UTR claims), recon.py (CSV/XLSX import, column mapping, UTR-only matching, MISSING_IN_BANK, settlements), sync.py (MyVolt/EV Rent outbox, backoff retries, SYNC_FAILED exceptions), routes_admin/finance/system/v1, seed.py. A background worker runs every 10s.
- Unique indexes: (provider, provider_txn_id); (utr, kind); webhook event_key; sync idempotency_key; receipt per txn; exception dedupe_key.
- frontend/: Clerk auth, MeContext role gating with route guards, AppShell sidebar, a generic ListTable, and 17 pages including the payment detail simulator, import wizard, exception sheet and printable receipt.
- Swagger: /api/docs.

## Personas
Super Admin (Route39 owner), Finance Admin, City Supervisor, EV Rent backend (service client).

## Implemented (2026-11-05)
- All of Phases 1–4. Testing agent iteration 1: 23/23 backend pytest tests passed (covering all 20 mandatory cases) and about 90% of frontend checks passed. Fixed after that run: list search race, route guards, simulated-request link block, partner API EV_RENT scoping, dispute dedupe response, rejected-webhook TTL, outstanding update.

## Mocked / pending
- MOCK provider (SIMULATED), MyVolt mock acknowledgement (set MYVOLT_PAYMENT_SYNC_URL + MYVOLT_API_KEY), EV Rent outbound mock (EVRENT_WEBHOOK_URL + EVRENT_WEBHOOK_SECRET). The Kotak adapter is disabled until the bank provides documentation.

## Backlog
- P0: Kotak adapter built from the bank's documentation; real MyVolt endpoint; static QR image/VPA in Settings.
- P1: shadcn date picker; sync-status polling on detail page; Redis-backed rate limiter; partner API per-client ownership; JWKS errors -> 503.
- P2: load testing, backup/monitoring runbook, controlled rollout.
