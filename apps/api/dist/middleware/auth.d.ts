import { Request, Response, NextFunction } from 'express';
export interface AgentPayload {
    agent_id: string;
    merchant_id: string;
    scope: string[];
}
export declare function authenticateAgent(req: Request & {
    agent?: AgentPayload;
}, res: Response, next: NextFunction): void;
