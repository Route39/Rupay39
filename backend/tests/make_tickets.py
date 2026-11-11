import json, sys, requests
sys.path.insert(0, "/app/backend/tests")
from conftest import CLERK_SK, USERS, UA
out = {}
for role in sys.argv[1:] or ["admin"]:
    r = requests.post("https://api.clerk.com/v1/sign_in_tokens", json={"user_id": USERS[role], "expires_in_seconds": 900},
                      headers={**UA, "Authorization": f"Bearer {CLERK_SK}"}, timeout=20)
    r.raise_for_status()
    out[role] = r.json()["token"]
json.dump(out, open("/tmp/tickets.json", "w"))
print("ok", list(out))
