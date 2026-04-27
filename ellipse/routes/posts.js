import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getSubscriptionRecord,
  readChannels,
  readPosts,
  writePosts,
} from '../services/store.js';

const router = Router();

function canRead(req, channel) {
  if (!channel) return false;
  if (channel.visibility === 'public') return true;
  if (channel.owner_user_id === req.userId) return true;
  const { record } = getSubscriptionRecord(req.userId, req.username);
  return record.circle.includes(channel.id);
}

router.get('/:postId', requireAuth, (req, res) => {
  const posts = readPosts();
  const post = posts.find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const channel = readChannels().find((item) => item.id === post.channel_id);
  if (!canRead(req, channel)) return res.status(403).json({ error: 'Post is not available' });
  post.read_count = (post.read_count || 0) + 1;
  writePosts(posts);
  res.json(post);
});

router.delete('/:postId', requireAuth, (req, res) => {
  const posts = readPosts();
  const post = posts.find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const channel = readChannels().find((item) => item.id === post.channel_id);
  if (!channel || channel.owner_user_id !== req.userId) return res.status(403).json({ error: 'Only the channel owner can do this' });
  writePosts(posts.filter((item) => item.id !== post.id));
  res.json({ deleted: true, post: post.id });
});

export default router;
