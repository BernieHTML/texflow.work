# VyEx Payments

How paid experts work with Stripe and ACP.

## Overview

- Free experts: GET /vyex/expert/ID/preamble returns 200 and preamble.
- Paid experts: Same URL returns 402 with checkout_url until user pays. After payment use access_token (query or Bearer) for 200 and preamble.

BASE_URL in .env is the app origin (e.g. https://texflow.work or http://localhost:5001).

## URLs from catalog

Each expert has preamble_url and checkout_url. Example: preamble_url = BASE_URL/vyex/expert/pet-medication-expert/preamble, checkout_url = BASE_URL/vyex/expert/pet-medication-expert/checkout.

## Env vars

STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, BASE_URL.

## Human flow

User clicks Purchase to checkout_url, pays on Stripe, redirected to success page with session_id. Success page calls complete-session API to get access_token. User copies token or preamble URL with token.

## Agent flow (ACP)

1. GET catalog, get preamble_url and checkout_url.
2. GET preamble_url. If 402, direct user to checkout_url.
3. After payment get token via GET /vyex/api/expert/ID/complete-session?session_id=SESSION_ID.
4. GET preamble_url?access_token=TOKEN or Authorization Bearer TOKEN for preamble.

## Webhook

POST BASE_URL/webhooks/stripe receives checkout.session.completed. Use STRIPE_WEBHOOK_SECRET. Local dev: stripe listen --forward-to localhost:5001/webhooks/stripe.

## Going live

Use live Stripe keys and webhook secret; set BASE_URL to production. Min price 4.99 USD.
