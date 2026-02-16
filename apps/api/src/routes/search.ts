import { Router, Request, Response } from 'express';
import { PrismaClient } from '@texflow/database';
import { authenticateAgent } from '../middleware/auth.js';

const router: Router = Router();
const prisma = new PrismaClient();

function formatProduct(p: { id: string; sku: string; name: string; description: string; basePrice: any; currency: string; category: string; images: any; specifications: any; tags: string[] }) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    price: { base: Number(p.basePrice), currency: p.currency },
    category: p.category,
    images: p.images,
    specifications: p.specifications,
    tags: p.tags,
  };
}

router.get('/semantic', authenticateAgent, async (req: Request & { agent?: { merchant_id: string } }, res: Response) => {
  const merchantId = req.agent?.merchant_id;
  const q = String(req.query.q ?? '');
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  if (!merchantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const results = await prisma.product.findMany({
    where: {
      merchantId,
      active: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: limit,
  });
  res.json({
    query: q,
    results: results.map(formatProduct),
    total_results: results.length,
  });
});

export { router as searchRouter };
