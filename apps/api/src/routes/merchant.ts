import { Router, Request, Response } from 'express';
import { PrismaClient } from '@texflow/database';

const router: Router = Router();
const prisma = new PrismaClient();

router.get('/:merchantId/products/:sku', async (req: Request, res: Response) => {
  const { merchantId, sku } = req.params;
  const product = await prisma.product.findFirst({
    where: { merchantId, sku, active: true },
  });
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json({
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: { base: Number(product.basePrice), currency: product.currency },
    category: product.category,
    stock_quantity: product.stockQuantity,
    images: product.images,
    specifications: product.specifications,
  });
});

export { router as merchantRouter };
