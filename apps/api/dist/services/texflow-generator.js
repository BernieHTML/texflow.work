import { PrismaClient } from '@texflow/database';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
let template = null;
function getTemplate() {
    if (!template) {
        const templatePath = join(__dirname, '../../templates/texflow-template.md');
        const source = readFileSync(templatePath, 'utf-8');
        template = Handlebars.compile(source);
    }
    return template;
}
function slugify(s) {
    return s
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}
export async function getTexFlowMarkdown(merchantId) {
    const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: {
            products: {
                where: { active: true },
                take: 10,
                orderBy: { createdAt: 'desc' },
            },
        },
    });
    if (!merchant) {
        throw new Error('Merchant not found');
    }
    const categories = await buildCategoryTree(merchantId);
    const totalProducts = await prisma.product.count({
        where: { merchantId, active: true },
    });
    const apiBaseUrl = process.env.API_BASE_URL ?? `https://api.texflow.work/v2/merchants/${merchant.id}`;
    const data = {
        BUSINESS_NAME: merchant.businessName,
        WEBSITE_URL: merchant.website,
        API_BASE_URL: apiBaseUrl,
        TIMESTAMP: new Date().toISOString(),
        INDUSTRY: merchant.industry ?? '',
        SPECIALIZATION: merchant.industry ?? '',
        LOCATION: '',
        SUPPORT_EMAIL: merchant.supportEmail ?? merchant.email,
        SUPPORT_PHONE: merchant.phone ?? '',
        BUSINESS_DESCRIPTION: `${merchant.businessName} offers a wide range of products.`,
        TOTAL_PRODUCTS: totalProducts,
        TOTAL_CATEGORIES: categories.length,
        CATALOG_LAST_UPDATED: merchant.lastSyncAt?.toISOString() ?? new Date().toISOString(),
        FEATURED_PRODUCTS: merchant.products.map((p) => ({
            PRODUCT_NAME: p.name,
            PRODUCT_SKU: p.sku,
            PRODUCT_CATEGORY: p.category,
            PRODUCT_DESCRIPTION: p.description,
            BASE_PRICE: Number(p.basePrice),
            CURRENCY: p.currency,
            BULK_TIERS_JSON: JSON.stringify(p.bulkTiers ?? {}, null, 2),
            STOCK_QUANTITY: p.stockQuantity,
            WAREHOUSE_ID: p.warehouse ?? '',
            LEAD_TIME: p.leadTimeDays,
            LOW_STOCK_THRESHOLD: 5,
            SPECIFICATIONS_JSON: JSON.stringify(p.specifications ?? {}, null, 2),
            IMAGES_ARRAY: JSON.stringify(p.images ?? [], null, 2),
            TAGS_ARRAY: JSON.stringify(p.tags ?? [], null, 2),
            DEFAULT_QUANTITY: 1,
        })),
        CATEGORIES: categories.map((c) => ({
            ...c,
            SUBCATEGORY_COUNT: 0,
            USE_CASES: '',
            SUBCATEGORIES: [],
        })),
        DOCS_URL: `https://docs.texflow.work`,
        PLAYGROUND_URL: `https://playground.texflow.work`,
        STATUS_URL: `https://status.texflow.work`,
        COMMUNITY_URL: 'https://texflow.work',
        ISSUES_URL: 'https://texflow.work',
        INTEGRATION_GUIDE_URL: 'https://docs.texflow.work',
        FILE_VERSION: '1.0.0',
        GENERATION_TIMESTAMP: new Date().toISOString(),
        NEXT_UPDATE_TIMESTAMP: new Date(Date.now() + 3600000).toISOString(),
    };
    return getTemplate()(data);
}
async function buildCategoryTree(merchantId) {
    const products = await prisma.product.findMany({
        where: { merchantId, active: true },
        select: { category: true },
    });
    const map = new Map();
    for (const p of products) {
        map.set(p.category, (map.get(p.category) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({
        CATEGORY_ID: slugify(name),
        CATEGORY_NAME: name,
        PRODUCT_COUNT: count,
    }));
}
