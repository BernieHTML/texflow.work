import { Router, Request, Response } from 'express';
import { PrismaClient } from '@texflow/database';
import { authenticateAgent } from '../middleware/auth.js';

const router: Router = Router();
const prisma = new PrismaClient();

router.get('/manifest', authenticateAgent, async (req: Request & { agent?: { merchant_id: string } }, res: Response) => {
  const merchantId = req.agent?.merchant_id;
  if (!merchantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const products = await prisma.product.findMany({
    where: { merchantId, active: true },
    take: 100,
    select: { sku: true, name: true, category: true, basePrice: true, currency: true },
  });
  res.json({ format: 'compact', products, total: products.length });
});

router.get('/categories', authenticateAgent, async (req: Request & { agent?: { merchant_id: string } }, res: Response) => {
  const merchantId = req.agent?.merchant_id;
  if (!merchantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const categories = await prisma.product.groupBy({
    by: ['category'],
    where: { merchantId, active: true },
    _count: { id: true },
  });
  res.json(categories.map((c) => ({ name: c.category, count: c._count.id })));
});

export { router as catalogRouter };
