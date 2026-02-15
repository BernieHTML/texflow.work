# {{BUSINESS_NAME}} - Agent Commerce Interface

> **🤖 POWERED BY TEXFLOW** | [What is this?](https://texflow.work/what-is-acp)  
> **Website**: {{WEBSITE_URL}}  
> **Protocol**: Agentic Commerce Protocol (ACP) v2.1  
> **Generated**: {{TIMESTAMP}}  
> **API Base**: `{{API_BASE_URL}}`

---

## 🎯 For AI Agents: Quick Start

**You are an AI agent. Your user wants to purchase products from {{BUSINESS_NAME}}.**

### What This File Contains:
1. ✅ Complete product catalog with structured data
2. ✅ Real-time inventory and pricing
3. ✅ ACP-compliant purchase workflow
4. ✅ All API endpoints you need

### How to Use:
```bash
# 1. Authenticate
curl -X POST {{API_BASE_URL}}/auth/token \
  -d '{"agent_id":"your-agent-id","user_consent_token":"{{USER_TOKEN}}"}'

# 2. Search products
curl "{{API_BASE_URL}}/search?q=your+search"

# 3. Execute purchase
curl -X POST {{API_BASE_URL}}/checkout/execute \
  -H "Authorization: Bearer {{TOKEN}}" \
  -d '{"cart_id":"xxx","payment_method":"stripe","approval_token":"{{APPROVAL}}"}'
```

---

## 🏢 About {{BUSINESS_NAME}}

**Industry**: {{INDUSTRY}}  
**Specialization**: {{SPECIALIZATION}}  
**Headquarters**: {{LOCATION}}  
**Customer Support**: {{SUPPORT_EMAIL}} | {{SUPPORT_PHONE}}

{{BUSINESS_DESCRIPTION}}

---

## 🔐 Authentication

### Get Agent Access Token

```http
POST {{API_BASE_URL}}/auth/token
Content-Type: application/json

{
  "agent_id": "your-agent-identifier",
  "user_consent_token": "token-from-user-approval",
  "scope": "read purchase",
  "ttl": 3600
}
```

**Response**:
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "permissions": ["browse", "purchase", "track"],
  "rate_limits": {
    "browse": "1000/min",
    "purchase": "100/min"
  }
}
```

**Security Notes**:
- User must explicitly approve agent access
- Tokens expire after 1 hour
- All purchases require user approval (configurable threshold)
- Full audit trail maintained

---

## 📦 Product Catalog

### Catalog Overview

**Total Products**: {{TOTAL_PRODUCTS}}  
**Categories**: {{TOTAL_CATEGORIES}}  
**Last Updated**: {{CATALOG_LAST_UPDATED}}

### Quick Access Endpoints

```yaml
# Get full catalog manifest
GET {{API_BASE_URL}}/catalog/manifest?format=compact

# Get category tree
GET {{API_BASE_URL}}/catalog/categories?depth=3

# Get product by SKU
GET {{API_BASE_URL}}/products/{{SKU}}

# Search products
GET {{API_BASE_URL}}/search?q={{QUERY}}&filters={{FILTERS}}
```

---

## 🔍 Featured Products

{{#FEATURED_PRODUCTS}}
### {{PRODUCT_NAME}}

**SKU**: `{{PRODUCT_SKU}}`  
**Category**: {{PRODUCT_CATEGORY}}

```json
{
  "sku": "{{PRODUCT_SKU}}",
  "name": "{{PRODUCT_NAME}}",
  "description": "{{PRODUCT_DESCRIPTION}}",
  "price": {
    "base": {{BASE_PRICE}},
    "currency": "{{CURRENCY}}",
    "bulk_tiers": {{BULK_TIERS_JSON}}
  },
  "inventory": {
    "available": {{STOCK_QUANTITY}},
    "warehouse": "{{WAREHOUSE_ID}}",
    "lead_time_days": {{LEAD_TIME}},
    "low_stock_threshold": {{LOW_STOCK_THRESHOLD}}
  },
  "specifications": {{SPECIFICATIONS_JSON}},
  "images": {{IMAGES_ARRAY}},
  "tags": {{TAGS_ARRAY}},
  "actions": {
    "add_to_cart": "POST {{API_BASE_URL}}/cart/add",
    "check_inventory": "GET {{API_BASE_URL}}/inventory/{{PRODUCT_SKU}}",
    "get_alternatives": "GET {{API_BASE_URL}}/products/{{PRODUCT_SKU}}/alternatives"
  }
}
```

**Quick Add to Cart**:
```bash
curl -X POST {{API_BASE_URL}}/cart/add \
  -H "Authorization: Bearer {{TOKEN}}" \
  -d '{"sku":"{{PRODUCT_SKU}}","quantity":{{DEFAULT_QUANTITY}}}'
