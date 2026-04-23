/**
 * Popup-side client for the popup ↔ background port.
 *
 * Exposes a small imperative API that matches how the UI actually wants to
 * talk to the background:
 *   • `send(command)` — fire a command, resolves on ack, rejects on nack.
 *   • `onState(state)` callback — fires on connect and whenever the
 *     background pushes a new state.
 *
 * Survives a service-worker restart: when the port disconnects we reject
 * in-flight commands with a retry-able error and transparently reconnect.
 */

import {
  POPUP_PORT_NAME,
  type BackgroundToPopup,
  type PopupCommand,
  type PopupState,
  type PopupToBackground,
} from './extension';

type Port = ReturnType<typeof browser.runtime.connect>;

export interface PopupClientOptions {
  onState(state: PopupState): void;
}

export interface PopupClient {
  send(command: PopupCommand): Promise<void>;
  close(): void;
}

interface Pending {
  resolve(): void;
  reject(error: Error): void;
}

export function createPopupClient(options: PopupClientOptions): PopupClient {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closed = false;
  let port = openPort();

  function openPort(): Port {
    const next = browser.runtime.connect({ name: POPUP_PORT_NAME });

    next.onMessage.addListener((message: BackgroundToPopup) => {
      if (message.type === 'state') {
        options.onState(message.state);
        return;
      }

      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.type === 'ack') {
        entry.resolve();
      } else {
        entry.reject(new Error(message.error));
      }
    });

    next.onDisconnect.addListener(() => {
      // Fail in-flight commands; they were never acked.
      for (const entry of pending.values()) {
        entry.reject(new Error('Background restarted; please retry.'));
      }
      pending.clear();

      if (closed) {
        return;
      }

      // Reconnect on the next tick so the runtime has a chance to settle.
      setTimeout(() => {
        if (closed) return;
        port = openPort();
      }, 0);
    });

    return next;
  }

  return {
    send(command) {
      if (closed) {
        return Promise.reject(new Error('Popup client is closed.'));
      }

      const id = ++nextId;
      const envelope: PopupToBackground = { type: 'command', id, command };
      return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          port.postMessage(envelope);
        } catch (error) {
          pending.delete(id);
          reject(
            error instanceof Error ? error : new Error('Port disconnected.'),
          );
        }
      });
    },
    close() {
      closed = true;
      try {
        port.disconnect();
      } catch {
        // Already disconnected; ignore.
      }
    },
  };
}
