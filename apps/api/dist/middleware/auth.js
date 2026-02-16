import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
export function authenticateAgent(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }
    const token = auth.slice(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.agent = decoded;
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
