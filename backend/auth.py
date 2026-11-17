import os
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional
import jwt
import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, now, new_id, clean, audit

JWT_SECRET = os.environ.get("JWT_SECRET", "rupay39-jwt-secret-route39-mobility-2026-prod")
JWT_ALG = "HS256"
JWT_EXP_DAYS = 30

auth_router = APIRouter(prefix="/api")


def hash_password(password: str) -> str:
    """Hashes a plaintext password with bcrypt without any hardcoded default."""
    if not password:
        raise ValueError("Password cannot be empty")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: Optional[str]) -> bool:
    """Verifies a plaintext password against a bcrypt hash."""
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, email: str, role: Optional[str] = None) -> str:
    """Creates a signed HS256 JWT access token valid for 30 days."""
    curr_time = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "user_id": user_id,
        "email": email.strip().lower(),
        "role": role or "",
        "iat": curr_time,
        "exp": curr_time + timedelta(days=JWT_EXP_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    """Decodes and validates a JWT token."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")


async def require_user(request: Request) -> dict:
    """FastAPI dependency: authenticates user via Bearer token or cookie."""
    token = None
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.cookies.get("rupay39_token") or request.cookies.get("token") or request.cookies.get("__session")
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    claims = decode_token(token)
    return {"user_id": claims["sub"], "email": claims.get("email"), "role": claims.get("role"), "claims": claims}


async def optional_user(request: Request) -> Optional[dict]:
    """FastAPI dependency: returns user claims or API client if credentials present, else None."""
    api_key = request.headers.get("x-api-key", "").strip()
    if api_key:
        h = hashlib.sha256(api_key.encode()).hexdigest()
        client = await db.api_clients.find_one({"key_hash": h, "active": True}, {"_id": 0})
        if client:
            return {"user_id": client["id"], "email": client["name"], "role": "api_client", "client": client}
    try:
        return await require_user(request)
    except HTTPException:
        return None


# Schemas
class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=128)


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    cities: Optional[list[str]] = None


@auth_router.get("/clerk/config")
def clerk_config():
    """Stub so any legacy check knows Clerk is disabled in favor of native JWT."""
    return {
        "enabled": False,
        "publishable_key": "",
        "proxy_url": "",
    }


@auth_router.post("/auth/login")
async def auth_login(body: LoginIn):
    email = body.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    pwd_hash = user.get("password_hash")
    if not pwd_hash:
        # User created without password (e.g. invited/seeded) - set their chosen password on first login
        pwd_hash = hash_password(body.password)
        await db.users.update_one({"id": user.get("id") or user.get("user_id")}, {"$set": {"password_hash": pwd_hash}})
    elif not verify_password(body.password, pwd_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Your account has been deactivated.")

    from rbac import effective_role
    role = effective_role(user.get("role"))
    uid = user.get("user_id") or user.get("id")
    token = create_token(uid, user["email"], role)
    await audit(user, "AUTH_LOGIN", "user", uid, f"{user.get('email')} signed in")
    return {
        "token": token,
        "user": clean({**user, "role": role})
    }


@auth_router.post("/auth/register")
async def auth_register(body: RegisterIn):
    email = body.email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    admins = {e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "support@route39.in").split(",") if e.strip()}
    is_admin = email in admins
    role = "admin" if is_admin else "pending"
    uid = new_id("USR")
    pwd_hash = hash_password(body.password)

    user_doc = {
        "id": uid,
        "user_id": uid,
        "name": body.name.strip(),
        "email": email,
        "role": role,
        "cities": body.cities or [],
        "active": True,
        "password_hash": pwd_hash,
        "created_at": now(),
        "updated_at": now(),
    }
    await db.users.insert_one(user_doc)
    token = create_token(uid, email, role)
    await audit(user_doc, "AUTH_REGISTER", "user", uid, f"{email} registered as {role}")
    return {
        "token": token,
        "user": clean(user_doc)
    }
