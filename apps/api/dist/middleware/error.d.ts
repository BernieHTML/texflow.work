import { Request, Response, NextFunction } from 'express';
export declare function errorHandler(err: Error & {
    status?: number;
}, _req: Request, res: Response, _next: NextFunction): void;