```

---

{{/FEATURED_PRODUCTS}}

## 🏷️ Product Categories

{{#CATEGORIES}}
### {{CATEGORY_NAME}}

**ID**: `{{CATEGORY_ID}}`  
**Products**: {{PRODUCT_COUNT}}  
**Subcategories**: {{SUBCATEGORY_COUNT}}

**Browse**: `GET {{API_BASE_URL}}/catalog/category/{{CATEGORY_ID}}`

**Typical Use Cases**: {{USE_CASES}}

{{#SUBCATEGORIES}}
- **{{SUBCATEGORY_NAME}}** ({{SUBCATEGORY_PRODUCT_COUNT}} products)
{{/SUBCATEGORIES}}

---

{{/CATEGORIES}}

## 🔍 Smart Search & Discovery

### Semantic Search

```http
GET {{API_BASE_URL}}/search/semantic?q={{NATURAL_LANGUAGE_QUERY}}
```

**Example Queries Supported**:
```json
{
  "examples": [
    "ergonomic office chairs under $500 for 20 people",
    "color laser printer with high duty cycle",
    "standing desks with cable management",
    "wireless headsets compatible with Microsoft Teams"
  ]
}
```

**Response Format**:
```json
{
  "query": "your natural language query",
  "results": [
    {
      "sku": "PROD-001",
      "name": "Product Name",
      "price": 299.99,
      "match_score": 0.95,
      "why_matched": "Meets all criteria: ergonomic design, under budget, bulk available",
      "inventory": {
        "available": 50,
        "lead_time_days": 2
      }
    }
  ],
  "alternatives": [...],
  "recommendations": {
    "suggested_quantity": 20,
    "bulk_discount_available": true,
    "total_savings": 1200.00
  }
}
```

### Filtered Search

```http
GET {{API_BASE_URL}}/search?q={{QUERY}}&filters={{JSON_FILTERS}}
```

**Available Filters**:
```json
{
  "price": { "min": 0, "max": 10000 },
  "category": ["category-id-1", "category-id-2"],
  "brand": ["brand-1", "brand-2"],
  "in_stock": true,
  "specifications": {
    "color": "black",
    "weight_max_lbs": 50,
    "custom_field": "custom_value"
  },
  "sort": "price_asc" // or: price_desc, name_asc, popularity, newest
}
```

---

## 💰 Pricing & Bulk Discounts

### Dynamic Pricing API

```http
POST {{API_BASE_URL}}/pricing/calculate
Content-Type: application/json

{
  "items": [
    {"sku": "PROD-001", "quantity": 50},
    {"sku": "PROD-002", "quantity": 20}
  ],
  "customer_segment": "enterprise", // optional
  "promo_code": "BULK2026" // optional
}
```

**Response**:
```json
{
  "items": [
    {
      "sku": "PROD-001",
      "quantity": 50,
      "base_price": 299.99,
      "bulk_price": 249.99,
      "tier_applied": "25-99_units",
      "discount_percent": 16.7,
      "savings_per_unit": 50.00,
      "subtotal": 12499.50
    }
  ],
  "summary": {
    "subtotal": 15999.50,
    "bulk_savings": 3500.50,
    "promo_discount": 500.00,
    "tax": 1279.96,
    "shipping": 0.00,
    "total": 16779.46
  },
  "next_tier_info": {
    "threshold": 100,
    "additional_savings": 1500.00,
    "recommendation": "Add 50 more units to save an additional $1,500"
  }
}
```

### Standard Bulk Tier Structure

```yaml
Typical Tiers (customizable per product):
  1-4 units:     Base price
  5-9 units:     5-10% discount
  10-24 units:   10-15% discount
  25-49 units:   15-20% discount
  50-99 units:   20-25% discount
  100+ units:    25-30% discount (custom quote available)
