import httpx
from typing import List, Optional


class TexFlowAgentClient:
    def __init__(self, base_url: str = "https://api.texflow.work/v2"):
        self.base_url = base_url.rstrip("/")

    def get_token(
        self,
        agent_id: str,
        user_consent_token: str,
        scope: Optional[List[str]] = None,
    ) -> dict:
        scope = scope or ["read", "purchase", "track"]
        with httpx.Client() as client:
            r = client.post(
                f"{self.base_url}/auth/token",
                json={
                    "agent_id": agent_id,
                    "user_consent_token": user_consent_token,
                    "scope": scope,
                },
            )
            r.raise_for_status()
            return r.json()

    def search(
        self, access_token: str, query: str, limit: int = 20
    ) -> dict:
        with httpx.Client() as client:
            r = client.get(
                f"{self.base_url}/search/semantic",
                params={"q": query, "limit": limit},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            r.raise_for_status()
            return r.json()
