# Agentic Commerce Protocol (ACP) Specification

## Overview

ACP enables AI agents to discover product catalogs, authenticate with user consent, and execute purchases on behalf of users in a standardized way.

## Discovery

- Merchants expose a **texflow.md** (or equivalent) document at a well-known URL.
- The document describes the business, catalog endpoints, and authentication flow.

## Authentication

1. User grants consent to an agent (out-of-band or via merchant UI).
2. Agent exchanges `user_consent_token` for an `access_token`:

```http
POST /auth/token
Content-Type: application/json

{
  "agent_id": "string",
  "user_consent_token": "string",
  "scope": ["read", "purchase", "track"]
}
```

3. Agent uses `Authorization: Bearer <access_token>` for API calls.

## Purchase Flow

1. Search/browse catalog.
2. Add items to cart.
3. Obtain user approval for the purchase.
4. POST to checkout with payment and approval token.
5. Track order via orders endpoint.

## Version

ACP v2.1
