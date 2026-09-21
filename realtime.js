const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { WebSocketServer, WebSocket } = require('ws');
const { URL } = require('url');
const { pool } = require('./db');

const WS_PATH = '/ws/messages';
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'eduflow_session';
const HEARTBEAT_MS = 30_000;
const MAX_PAYLOAD = 64 * 1024;
const MAX_ROOMS_PER_SOCKET = 100;

// Event names are deliberately stable protocol names. Add new names here rather
// than changing the transport or room implementation.
const SERVER_EVENTS = new Set([
  'connection.ready',
  'presence.changed',
  'presence.snapshot',
  'room.joined',
  'room.left',
  'message.created',
  'message.updated',
  'message.deleted',
  'message.typing',
  'message.read',
  'course.status.changed',
  'error',
]);

const clientsByUser = new Map();
const socketsByRoom = new Map();
const onlineUsers = new Set();

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return [];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter((entry) => entry.length));
}

function userKey(userId) {
  const key = String(userId);
  if (!/^\d+$/.test(key) || Number(key) <= 0) throw new Error('Invalid user ID');
  return key;
}

function roomKey(roomId) {
  const value = String(roomId || '').trim();
  // Namespaces prevent a conversation ID and course ID from colliding.
  if (!/^(conversation|course|user):[A-Za-z0-9:_-]{1,150}$/.test(value)) {
    throw new Error('Invalid room ID');
  }
  return value;
}

function event(type, data = {}, roomId, actorId) {
  if (!SERVER_EVENTS.has(type)) throw new Error(`Unsupported event type: ${type}`);
  return {
    type,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    ...(roomId ? { roomId } : {}),
    ...(actorId ? { actorId: Number(actorId) } : {}),
    data,
  };
}

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_PAYLOAD) return socket.terminate();
  socket.send(JSON.stringify(message));
}

function sendError(socket, code, message) {
  send(socket, event('error', { code, message }));
}

function broadcastToUsers(userIds, message) {
  for (const id of new Set(userIds.map(userKey))) {
    const clients = clientsByUser.get(id);
    if (!clients) continue;
    for (const socket of clients) send(socket, message.type ? message : event(message.type, message));
  }
}

function broadcastToRoom(roomId, message, exceptSocket) {
  const sockets = socketsByRoom.get(roomId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket !== exceptSocket) send(socket, message);
  }
}

function removeFromRoom(socket, roomId) {
  const sockets = socketsByRoom.get(roomId);
  if (!sockets) return;
  sockets.delete(socket);
  if (!sockets.size) socketsByRoom.delete(roomId);
}

function addClient(socket) {
  const key = userKey(socket.userId);
  const wasOnline = onlineUsers.has(key);
  onlineUsers.add(key);
  if (!clientsByUser.has(key)) clientsByUser.set(key, new Set());
  clientsByUser.get(key).add(socket);
  if (!wasOnline) broadcastToUsers([...clientsByUser.keys()], event('presence.changed', { userId: Number(key), online: true }));

  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.once('close', () => {
    for (const roomId of socket.rooms) removeFromRoom(socket, roomId);
    const clients = clientsByUser.get(key);
    if (clients) clients.delete(socket);
    if (!clients || !clients.size) {
      clientsByUser.delete(key);
      onlineUsers.delete(key);
      broadcastToUsers([...clientsByUser.keys()], event('presence.changed', { userId: Number(key), online: false }));
    }
  });
}

function defaultAuthorizeRoom(roomId, userId) {
  const [kind, rawId] = roomId.split(':');
  if (kind !== 'conversation') return Promise.resolve(false);
  return pool.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [Number(rawId), userId]
  ).then((result) => result.rowCount > 0);
}

function attachRealtime(server, options = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const authorizeRoom = options.authorizeRoom || defaultAuthorizeRoom;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, clientTracking: true });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  async function handleClientMessage(socket, raw) {
    let command;
    try { command = JSON.parse(raw); } catch { return sendError(socket, 'invalid_json', 'Message must be valid JSON.'); }
    if (!command || typeof command.type !== 'string') return sendError(socket, 'invalid_command', 'A command type is required.');

    try {
      if (command.type === 'room.join') {
        const roomId = roomKey(command.roomId);
        if (socket.rooms.has(roomId)) return send(socket, event('room.joined', { alreadyJoined: true }, roomId, socket.userId));
        if (socket.rooms.size >= MAX_ROOMS_PER_SOCKET) throw new Error('Room limit reached');
        if (!(await authorizeRoom(roomId, socket.userId, socket))) throw new Error('Not authorized for this room');
        socket.rooms.add(roomId);
        if (!socketsByRoom.has(roomId)) socketsByRoom.set(roomId, new Set());
        socketsByRoom.get(roomId).add(socket);
        return send(socket, event('room.joined', {}, roomId, socket.userId));
      }
      if (command.type === 'room.leave') {
        const roomId = roomKey(command.roomId);
        socket.rooms.delete(roomId);
        removeFromRoom(socket, roomId);
        return send(socket, event('room.left', {}, roomId, socket.userId));
      }
      if (command.type === 'message.typing' || command.type === 'message.read') {
        const roomId = roomKey(command.roomId);
        if (!socket.rooms.has(roomId)) throw new Error('Join the room first');
        const type = command.type;
        return broadcastToRoom(roomId, event(type, command.data || {}, roomId, socket.userId), socket);
      }
      return sendError(socket, 'unsupported_command', 'Unsupported realtime command.');
    } catch (error) {
      sendError(socket, 'command_rejected', error.message);
    }
  }

  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== WS_PATH) { socket.destroy(); return; }

    const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
    if (allowedOrigins.length && !allowedOrigins.includes(request.headers.origin)) { socket.destroy(); return; }

    let payload;
    try {
      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      if (!token) throw new Error('Missing session cookie');
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      userKey(payload.userId);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = payload.userId;
      ws.rooms = new Set();
      addClient(ws);
      ws.on('message', (message) => handleClientMessage(ws, message.toString()));
      send(ws, event('connection.ready', { protocol: 1 }, undefined, ws.userId));
      send(ws, event('presence.snapshot', { userIds: [...onlineUsers].map(Number) }));
    });
  });
  return wss;
}

module.exports = {
  attachRealtime,
  broadcastToUsers,
  broadcastToRoom,
  event,
  SERVER_EVENTS,
};
