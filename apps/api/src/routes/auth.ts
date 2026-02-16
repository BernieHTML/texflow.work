import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@texflow/database';

const router: Router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

// In production, verify user_consent_token against your consent store
async function verifyUserConsent(_token: string): Promise<{ merchant_id: string } | null> {
  // TODO: validate consent token and return merchant_id
  return { merchant_id: 'placeholder-merchant-id' };
}

router.post('/token', async (req: Request, res: Response) => {
  try {
    const { agent_id, user_consent_token, scope } = req.body as {
      agent_id?: string;
      user_consent_token?: string;
      scope?: string[];
    };

    if (!agent_id || !user_consent_token) {
      res.status(400).json({ error: 'agent_id and user_consent_token required' });
      return;
    }

    const consent = await verifyUserConsent(user_consent_token);
    if (!consent) {
      res.status(401).json({ error: 'Invalid consent' });
      return;
    }

    const scopeList = Array.isArray(scope) ? scope : ['read', 'purchase', 'track'];
    const expiresIn = 3600;
    const accessToken = jwt.sign(
      {
        agent_id,
        merchant_id: consent.merchant_id,
        scope: scopeList,
      },
      JWT_SECRET,
      { expiresIn }
    );

    const agent = await prisma.agent.upsert({
      where: { agentId: agent_id },
      create: {
        agentId: agent_id,
        name: agent_id,
        type: 'custom',
      } as any,
      update: { lastActiveAt: new Date() } as any,
    });

    await prisma.agentSession.create({
      data: {
        agentId: agent.id,
        merchantId: consent.merchant_id,
        accessToken,
        userConsentToken: user_consent_token,
        scope: scopeList,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      } as any,
    }).catch(() => {});

    res.json({
      access_token: accessToken,
      expires_in: expiresIn,
      token_type: 'Bearer',
      permissions: scopeList,
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as authRouter };
