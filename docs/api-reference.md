# TexFlow API Reference

Base URL: `https://api.texflow.work/v2`

## Authentication

### POST /auth/token

Exchange user consent for an access token.

**Request body**: `agent_id`, `user_consent_token`, `scope` (optional array)

**Response**: `access_token`, `expires_in`, `token_type`, `permissions`

## Catalog

### GET /catalog/manifest

Requires: `Authorization: Bearer <token>`

Returns compact product list for the merchant.

### GET /catalog/categories

Requires: `Authorization: Bearer <token>`

Returns category list with counts.

## Search

### GET /search/semantic?q=&limit=

Requires: `Authorization: Bearer <token>`

Returns products matching the query.

## Cart & Checkout

### POST /cart/create

Requires: `Authorization: Bearer <token>`

Body: `items`, `subtotal`. Returns `cart_id`.

### POST /checkout/:cartId/execute

Requires: `Authorization: Bearer <token>`

Body: `payment`, `shipping`, `user_approval`. Returns order details.

## Orders

### GET /orders/:orderId/track

Requires: `Authorization: Bearer <token>`

Returns order status and tracking info.

## TexFlow.md

### GET /merchants/:merchantId/texflow.md

Returns generated markdown protocol file for the merchant (no auth required for discovery).
