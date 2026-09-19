const jwt = require('jsonwebtoken');
const { WebSocketServer, WebSocket } = require('ws');
const { URL } = require('url');

const clientsByUser = new Map();
const onlineUsers = new Set();

function addClient(userId, socket) {
  const key = String(userId);
  const wasOnline = onlineUsers.has(key);
  onlineUsers.add(key);
  if (!clientsByUser.has(key)) clientsByUser.set(key, new Set());
  clientsByUser.get(key).add(socket);
  if (!wasOnline) broadcastToUsers([...clientsByUser.keys()], { type: 'presence.changed', userId: Number(userId), online: true });
  socket.on('close', () => {
    const clients = clientsByUser.get(key);
    if (!clients) return;
    clients.delete(socket);
    if (!clients.size) {
      clientsByUser.delete(key);
      onlineUsers.delete(key);
      broadcastToUsers([...clientsByUser.keys()], { type: 'presence.changed', userId: Number(userId), online: false });
    }
  });
}

function broadcastToUsers(userIds, event) {
  const payload = JSON.stringify(event);
  for (const userId of new Set(userIds.map(String))) {
    const clients = clientsByUser.get(userId);
    if (!clients) continue;
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }
}

function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch (e) { socket.destroy(); return; }
    if (url.pathname !== '/ws/messages') { socket.destroy(); return; }
    const token = url.searchParams.get('token');
    let payload;
    try {
      if (!token) throw new Error('Missing token');
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = payload.userId;
      addClient(payload.userId, ws);
      ws.send(JSON.stringify({ type: 'connected' }));
      ws.send(JSON.stringify({ type: 'presence.snapshot', userIds: [...onlineUsers].map(Number) }));
    });
  });
  return wss;
}

module.exports = { attachRealtime, broadcastToUsers };
