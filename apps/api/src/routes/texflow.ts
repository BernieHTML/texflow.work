import { Router, Request, Response } from 'express';
import { getTexFlowMarkdown } from '../services/texflow-generator.js';

const router: Router = Router();

router.get('/merchants/:merchantId/texflow.md', async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  try {
    const markdown = await getTexFlowMarkdown(merchantId);
    res.setHeader('Content-Type', 'text/markdown');
    res.send(markdown);
  } catch (e: any) {
    res.status(404).json({ error: e?.message ?? 'Not found' });
  }
});

export { router as texflowRouter };
