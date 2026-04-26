/**
 * Signal channel — connects to a running signal-cli daemon via TCP JSON-RPC.
 *
 * signal-cli setup (one-time):
 *   # Install signal-cli, then either register a fresh number:
 *   signal-cli -a +1XXXXXXXXXX register
 *   signal-cli -a +1XXXXXXXXXX verify <code>
 *
 *   # Or link to your existing Signal account as a secondary device:
 *   signal-cli link -n "Green"
 *   # Scan the printed URL as a QR code in Signal > Linked Devices
 *
 *   # Then start the daemon (add to systemd for auto-start):
 *   signal-cli -a +1XXXXXXXXXX daemon --tcp 127.0.0.1:7583
 *
 * Protocol
 * --------
 * signal-cli speaks newline-delimited JSON-RPC 2.0 over the TCP socket.
 *
 * Subscribe to incoming messages:
 *   → {"jsonrpc":"2.0","method":"subscribeReceive","id":1}
 *   ← {"jsonrpc":"2.0","result":0,"id":1}
 *
 * Incoming message notification:
 *   ← {"jsonrpc":"2.0","method":"receive","params":{
 *        "envelope":{
 *          "sourceNumber":"+15555550100",
 *          "dataMessage":{"message":"hey green","timestamp":...}
 *        },
 *        "account":"+1XXXXXXXXXX"
 *      }}
 *
 * Send a message:
 *   → {"jsonrpc":"2.0","method":"send","params":{"recipient":["+15555550100"],"message":"hi"},"id":2}
 *   ← {"jsonrpc":"2.0","result":{"timestamp":...},"id":2}
 */

import net from 'node:net';
import type { Attachment, Channel, IncomingMessage } from './types.js';

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

type JsonRpcMessage = JsonRpcNotification | JsonRpcResponse;

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

interface SignalAttachment {
  contentType?: string;
  id?: string;
  size?: number;
  storedFilename?: string;
  filename?: string;
  width?: number;
  height?: number;
}

interface SignalEnvelope {
  sourceNumber?: string;
  dataMessage?: {
    message?: string;
    timestamp?: number;
    attachments?: SignalAttachment[];
  };
  syncMessage?: {
    sentMessage?: {
      destination?: string;
      message?: string;
      timestamp?: number;
      attachments?: SignalAttachment[];
    };
  };
}

export class SignalChannel implements Channel {
  private readonly host: string;
  private readonly port: number;
  private readonly approvedNumbers: Set<string>;

  private socket: net.Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageCallback: ((msg: IncomingMessage) => Promise<void>) | null = null;
  // Dedup: track (sender, timestamp) pairs to drop signal-cli duplicate deliveries.
  // Entries expire after 60 s to prevent unbounded growth.
  private readonly seenMessages = new Map<string, number>();

  constructor(daemonAddress: string, approvedNumbers: string[]) {
    const [host, portStr] = daemonAddress.split(':');
    this.host = host ?? '127.0.0.1';
    this.port = parseInt(portStr ?? '7583', 10);
    this.approvedNumbers = new Set(approvedNumbers);
  }

  async send(senderId: string, text: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) {
      console.warn('[signal] Socket not connected — dropping outbound message');
      return;
    }
    console.log('[signal] reply:', text);
    this.rpc('send', { recipient: [senderId], message: text });
  }

  listen(onMessage: (msg: IncomingMessage) => Promise<void>): () => void {
    this.messageCallback = onMessage;
    this.connect();
    return () => {
      this.stopped = true;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.socket?.destroy();
    };
  }

  // ---------------------------------------------------------------------------

  private connect(): void {
    if (this.stopped) return;

    const addr = `${this.host}:${this.port}`;
    console.log(`[signal] Connecting to signal-cli at ${addr}`);

    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    this.buffer = '';

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      console.log('[signal] Connected to signal-cli daemon');
      // Subscribe to incoming messages
      this.rpc('subscribeReceive', {});
    });

    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      // signal-cli sends newline-delimited JSON
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.handleFrame(JSON.parse(trimmed) as JsonRpcMessage);
        } catch {
          console.warn('[signal] Failed to parse frame:', trimmed.slice(0, 120));
        }
      }
    });

    socket.on('close', () => {
      if (!this.stopped) {
        console.log('[signal] Disconnected — reconnecting in 5s');
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    socket.on('error', (err) => {
      // ECONNREFUSED means signal-cli isn't up yet — log quietly and retry
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        console.log('[signal] signal-cli not reachable yet — will retry');
      } else {
        console.error('[signal] Socket error:', err.message);
      }
    });
  }

  private handleFrame(msg: JsonRpcMessage): void {
    if (!isNotification(msg)) return; // skip responses (subscribe ack, send result)
    if (msg.method !== 'receive') return;

    const envelope = (msg.params as { envelope?: SignalEnvelope }).envelope;

    // Prefer dataMessage (direct incoming); fall back to syncMessage.sentMessage
    // (outgoing copy synced to this linked device — the only delivery in "note to self" setups).
    // Dedup by timestamp handles cases where both arrive for the same message.
    const msgData = envelope?.dataMessage ?? envelope?.syncMessage?.sentMessage;
    if (!msgData) return;

    const sender = envelope?.sourceNumber;
    const timestamp = msgData.timestamp;
    const text = msgData.message;
    const rawAttachments = msgData.attachments ?? [];

    const attachments: Attachment[] = rawAttachments
      .filter(a => (a.storedFilename || a.id) && a.contentType)
      .map(a => ({
        storedFilename: a.storedFilename ?? a.id!,
        contentType: a.contentType!,
        filename: a.filename,
        size: a.size,
        width: a.width,
        height: a.height,
      }));

    // If the envelope contained attachments but none were usable yet (no id/storedFilename),
    // the attachment is still downloading — skip this delivery and wait for the complete one.
    if (rawAttachments.length > 0 && attachments.length === 0) {
      console.log('[signal] dropping incomplete delivery — attachment still downloading');
      return;
    }

    if (!sender || (!text && attachments.length === 0)) return;

    if (this.approvedNumbers.size > 0 && !this.approvedNumbers.has(sender)) {
      console.log(`[signal] Dropping message from unapproved sender ${sender}`);
      return;
    }

    // Deduplicate: signal-cli can emit multiple receive events for the same message
    if (timestamp !== undefined) {
      const key = `${sender}:${timestamp}`;
      const now = Date.now();
      if (this.seenMessages.has(key)) {
        console.log('[signal] Dropping duplicate delivery for', key);
        return;
      }
      this.seenMessages.set(key, now);
      // Expire entries older than 60 s
      for (const [k, t] of this.seenMessages) {
        if (now - t > 60_000) this.seenMessages.delete(k);
      }
    }

    console.log('[signal] message from', sender + ':', text, attachments.length ? `(${attachments.length} attachment(s))` : '');
    if (this.messageCallback) {
      this.messageCallback({ senderId: sender, text: text ?? '', attachments }).catch(err => {
        console.error('[signal] Handler error:', err);
      });
    }
  }

  private rpc(method: string, params: Record<string, unknown>): void {
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params, id: this.nextId++ });
    this.socket?.write(frame + '\n');
  }
}