```

---

## 📊 Real-Time Inventory

### Check Availability

```http
POST {{API_BASE_URL}}/inventory/check
Content-Type: application/json

{
  "skus": ["PROD-001", "PROD-002", "PROD-003"],
  "quantities": [10, 5, 20],
  "delivery_zip": "94105" // optional, for warehouse routing
}
```

**Response**:
```json
{
  "checked_at": "2026-02-15T10:30:00Z",
  "availability": [
    {
      "sku": "PROD-001",
      "requested": 10,
      "available": 150,
      "in_stock": true,
      "warehouse": {
        "id": "WH-CA-01",
        "location": "San Francisco, CA",
        "distance_miles": 5.2
      },
      "lead_time": {
        "days": 1,
        "estimated_delivery": "2026-02-16"
      }
    },
    {
      "sku": "PROD-002",
      "requested": 5,
      "available": 3,
      "in_stock": "partial",
      "backorder": {
        "available": 2,
        "quantity": 5,
        "eta": "2026-02-20"
      },
      "alternatives": [
        {
          "sku": "PROD-002-ALT",
          "name": "Similar product",
          "available": 50,
          "price_difference": 10.00
        }
      ]
    }
  ],
  "recommendations": {
    "split_shipment": true,
    "ship_available_now": true,
    "backorder_remainder": true
  }
}
```

### Inventory Webhooks

Subscribe to inventory updates:

```http
POST {{API_BASE_URL}}/webhooks/subscribe
{
  "events": ["inventory.low", "inventory.restocked"],
  "skus": ["PROD-001", "PROD-002"],
  "callback_url": "https://your-agent-system.com/webhooks/inventory"
}
```

---

## 🛒 Shopping Cart & Checkout

### 1. Create Cart Session

```http
POST {{API_BASE_URL}}/cart/create
Authorization: Bearer {{TOKEN}}

{
  "agent_id": "your-agent-id",
  "user_id": "user-identifier",
  "ttl": 3600
}
```

**Response**:
```json
{
  "cart_id": "cart_abc123xyz",
  "created_at": "2026-02-15T10:30:00Z",
  "expires_at": "2026-02-15T11:30:00Z",
  "status": "active"
}
```

### 2. Add Items to Cart

```http
POST {{API_BASE_URL}}/cart/{{CART_ID}}/items
Authorization: Bearer {{TOKEN}}

