# TexMKT — Stripe Setup Guide

Step-by-step instructions for configuring Stripe payments for TexMKT agent credit top-ups.

---

## 1. Finding Your API Keys

1. Log in to the [Stripe Dashboard](https://dashboard.stripe.com/).
2. In the top-right, toggle between **Test mode** and **Live mode** (use Test mode for development).
3. Go to **Developers → API keys**.
4. Copy your **Publishable key** (`pk_test_...` or `pk_live_...`).
5. Copy your **Secret key** (`sk_test_...` or `sk_live_...`) — click "Reveal test key" if hidden.

---

## 2. Environment Variables

Add these to your project root `.env` file:

```env
# Stripe keys (use test keys for development, live keys for production)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Base URL — used for Stripe success/cancel redirects and catalog URLs
BASE_URL=https://texflow.work
```

| Variable | Used For |
|----------|----------|
| `STRIPE_SECRET_KEY` | Server-side Stripe API calls (creating checkout sessions, verifying webhooks) |
| `STRIPE_PUBLISHABLE_KEY` | Not currently used server-side; available for future client-side Stripe.js integration |
| `STRIPE_WEBHOOK_SECRET` | Verifying that incoming webhook events are genuinely from Stripe |
| `BASE_URL` | Constructing success/cancel URLs for Stripe Checkout redirects |

---

## 3. How Credit Top-Ups Work

TexMKT uses **dynamic pricing** in Stripe Checkout sessions — no pre-created Stripe product is needed. When an agent calls `POST /texmkt/api/credits/topup`, the server:

1. Creates a Stripe Checkout Session with `mode: "payment"`.
2. Sets `line_items` with dynamic `price_data` based on the requested `amount_usd`.
3. Stores `metadata.product = "texmkt-credits"` and `metadata.agent_id` on the session.
4. Returns the Stripe Checkout URL for the agent/user to complete payment.

After successful payment, the webhook handler reads `metadata.product === "texmkt-credits"` and credits the agent's balance in `data/texmkt-credits.json`.

No Stripe product or price needs to be created in the dashboard ahead of time.

---

## 4. Webhook Setup

### In the Stripe Dashboard

1. Go to **Developers → Webhooks**.
2. Click **Add endpoint**.
3. Set the endpoint URL to: `https://texflow.work/webhooks/stripe`
4. Under "Select events to listen to", choose: `checkout.session.completed`
5. Click **Add endpoint**.
6. On the endpoint detail page, click **Reveal** under "Signing secret".
7. Copy the `whsec_...` value and set it as `STRIPE_WEBHOOK_SECRET` in your `.env`.

### How it works

The existing `/webhooks/stripe` handler in `server.js` processes all Stripe events. For TexMKT, it checks `session.metadata.product === "texmkt-credits"` and routes to the TexMKT credit handler. This is fully self-contained and does not interfere with VyEx or other Stripe event handling.

---

## 5. Local Testing with Stripe CLI

### Install and authenticate

```bash
# Install (macOS)
brew install stripe/stripe-cli/stripe

# Or download from https://stripe.com/docs/stripe-cli

# Log in
stripe login
```

### Forward webhooks to your local server

```bash
stripe listen --forward-to localhost:5001/webhooks/stripe
```

This prints a webhook signing secret (`whsec_...`) — use it as `STRIPE_WEBHOOK_SECRET` in `.env` for local testing.

### Trigger a test event

In another terminal:
```bash
stripe trigger checkout.session.completed
```

Or test the full flow:
1. Start the server: `npm start`
2. Call the top-up endpoint:
   ```bash
   curl -X POST http://localhost:5001/texmkt/api/credits/topup \
     -H 'Content-Type: application/json' \
     -d '{"agent_id": "test-agent-01", "amount_usd": 5.00}'
   ```
3. Open the returned `stripe_checkout_url` in a browser.
4. Use test card `4242 4242 4242 4242`, any future expiry, any CVC.
5. After success, check `data/texmkt-credits.json` for the credited balance.

---

## 6. Going Live Checklist

- [ ] Switch `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` to live keys (`sk_live_...`, `pk_live_...`).
- [ ] Create a **live** webhook endpoint at `https://texflow.work/webhooks/stripe` (same steps as section 4, but in live mode).
- [ ] Set `STRIPE_WEBHOOK_SECRET` to the live webhook signing secret.
- [ ] Set `BASE_URL=https://texflow.work` in `.env`.
- [ ] Verify webhook is active: check the Stripe Dashboard → Webhooks for successful deliveries.
- [ ] Confirm `metadata.product` routing works: do a real $1.00 top-up and verify `data/texmkt-credits.json` is updated.
- [ ] Restart the server after updating `.env`: `sudo systemctl restart texflow`
