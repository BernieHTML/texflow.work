const clientsByNewsletter = new Map();

function writeEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function addNewsletterClient(newsletterId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const client = {
    res,
    heartbeat: setInterval(() => {
      writeEvent(res, 'heartbeat', { ts: new Date().toISOString() });
    }, 30000),
  };

  const clients = clientsByNewsletter.get(newsletterId) || new Set();
  clients.add(client);
  clientsByNewsletter.set(newsletterId, clients);

  writeEvent(res, 'heartbeat', { ts: new Date().toISOString() });

  res.on('close', () => {
    clearInterval(client.heartbeat);
    clients.delete(client);
    if (clients.size === 0) clientsByNewsletter.delete(newsletterId);
  });
}

export function sendPostEvent(res, post) {
  writeEvent(res, 'post', {
    post_id: post.id,
    title: post.title,
    body: post.body,
    tags: post.tags,
    published_at: post.published_at,
  });
}

export function broadcastPost(newsletterId, post) {
  const clients = clientsByNewsletter.get(newsletterId);
  if (!clients) return;
  for (const client of clients) {
    sendPostEvent(client.res, post);
  }
}
