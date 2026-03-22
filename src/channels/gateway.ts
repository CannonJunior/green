/**
 * OpenClaw Gateway channel — connects to the OpenClaw WebSocket daemon.
 *
 * The Gateway is the central hub for all OpenClaw channels. Green connects as
 * a "node" client, subscribes to iMessage (BlueBubbles) sessions, and sends
 * responses back through the same session.
 *
 * Protocol notes
 * --------------
 * OpenClaw's Gateway runs at ws://127.0.0.1:18789 and speaks a JSON
 * message protocol. The exact envelope schema should be verified against
 * the running OpenClaw source once it is installed (see install.sh).
 * The implementation below is based on the published architecture docs and
 * common WebSocket RPC conventions.
 *
 * Observed / expected message shapes:
 *
 *   Inbound (Gateway → Green):
 *   {
 *     "type": "session_message",
 *     "session_id": "<uuid>",
 *     "channel": "bluebubbles",
 *     "from": "+15555550100",
 *     "text": "hey green, why are tests failing?"
 *   }
 *
 *   Outbound (Green → Gateway):
 *   {
 *     "type": "session_send",
 *     "session_id": "<uuid>",
 *     "text": "Looking at it now..."
 *   }
 *
 * If the actual protocol differs, update the `parseInbound` and `buildOutbound`
 * functions below — the rest of the code is protocol-agnostic.
 */

import WebSocket from 'ws';
import type { Channel, IncomingMessage } from './types.js';

// Maps session_id → sender phone number so we can route replies
type SessionMap = Map<string, string>;

interface GatewayInbound {
  type: string;
  session_id?: string;
  channel?: string;
  from?: string;
  text?: string;
  [key: string]: unknown;
}

interface ParsedMessage {
  sessionId: string;
  senderId: string;
  text: string;
}

function parseInbound(raw: GatewayInbound): ParsedMessage | null {
  if (raw.type !== 'session_message') return null;
  if (!raw.session_id || !raw.from || !raw.text) return null;
  return { sessionId: raw.session_id, senderId: raw.from, text: raw.text };
}

function buildOutbound(sessionId: string, text: string): string {
  return JSON.stringify({ type: 'session_send', session_id: sessionId, text });
}

export class GatewayChannel implements Channel {
  private readonly url: string;
  private readonly approvedNumbers: Set<string>;
  private ws: WebSocket | null = null;
  private sessions: SessionMap = new Map();
  // session_id keyed by senderId (phone) so send() can look it up
  private senderToSession: Map<string, string> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private messageCallback: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(gatewayUrl: string, approvedNumbers: string[]) {
    this.url = gatewayUrl;
    this.approvedNumbers = new Set(approvedNumbers);
  }

  async send(senderId: string, text: string): Promise<void> {
    const sessionId = this.senderToSession.get(senderId);
    if (!sessionId) {
      console.warn(`[gateway] No active session for sender ${senderId} — cannot send reply`);
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[gateway] WebSocket not open — dropping outbound message');
      return;
    }
    this.ws.send(buildOutbound(sessionId, text));
  }

  listen(onMessage: (msg: IncomingMessage) => Promise<void>): () => void {
    this.messageCallback = onMessage;
    this.connect();

    return () => {
      this.stopped = true;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.ws?.close();
    };
  }

  private connect(): void {
    if (this.stopped) return;
    console.log(`[gateway] Connecting to ${this.url}`);

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      console.log('[gateway] Connected to OpenClaw Gateway');
      // Register as a node client. Exact handshake TBD after OpenClaw install.
      ws.send(JSON.stringify({ type: 'hello', client: 'green', version: '0.1.0' }));
    });

    ws.on('message', async (data) => {
      let raw: GatewayInbound;
      try {
        raw = JSON.parse(data.toString()) as GatewayInbound;
      } catch {
        return;
      }

      const parsed = parseInbound(raw);
      if (!parsed) return;

      // Sender allowlist check
      if (this.approvedNumbers.size > 0 && !this.approvedNumbers.has(parsed.senderId)) {
        console.log(`[gateway] Dropping message from unapproved sender ${parsed.senderId}`);
        return;
      }

      // Track session mapping
      this.sessions.set(parsed.sessionId, parsed.senderId);
      this.senderToSession.set(parsed.senderId, parsed.sessionId);

      if (this.messageCallback) {
        await this.messageCallback({ senderId: parsed.senderId, text: parsed.text });
      }
    });

    ws.on('close', () => {
      if (!this.stopped) {
        console.log('[gateway] Disconnected — reconnecting in 5s');
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    ws.on('error', (err) => {
      console.error('[gateway] WebSocket error:', err.message);
    });
  }
}
