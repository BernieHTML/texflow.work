import { Router } from 'express';
import { PrismaClient } from '@texflow/database';
import { authenticateAgent } from '../middleware/auth.js';
const router = Router();
const prisma = new PrismaClient();
router.get('/:orderId/track', authenticateAgent, async (req, res) => {
    const { orderId } = req.params;
    const order = await prisma.order.findFirst({
        where: { id: orderId, merchantId: req.agent?.merchant_id ?? '' },
    });
    if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
    }
    res.json({
        order_id: order.id,
        status: order.status,
        confirmation_number: order.confirmationNumber,
        carrier: order.carrier,
        tracking_number: order.trackingNumber,
        shipped_at: order.shippedAt?.toISOString(),
        estimated_delivery: order.estimatedDelivery?.toISOString(),
    });
});
export { router as ordersRouter };
