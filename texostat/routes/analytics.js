import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET /analytics — serve the analytics HTML page
router.get('/', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'analytics.html'));
});

export default router;
