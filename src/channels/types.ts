/**
 * A Channel is a bidirectional transport between Green and the user.
 * The local channel uses stdin/stdout for development.
 * The gateway channel connects to the OpenClaw WebSocket daemon for iMessage.
 */
export interface IncomingMessage {
  /** Stable identifier for the sender: phone number (E.164) or "local" */
  senderId: string;
  text: string;
}

export interface Channel {
  /** Called by the daemon to deliver a message back to the user. */
  send(senderId: string, text: string): Promise<void>;

  /**
   * Start listening. Calls `onMessage` for each inbound message.
   * Returns a cleanup function (called on shutdown).
   */
  listen(onMessage: (msg: IncomingMessage) => Promise<void>): () => void;
}
