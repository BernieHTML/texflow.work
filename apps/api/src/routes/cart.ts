import { Router, Request, Response } from 'express';
import { PrismaClient } from '@texflow/database';
import { authenticateAgent } from '../middleware/auth.js';

const router: Router = Router();
const prisma = new PrismaClient();

router.post('/create', authenticateAgent, async (req: Request & { agent?: { agent_id: string; merchant_id: string } }, res: Response) => {
  const merchantId = req.agent?.merchant_id;
  if (!merchantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const subtotal = Number(req.body?.subtotal) || 0;
  const total = subtotal;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const cart = await prisma.cart.create({
    data: {
      merchantId,
      agentId: req.agent?.agent_id,
      items,
      subtotal,
      bulkSavings: 0,
      tax: 0,
      shipping: 0,
      total,
      status: 'ACTIVE',
      expiresAt,
    } as any,
  });
  res.status(201).json({
    cart_id: cart.id,
    status: 'active',
    expires_at: expiresAt.toISOString(),
  });
});

export { router as cartRouter };
