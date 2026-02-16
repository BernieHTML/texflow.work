import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { searchRouter } from './routes/search.js';
import { cartRouter } from './routes/cart.js';
import { checkoutRouter } from './routes/checkout.js';
import { ordersRouter } from './routes/orders.js';
import { merchantRouter } from './routes/merchant.js';
import { texflowRouter } from './routes/texflow.js';
import { errorHandler } from './middleware/error.js';

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/v2/auth', authRouter);
app.use('/v2/catalog', catalogRouter);
app.use('/v2/search', searchRouter);
app.use('/v2/cart', cartRouter);
app.use('/v2/checkout', checkoutRouter);
app.use('/v2/orders', ordersRouter);
app.use('/v2/merchants', merchantRouter);
app.use('/v2', texflowRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`TexFlow API listening on port ${PORT}`);
});
