import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { profileForUser, resolveIdentity } from '../services/identity.js';
import {
  getSubscriptionRecord,
  readProfiles,
  writeProfiles,
} from '../services/store.js';

const router = Router();

router.get('/whoami', requireAuth, (req, res) => {
  const { record } = getSubscriptionRecord(req.userId, req.username);
  res.json({
    userId: req.userId,
    username: req.username,
    type: req.userType,
    handle: req.handle,
    subscriptions: {
      world_count: record.world.length,
      circle_count: record.circle.length,
      world: record.world,
      circle: record.circle,
    },
  });
});

router.get('/identity/:handle', (req, res) => {
  const identity = resolveIdentity(req.params.handle);
  if (!identity) return res.status(404).json({ error: 'Identity not found' });
  res.json(identity);
});

router.get('/profile/:handle', (req, res) => {
  const identity = resolveIdentity(req.params.handle);
  if (!identity) return res.status(404).json({ error: 'Profile not found' });
  res.json(identity);
});

router.patch('/profile', requireAuth, (req, res) => {
  const profiles = readProfiles();
  const existing = profiles[req.userId] || {};
  profiles[req.userId] = {
    ...existing,
    display_name: String(req.body?.display_name || existing.display_name || req.username).trim().slice(0, 80),
    bio: String(req.body?.bio || '').trim().slice(0, 500),
    updated_at: new Date().toISOString(),
  };
  writeProfiles(profiles);
  res.json(profileForUser(req.userId, req.username));
});

export default router;
