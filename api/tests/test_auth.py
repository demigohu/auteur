import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from auteur.auth import ClerkAuth, frontend_api

FAPI = "brave-otter-12.clerk.accounts.dev"
PK = "pk_test_" + base64.b64encode(f"{FAPI}$".encode()).decode().rstrip("=")
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def auth(monkeypatch: pytest.MonkeyPatch) -> ClerkAuth:
    a = ClerkAuth(PK, ["http://localhost:3000"])
    monkeypatch.setattr(a, "signing_key", lambda token: KEY.public_key())
    return a


def token(key=KEY, **claims) -> str:
    now = int(time.time())
    body = {"iss": f"https://{FAPI}", "sub": "user_2abc", "sid": "sess_1", "iat": now, "exp": now + 60, "azp": "http://localhost:3000"}
    return jwt.encode({**body, **claims}, key, algorithm="RS256")


def test_frontend_api_comes_from_the_publishable_key() -> None:
    assert frontend_api(PK) == FAPI


def test_valid_token_gives_the_user(auth: ClerkAuth) -> None:
    assert auth.user_id(token()) == "user_2abc"


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": int(time.time()) - 60},
        {"iss": "https://someone-else.clerk.accounts.dev"},
        {"azp": "https://evil.example"},
        {"sts": "pending"},
    ],
)
def test_bad_claims_are_rejected(auth: ClerkAuth, claims: dict) -> None:
    assert auth.user_id(token(**claims)) is None


def test_wrong_signature_and_garbage_are_rejected(auth: ClerkAuth) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert auth.user_id(token(key=other)) is None
    assert auth.user_id("not-a-jwt") is None
    assert auth.user_id(None) is None
