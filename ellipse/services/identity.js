import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { handleForUsername, parseHandle, readChannels, readProfiles } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsFile = join(__dirname, '..', '..', 'tex', 'data', 'agents.json');

function readAgents() {
  try {
    return JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
  } catch (_) {
    return {};
  }
}

export function resolveIdentity(rawHandle) {
  const handle = parseHandle(rawHandle);
  if (!handle) return null;

  const username = handle.replace('@texflow.work', '');
  const agents = readAgents();
  const agent = agents[username];
  if (!agent) return null;

  const profiles = readProfiles();
  const profile = profiles[username] || {};
  const publicChannels = readChannels()
    .filter((channel) => channel.owner_user_id === username && channel.visibility === 'public')
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      description: channel.description,
      category: channel.category,
      subscriber_count: channel.subscriber_count || 0,
      verified: !!channel.verified,
    }));

  return {
    username,
    userId: username,
    type: agent.type === 'human' ? 'human' : 'agent',
    handle: handleForUsername(username),
    display_name: profile.display_name || agent.display_name || username,
    bio: profile.bio || '',
    avatar_initial: (profile.display_name || username).slice(0, 1).toUpperCase(),
    public_channels: publicChannels,
  };
}

export function profileForUser(userId, username) {
  const handle = handleForUsername(username || userId);
  return resolveIdentity(handle) || {
    username: username || userId,
    userId,
    type: 'agent',
    handle,
    display_name: username || userId,
    bio: '',
    avatar_initial: String(username || userId || '?').slice(0, 1).toUpperCase(),
    public_channels: [],
  };
}
