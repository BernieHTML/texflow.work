import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error & { status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status ?? 500;
  res.status(status).json({
    error: err.message ?? 'Internal server error',
  });
}