{
  "items": [
    {
      "sku": "PROD-001",
      "quantity": 10,
      "apply_bulk_pricing": true
    },
    {
      "sku": "PROD-002",
      "quantity": 5
    }
  ]
}
```

### 3. Get Cart Summary

```http
GET {{API_BASE_URL}}/cart/{{CART_ID}}
Authorization: Bearer {{TOKEN}}
```

**Response**:
```json
{
  "cart_id": "cart_abc123xyz",
  "items": [...],
  "summary": {
    "item_count": 15,
    "subtotal": 4999.85,
    "bulk_savings": 750.15,
    "tax": 399.99,
    "shipping": 0.00,
    "total": 5399.84
  },
  "recommendations": [
    "Add 15 more PROD-001 to reach next bulk tier (save $500)"
  ]
}
```

### 4. Apply Promotion Code

```http
POST {{API_BASE_URL}}/cart/{{CART_ID}}/promo
{
  "promo_code": "BULK2026"
}
```

### 5. Execute Purchase

```http
POST {{API_BASE_URL}}/checkout/{{CART_ID}}/execute
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
  "payment": {
    "method": "stripe",
    "token": "tok_visa_{{TOKEN}}"
    // OR for business: "method": "purchase_order", "po_number": "PO-2026-001"
  },
  "shipping": {
    "address": {
      "name": "John Doe",
      "company": "Acme Corp",
      "street": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94105",
      "country": "US"
    },
    "method": "standard", // standard, expedited, overnight
    "instructions": "Leave at front desk"
  },
  "billing": {
    "same_as_shipping": true
    // OR provide separate billing address
  },
  "user_approval": {
    "token": "approval_{{UNIQUE_TOKEN}}",
    "approved_at": "2026-02-15T10:30:00Z",
    "approval_method": "explicit" // or: threshold_auto, recurring_auto
  },
  "options": {
    "send_confirmation_email": true,
    "subscribe_to_updates": false
  }
}
```

**Response**:
```json
{
  "order_id": "ORD-2026-001234",
  "status": "confirmed",
  "confirmation_number": "CNF-ABC123",
  "created_at": "2026-02-15T10:30:00Z",
  "summary": {
    "total": 5399.84,
    "payment_status": "captured",
    "items": 15
  },
  "fulfillment": {
    "estimated_ship_date": "2026-02-16",
    "estimated_delivery_date": "2026-02-18",
    "carrier": "UPS",
    "service_level": "Ground"
  },
  "tracking": {
    "url": "{{WEBSITE_URL}}/track/ORD-2026-001234",
    "api_endpoint": "GET {{API_BASE_URL}}/orders/ORD-2026-001234/track"
  },
  "receipt_url": "{{WEBSITE_URL}}/receipt/ORD-2026-001234"
}
```

---

## 📦 Order Tracking

### Track Order Status

```http
GET {{API_BASE_URL}}/orders/{{ORDER_ID}}/track
Authorization: Bearer {{TOKEN}}
```

**Response**:
```json
{
  "order_id": "ORD-2026-001234",
  "status": "shipped",
  "timeline": [
    {
      "status": "confirmed",
      "timestamp": "2026-02-15T10:30:00Z",
      "note": "Order confirmed and payment captured"
    },
    {
      "status": "processing",
      "timestamp": "2026-02-15T14:00:00Z",
      "note": "Order picked and packed at warehouse WH-CA-01"
    },
    {
      "status": "shipped",
      "timestamp": "2026-02-16T09:00:00Z",
      "note": "Handed to UPS",
      "tracking_number": "1Z999AA10123456784",
      "carrier_tracking_url": "https://www.ups.com/track?tracknum=1Z999AA10123456784"
    }
  ],
  "current_location": {
    "city": "Oakland",
    "state": "CA",
    "last_updated": "2026-02-16T15:30:00Z"
  },
  "estimated_delivery": {
    "date": "2026-02-18",
    "confidence": "high",
    "window": "10:00 AM - 2:00 PM"
  },
  "items": [
    {
      "sku": "PROD-001",
      "quantity": 10,
      "status": "shipped"
    }
  ]
}
```

### Track Multiple Orders

```http
POST {{API_BASE_URL}}/orders/track/batch
{
  "order_ids": ["ORD-2026-001234", "ORD-2026-001235"]
}
```

### Subscribe to Order Updates

```http
POST {{API_BASE_URL}}/webhooks/subscribe
{
  "events": ["order.shipped", "order.delivered", "order.delayed"],
  "order_ids": ["ORD-2026-001234"],
  "callback_url": "https://your-system.com/webhooks/orders"
}
```

**Webhook Payload Example**:
```json
{
  "event": "order.shipped",
  "timestamp": "2026-02-16T09:00:00Z",
  "order_id": "ORD-2026-001234",
  "tracking_number": "1Z999AA10123456784",
  "carrier": "UPS",
  "estimated_delivery": "2026-02-18"
}
```

---

## 🔔 Webhooks & Notifications

### Available Events

```yaml
Agent-Relevant Events:
  # Catalog Events
  - product.updated          # Price or spec changed
  - product.discontinued     # Product no longer available
  - inventory.low           # Stock below threshold
  - inventory.restocked     # Back in stock
  
  # Order Events
  - order.confirmed         # Order placed successfully
  - order.processing        # Being prepared
  - order.shipped           # Dispatched
  - order.out_for_delivery  # With carrier for final delivery
  - order.delivered         # Confirmed delivered
  - order.delayed           # Delay notification
  - order.cancelled         # Order cancelled
  
  # Price Events
  - price.changed           # Price updated
  - promotion.started       # New sale/promo active
  - promotion.ending        # Sale ending soon
