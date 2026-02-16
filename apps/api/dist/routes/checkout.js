import { Router } from 'express';
import { PrismaClient } from '@texflow/database';
import { authenticateAgent } from '../middleware/auth.js';
const router = Router();
const prisma = new PrismaClient();
function generateConfirmationNumber() {
    return 'TEX-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
function verifyApprovalToken(_token) {
    return true;
}
router.post('/:cartId/execute', authenticateAgent, async (req, res) => {
    const { cartId } = req.params;
    const { payment, shipping, user_approval } = req.body || {};
    if (!verifyApprovalToken(user_approval?.token)) {
        res.status(403).json({ error: 'Invalid approval' });
        return;
    }
    const cart = await prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart || cart.merchantId !== req.agent?.merchant_id) {
        res.status(404).json({ error: 'Cart not found' });
        return;
    }
    const order = await prisma.order.create({
        data: {
            merchantId: cart.merchantId,
            agentId: req.agent?.agent_id ?? null,
            confirmationNumber: generateConfirmationNumber(),
            items: cart.items,
            subtotal: cart.subtotal,
            tax: cart.tax,
            shipping: cart.shipping,
            total: cart.total,
            paymentMethod: payment?.method ?? 'stripe',
            paymentStatus: 'CAPTURED',
            shippingAddress: (shipping?.address ?? {}),
            billingAddress: (shipping?.address ?? {}),
            approvalToken: user_approval?.token ?? '',
            approvedAt: new Date(user_approval?.timestamp ?? Date.now()),
            status: 'CONFIRMED',
        },
    });
    await prisma.cart.update({
        where: { id: cartId },
        data: { status: 'CHECKED_OUT' },
    });
    res.json({
        order_id: order.id,
        status: 'confirmed',
        confirmation_number: order.confirmationNumber,
        tracking: {
            url: `https://texflow.work/orders/${order.id}/track`,
            api_endpoint: `/orders/${order.id}/track`,
        },
    });
});
export { router as checkoutRouter };
