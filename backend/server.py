import asyncio
import logging
import os
from contextlib import suppress

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import ensure_indexes, db, client, now, new_id
from auth import auth_router
from routes_admin import router as admin_router
from routes_finance import router as finance_router
from routes_system import router as system_router
from routes_v1 import router as v1_router, hooks as hooks_router
from routes_checkout import router as checkout_router
from engine import expire_requests
from rbac import RETIRED_ROLES
from seed import bootstrap
import sync

logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","log":"%(name)s","msg":"%(message)s"}')
log = logging.getLogger("rupay39")

app = FastAPI(title="RUPAY39 API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url="/api/redoc",
              description="RUPAY39 payment management & reconciliation platform. Powered by Route39 Mobility. "
                          "Partner endpoints under /api/v1 require the X-API-Key header issued in API Integrations.")


@app.get("/api/health")
async def health():
    await db.command("ping")
    return {"status": "ok", "service": "rupay39", "time": now().isoformat()}


for r in (auth_router, admin_router, finance_router, system_router, v1_router, hooks_router, checkout_router):
    app.include_router(r)

app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                   allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["*"])


async def worker():
    while True:
        try:
            await expire_requests()
            await sync.process_queues()
        except Exception as e:
            log.exception("worker error: %s", e)
        await asyncio.sleep(10)


async def ensure_admin_account():
    admins = [e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "support@route39.in").split(",") if e.strip()]
    for email in admins:
        exists = await db.users.find_one({"email": email})
        if not exists:
            uid = new_id("USR")
            # No hardcoded password: user sets their password upon first login or registration
            await db.users.insert_one({
                "id": uid,
                "user_id": uid,
                "name": "Super Admin",
                "email": email,
                "role": "admin",
                "cities": [],
                "active": True,
                "created_at": now(),
                "updated_at": now(),
            })


@app.on_event("startup")
async def startup():
    await ensure_indexes()
    for old, new in RETIRED_ROLES.items():
        await db.users.update_many({"role": old}, {"$set": {"role": new}})
    await bootstrap()
    await ensure_admin_account()
    app.state.worker = asyncio.create_task(worker())


@app.on_event("shutdown")
async def shutdown():
    app.state.worker.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.worker
    client.close()
