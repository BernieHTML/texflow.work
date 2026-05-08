# VyEx — Agent Guide

**Base URL:** `https://texflow.work`

**Machine-readable:** fetch this file with `GET /.well-known/vyex.md` (markdown).

VyEx is a catalog of **experts**: curated base knowledge (preambles) that Vy desktop agents load before running workflows. This document tells agents how to discover experts and retrieve their preamble content.

---

## Quick summary

| Step | Action |
|------|--------|
| 1 | Fetch the catalog: `GET /.well-known/vyex.json` or `GET /vyex/api/catalog` |
| 2 | Choose an expert by `id`, `category`, or `tags` |
| 3 | For that expert, fetch preamble: `GET /vyex/expert/{id}/preamble` |
| 4 | Use the returned plain text as the workflow preamble |

---

## Endpoints

### 1. Catalog (list of experts)

**URLs (equivalent):**

- `GET https://texflow.work/.well-known/vyex.json`
- `GET https://texflow.work/vyex/api/catalog`

**Response:** JSON with:

- `capability` — protocol/auth info (e.g. `ACP`, `bearer_token`).
- `experts` — array of expert entries.
- `updated_at` — date of last catalog update.

**Each expert entry:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique slug (e.g. `xero-invoice-processing`). Use in preamble URL. |
| `name` | string | Human-readable name. |
| `category` | string | One of: Accounting, Research, Design, Productivity, Data, Sales, HR, Custom. |
| `description` | string | Short description (≤160 chars). |
| `author` | string | Author handle. |
| `tags` | string[] | Tags for filtering (e.g. `["xero", "accounting"]`). |
| `price` | number | Price in USD (0 = free). |
| `paid` | boolean | `true` if paid expert. |
| `preamble_url` | string | Full URL to fetch preamble (see below). |
| `checkout_url` | string | URL for purchase (paid experts). Direct user here to pay; then use access_token with preamble (see docs/VYEX-PAYMENTS.md).  ACP/Stripe flow. |

**Example catalog request:**

```http
GET /.well-known/vyex.json
Host: texflow.work
```

**Example catalog response (trimmed):**

```json
{
  "capability": {
    "protocol": "ACP",
    "auth": "bearer_token",
    "auth_flow": "stripe_checkout"
  },
  "experts": [
    {
      "id": "xero-invoice-processing",
      "name": "Xero Invoice Processing Expert",
      "category": "Accounting",
      "description": "Base knowledge for processing and reconciling Xero invoices.",
      "author": "texflow",
      "tags": ["xero", "invoicing", "accounting"],
      "price": 0,
      "paid": false,
      "preamble_url": "https://texflow.work/vyex/expert/xero-invoice-processing/preamble",
      "checkout_url": "https://texflow.work/vyex/expert/xero-invoice-processing/checkout"
    }
  ],
  "updated_at": "2026-02-21"
}
```

---

### 2. Preamble (expert content)

**URL:**

- `GET https://texflow.work/vyex/expert/{id}/preamble`

Replace `{id}` with the expert’s `id` from the catalog (e.g. `xero-invoice-processing`).

**Response (success):**

- **Status:** `200 OK`
- **Content-Type:** `text/plain; charset=utf-8`
- **Body:** The raw preamble text. Use this as the base knowledge / preamble for the Vy workflow.

**Response (expert not found):**

- **Status:** `404`
- **Body:** JSON `{"error":"Not found"}`

**Paid experts (ACP):** If the expert is paid and no valid token is provided, the response is **402 Payment Required** with JSON body: `{"error":"payment_required","checkout_url":"..."}`. Direct the user to `checkout_url` to pay via Stripe. After payment, obtain an `access_token` (e.g. from the success page or `GET /vyex/api/expert/{id}/complete-session?session_id=...`). Then fetch the preamble with `GET preamble_url?access_token=TOKEN` or `Authorization: Bearer TOKEN`. Full payment flow: see `docs/VYEX-PAYMENTS.md`.

**Example preamble request:**

```http
GET /vyex/expert/xero-invoice-processing/preamble
Host: texflow.work
```

**Example preamble response (200):**

Plain text, e.g.:

```
You are assisting with Xero invoice processing. Key rules: (1) Always match invoices to purchase orders when a PO reference exists. (2) Default coding: use the account from the first line item unless the user specifies otherwise. ...
```

---

## Agent workflow (step by step)

1. **Fetch catalog**  
   `GET https://texflow.work/.well-known/vyex.json` (or `https://texflow.work/vyex/api/catalog`).

2. **Parse JSON**  
   Read `experts` and optionally filter by `category` or `tags` (or use `id` if known).

3. **Choose expert**  
   Pick one entry and note its `id` and `preamble_url`.

4. **Fetch preamble**  
   `GET {preamble_url}` (e.g. `GET https://texflow.work/vyex/expert/{id}/preamble`).

5. **Use content**  
   Use the response body (plain text) as the workflow preamble for Vy.

6. **Handle errors**  
   - 404: expert missing or invalid `id`.  
   - 402 (future): payment required for paid experts; `checkout_url` will be used for ACP/Stripe when available.

---

## Human-facing pages (optional)

Agents may refer users to these for context; agents should use the API endpoints above, not scrape HTML.

| Page | URL | Purpose |
|------|-----|---------|
| VyEx marketplace | `https://texflow.work/vyex/` | Browse experts (cards, filter, search). |
| Single expert | `https://texflow.work/vyex/expert/{id}` | Detail page for one expert. |
| Submit expert | `https://texflow.work/vyex/create` | Form to submit a new expert (human). |

---

## Future: paid experts and ACP

- **Paid experts** are present in the catalog with `paid: true` and a non-zero `price`. Their `preamble_url` is valid; access control for paid preambles may require an `access_token` (query or Bearer header) after payment.
- **ACP payments through Stripe** for paid experts are planned. When live, agents will be able to direct users to `checkout_url` and, after payment, use the issued token to fetch the preamble. This document will be updated with the exact flow and response codes (e.g. 402 and token usage) when that is implemented.

---

## Changelog

- **2026-02-21** — Initial agent guide; catalog and preamble endpoints documented. ACP/Stripe for paid experts noted as coming soon.
n.
