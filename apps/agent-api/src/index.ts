import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT ?? 4001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agent-api' });
});

// Agent gateway: proxies to core API with agent-specific rate limits and logging
app.all('*', (req, res) => {
  res.status(501).json({
    error: 'Agent API gateway - proxy to core API not yet implemented',
    forward_to: process.env.CORE_API_URL ?? 'https://api.texflow.work/v2',
  });
});

app.listen(PORT, () => {
  console.log(`TexFlow Agent API listening on port ${PORT}`);
});
