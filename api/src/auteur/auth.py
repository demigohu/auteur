"""Clerk session tokens, verified locally (docs: clerk.com/docs/guides/sessions/manual-jwt-verification).

The browser sends a short-lived RS256 JWT, as `Authorization: Bearer` on fetches and as the `__session`
cookie on the event stream (EventSource cannot set headers). We check the signature against the
instance's JWKS, then issuer, expiry, the authorized party (`azp`, our own origins) and that the session
is not pending. The Clerk user id is `sub`.
"""

import base64

import jwt


def frontend_api(publishable_key: str) -> str:
    """`pk_test_<base64("example.clerk.accounts.dev$")>` -> `example.clerk.accounts.dev`."""
    encoded = publishable_key.split("_", 2)[2]
    return base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode().rstrip("$")


class ClerkAuth:
    def __init__(self, publishable_key: str, authorized_parties: list[str], jwks_url: str = "") -> None:
        self.issuer = f"https://{frontend_api(publishable_key)}"
        self.authorized_parties = set(authorized_parties)
        self._jwks = jwt.PyJWKClient(jwks_url or f"{self.issuer}/.well-known/jwks.json", cache_keys=True, lifespan=3600)

    def signing_key(self, token: str):
        return self._jwks.get_signing_key_from_jwt(token).key

    def user_id(self, token: str | None) -> str | None:
        """The Clerk user id for a valid session token, else None."""
        if not token:
            return None
        try:
            claims = jwt.decode(
                token,
                self.signing_key(token),
                algorithms=["RS256"],
                issuer=self.issuer,
                leeway=5,
                options={"require": ["exp", "iat", "iss", "sub"]},
            )
        except (jwt.PyJWTError, jwt.PyJWKClientError):
            return None
        azp = claims.get("azp")
        if azp and azp not in self.authorized_parties:
            return None
        if claims.get("sts") == "pending":
            return None
        return claims["sub"]
