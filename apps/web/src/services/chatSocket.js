import { io } from 'socket.io-client';
import { getAccessToken } from './api/client.js';

const PATH = '/api/socket.io';
const CONNECT_MS = 4_000;

let shared = null;
let connecting = null;

function origin() {
  // Same-origin by default (Vite/nginx proxy /api). Absolute API hosts still share the socket path.
  const api = import.meta.env.VITE_API_URL;
  if (!api || api.startsWith('/')) return undefined;
  try {
    return new URL(api).origin;
  } catch {
    return undefined;
  }
}

/**
 * Shared Socket.IO client for LMS chat. Auth uses the in-memory access token (same as REST).
 * Returns null when the browser cannot open a socket quickly — callers fall back to long poll.
 */
export async function ensureChatSocket() {
  if (shared?.connected) return shared;
  if (connecting) return connecting;

  const token = getAccessToken();
  if (!token) return null;

  connecting = new Promise((resolve) => {
    let settled = false;
    const socket = io(`${origin() ?? ''}/chat`, {
      path: PATH,
      auth: (cb) => cb({ token: getAccessToken() }),
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 8_000,
      timeout: CONNECT_MS,
      autoConnect: true,
    });

    const finish = (value) => {
      if (settled) return;
      settled = true;
      connecting = null;
      if (!value) {
        try { socket.disconnect(); } catch { /* ignore */ }
        if (shared === socket) shared = null;
      } else {
        shared = socket;
      }
      resolve(value);
    };

    // Wait out CONNECT_MS so a brief transport blip can recover; then fall back to long poll.
    const timer = setTimeout(() => finish(shared?.connected ? shared : null), CONNECT_MS + 500);
    socket.once('connect', () => { clearTimeout(timer); finish(socket); });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Server rejected auth — drop the shared client so the next open re-auths.
        shared = null;
      }
    });
  });

  return connecting;
}

/** Join a conversation room; returns an unsubscribe that leaves the room and removes listeners. */
export function watchConversation(socket, conversationId, { onMessage, onStatus, onReconnect } = {}) {
  if (!socket || !conversationId) return () => undefined;

  const join = () => {
    socket.auth = { token: getAccessToken() };
    socket.emit('subscribe', { conversationId }, (ack) => {
      if (ack && ack.ok === false && onReconnect) {
        // Forbidden / auth failure — let the thread fall back if needed.
      }
    });
  };

  const handleMessage = (payload) => {
    if (payload?.conversationId === conversationId) onMessage?.(payload);
  };
  const handleStatus = (payload) => {
    if (payload?.conversationId === conversationId) onStatus?.(payload);
  };
  const handleConnect = () => {
    join();
    onReconnect?.();
  };

  socket.on('chat:message', handleMessage);
  socket.on('chat:status', handleStatus);
  socket.on('connect', handleConnect);
  if (socket.connected) join();
  else socket.once('connect', join);

  return () => {
    socket.off('chat:message', handleMessage);
    socket.off('chat:status', handleStatus);
    socket.off('connect', handleConnect);
    if (socket.connected) socket.emit('unsubscribe', { conversationId });
  };
}
