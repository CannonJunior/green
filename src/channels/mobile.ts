/**
 * MobileChannel — accepts HTTP POST requests from the Blue iOS app.
 *
 * Each POST to /api/message is handled synchronously: Green's handler runs,
 * all channel.send() calls accumulate into an array, and the full response
 * is returned in the HTTP response body as { messages: string[] }.
 *
 * Authentication: Authorization: Bearer <token> header.
 * Token is configured in config.yml under mobile.token.
 *
 * Start with: npm run dev -- --channel mobile
 */
import http from 'node:http';
import type { Channel, IncomingMessage } from './types.js';

const DEFAULT_PORT = 9002;

export class MobileChannel implements Channel {
  private readonly port: number;
  private readonly token: string;
  /** Accumulates send() calls keyed by request ID for the duration of each request. */
  private readonly pending = new Map<string, string[]>();

  constructor(token: string, port = DEFAULT_PORT) {
    this.token = token;
    this.port = port;
  }

  async send(senderId: string, text: string): Promise<void> {
    this.pending.get(senderId)?.push(text);
  }

  listen(onMessage: (msg: IncomingMessage) => Promise<void>): () => void {
    const server = http.createServer(async (req, res) => {
      // Auth
      if (req.headers['authorization'] !== `Bearer ${this.token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Read body
      let body: { command?: string; data?: Record<string, unknown> };
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const requestId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const messages: string[] = [];
      this.pending.set(requestId, messages);

      try {
        await onMessage({
          senderId: requestId,
          text: body.command ?? '',
          metadata: body.data,
        });
      } catch (err) {
        messages.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.pending.delete(requestId);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages }));
    });

    server.listen(this.port, () => {
      console.log(`Mobile channel listening on port ${this.port}`);
    });

    return () => server.close();
  }
}