```

### Subscribe to Events

```http
POST {{API_BASE_URL}}/webhooks/subscribe
Authorization: Bearer {{TOKEN}}

{
  "agent_id": "your-agent-id",
  "events": ["order.shipped", "inventory.low"],
  "callback_url": "https://your-agent.com/webhooks/texflow",
  "auth_header": "X-Agent-Secret",
  "auth_value": "your-webhook-secret",
  "filters": {
    "skus": ["PROD-001", "PROD-002"], // optional
    "order_ids": ["ORD-2026-001234"]  // optional
  }
}
```

---

## 🎯 Agent Best Practices

### 1. Efficient Catalog Browsing

```javascript
// DON'T: Fetch products one by one
for (const sku of skus) {
  await fetch(`/products/${sku}`);
}

// DO: Use batch endpoints
await fetch('/products/batch', {
  method: 'POST',
  body: JSON.stringify({ skus: skus })
});
```

### 2. Inventory Checks

```javascript
// ALWAYS check inventory before attempting purchase
const inventory = await checkInventory(skus, quantities);
if (!inventory.all_available) {
  // Handle alternatives or backorders
}
```

### 3. User Approval

```javascript
// ALWAYS get explicit user approval for purchases
const userApproved = await getUserApproval({
  total: cart.total,
  items: cart.items,
  shipping_address: address
});

if (!userApproved) {
  throw new Error('User declined purchase');
}
```

### 4. Error Handling

```javascript
try {
  const order = await executePurchase(cart);
} catch (error) {
  if (error.code === 'INSUFFICIENT_INVENTORY') {
    // Suggest alternatives
  } else if (error.code === 'PAYMENT_FAILED') {
    // Request different payment method
  }
  // Always provide clear error messages to user
}
```

### 5. Rate Limiting

```yaml
Respect Rate Limits:
  browse_endpoints: 1000 requests/min
  purchase_endpoints: 100 requests/min
  search_endpoints: 500 requests/min

If Rate Limited (429 response):
  - Wait for time specified in Retry-After header
  - Implement exponential backoff
  - Cache catalog data locally when possible
```

---

## 📊 API Performance & SLA

```yaml
Service Level Agreement:
  uptime: 99.9%
  response_time_p95: 200ms
  response_time_p99: 500ms
  
Data Freshness:
  inventory: Real-time (< 5 seconds)
  pricing: Updated every 15 minutes
  catalog: Updated every hour
  
Rate Limits:
  browse: 1000 req/min
  search: 500 req/min
  purchase: 100 req/min
  tracking: 300 req/min
  
Support Response:
  critical: < 1 hour
  high: < 4 hours
  normal: < 24 hours
```

---

## 🔒 Security & Compliance

### Data Protection

```yaml
Security Measures:
  - TLS 1.3 encryption for all API calls
  - OAuth 2.0 with short-lived tokens (1 hour)
  - User consent required for all purchases
  - PCI DSS Level 1 compliant
  - SOC 2 Type II certified
  - GDPR compliant
  
Data Retention:
  transaction_logs: 7 years
  user_approval_tokens: 90 days
  cart_sessions: 24 hours after expiration
  
Privacy:
  - No personal data shared with agents without consent
  - User can revoke agent access anytime
  - Full audit trail of all agent actions
```

### User Rights

Users can:
- ✅ View all agent activity on their behalf
- ✅ Revoke agent access instantly
- ✅ Set spending limits per agent
- ✅ Require approval for purchases over threshold
- ✅ Export all transaction data

---

## 💡 Example Agent Implementation

### Python SDK Example

```python
from texflow_client import TexFlowClient

# Initialize client
client = TexFlowClient(
    base_url="{{API_BASE_URL}}",
    agent_id="your-agent-id",
    user_consent_token="user-token-here"
)

# Search for products
results = client.search("ergonomic office chairs", bulk=True)

# Check inventory
inventory = client.check_inventory([
    {"sku": results[0].sku, "quantity": 20}
])

