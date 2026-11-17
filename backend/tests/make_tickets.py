import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
from auth import create_token
from tests.conftest import TEST_ROLES


def make_token(role: str):
    uid, email, r = TEST_ROLES.get(role, (f"usr_{role}", f"{role}@route39.in", role))
    return create_token(uid, email, r)


if __name__ == "__main__":
    role = sys.argv[1] if len(sys.argv) > 1 else "admin"
    print(make_token(role))