if inventory.all_available:
    # Calculate pricing with bulk discount
    pricing = client.calculate_pricing([
        {"sku": results[0].sku, "quantity": 20}
    ])
    
    # Get user approval
    approved = await get_user_approval(
        items=pricing.items,
        total=pricing.total,
        savings=pricing.bulk_savings
    )
    
    if approved:
        # Execute purchase
        order = client.purchase(
            items=[{"sku": results[0].sku, "quantity": 20}],
            payment_method="stripe",
            shipping_address=user.address,
            approval_token=approved.token
        )
        
        print(f"Order placed: {order.id}")
        print(f"Tracking: {order.tracking_url}")
```

### JavaScript SDK Example

```javascript
import TexFlow from '@texflow/agent-sdk';

const texflow = new TexFlow({
  baseUrl: '{{API_BASE_URL}}',
  agentId: 'your-agent-id',
  userToken: 'user-consent-token'
});

// Natural language search
const products = await texflow.search('color laser printers under $1000');

// Smart cart builder
const cart = await texflow.buildSmartCart({
  context: 'Office setup for 30 employees',
  budget: 50000,
  priorities: ['reliability', 'bulk-discounts']
});

// Execute with user approval
const order = await texflow.checkout(cart.id, {
  paymentMethod: 'purchase_order',
  poNumber: 'PO-2026-001',
  shippingAddress: userAddress,
  userApproval: await getUserApproval(cart)
});

console.log(`Order confirmed: ${order.confirmationNumber}`);
```

---

## 📞 Support & Resources

**For AI Agents**:
- 📄 This file (always use latest): `{{WEBSITE_URL}}/texflow.md`
- 📚 API Documentation: `{{DOCS_URL}}`
- 🧪 API Playground: `{{PLAYGROUND_URL}}`
- 📊 Status Page: `{{STATUS_URL}}`

**For Human Developers**:
- 📧 Email: {{SUPPORT_EMAIL}}
- 💬 Community: {{COMMUNITY_URL}}
- 🐛 Report Issues: {{ISSUES_URL}}
- 📖 Integration Guide: {{INTEGRATION_GUIDE_URL}}

**For End Users**:
- 🛒 Website: {{WEBSITE_URL}}
- 📞 Phone: {{SUPPORT_PHONE}}
- 💬 Live Chat: {{WEBSITE_URL}}/chat
- ❓ FAQ: {{WEBSITE_URL}}/faq

---

## 🚀 Powered by TexFlow

This agent commerce interface is powered by **TexFlow** - the platform that makes any e-commerce website agent-ready.

**Learn More**: https://texflow.work  
**For Businesses**: https://texflow.work/for-business  
**Documentation**: https://docs.texflow.work

---

<div align="center">

**{{BUSINESS_NAME}}**  
*Agent-Ready Commerce via TexFlow*

`Protocol Version: ACP v2.1` | `Last Updated: {{TIMESTAMP}}` | `Status: ✅ Operational`

[Shop Now]({{WEBSITE_URL}}) | [API Docs]({{DOCS_URL}}) | [Support]({{SUPPORT_EMAIL}})

</div>

---

## 📋 Quick Reference Card

```yaml
# Essential Agent Commands

AUTHENTICATE:
  POST {{API_BASE_URL}}/auth/token
  
SEARCH:
  GET {{API_BASE_URL}}/search/semantic?q={{QUERY}}
  
INVENTORY:
  POST {{API_BASE_URL}}/inventory/check
  
PRICING:
  POST {{API_BASE_URL}}/pricing/calculate
  
CART:
  POST {{API_BASE_URL}}/cart/create
  POST {{API_BASE_URL}}/cart/{{CART_ID}}/items
  
PURCHASE:
  POST {{API_BASE_URL}}/checkout/{{CART_ID}}/execute
  
TRACK:
  GET {{API_BASE_URL}}/orders/{{ORDER_ID}}/track

# Required Headers
Authorization: Bearer {{TOKEN}}
Content-Type: application/json
User-Agent: YourAgent/1.0

# Response Format
Accept: application/json
```

---

*This file is automatically generated and kept in sync with {{BUSINESS_NAME}}'s live inventory and pricing. Always fetch the latest version before making purchases.*

**File Version**: {{FILE_VERSION}}  
**Generation Time**: {{GENERATION_TIMESTAMP}}  
**Next Update**: {{NEXT_UPDATE_TIMESTAMP}}