/**
 * Background-side registration of the popup ↔ background port.
 *
 * The popup opens exactly one long-lived port (name = `POPUP_PORT_NAME`) on
 * mount. The background:
 *   • pushes a fresh `PopupState` whenever anything changes,
 *   • accepts `PopupCommand`s and replies with `ack` / `nack`,
 *   • cleans up when the popup closes (`onDisconnect`).
 *
 * In practice there is at most one connected popup per browser, but the
 * registry handles any number without special-casing.
 */

import {
  POPUP_PORT_NAME,
  type BackgroundToPopup,
  type PopupCommand,
  type PopupState,
  type PopupToBackground,
} from './extension';

type Port = ReturnType<typeof browser.runtime.connect>;

export interface PopupPortHandlers {
  /** Called on every (re)connect; its result is pushed immediately. */
  getState(): PopupState;
  /** Execute a popup-issued command. Throwing produces a `nack`. */
  handleCommand(command: PopupCommand): Promise<void> | void;
}

export interface PopupPortRegistry {
  /** Push a fresh state to every currently connected popup. */
  broadcastState(state: PopupState): void;
}

export function registerPopupPortHandlers(
  handlers: PopupPortHandlers,
): PopupPortRegistry {
  const ports = new Set<Port>();

  browser.runtime.onConnect.addListener((rawPort) => {
    if (rawPort.name !== POPUP_PORT_NAME) {
      return;
    }

    ports.add(rawPort);
    post(rawPort, { type: 'state', state: handlers.getState() });

    rawPort.onMessage.addListener(async (message: PopupToBackground) => {
      if (message.type !== 'command') {
        return;
      }

      try {
        await handlers.handleCommand(message.command);
        post(rawPort, { type: 'ack', id: message.id });
      } catch (error) {
        post(rawPort, {
          type: 'nack',
          id: message.id,
          error: getErrorMessage(error),
        });
      }
    });

    rawPort.onDisconnect.addListener(() => {
      ports.delete(rawPort);
    });
  });

  return {
    broadcastState(state) {
      const envelope: BackgroundToPopup = { type: 'state', state };
      for (const port of ports) {
        post(port, envelope);
      }
    },
  };
}

function post(port: Port, message: BackgroundToPopup): void {
  try {
    port.postMessage(message);
  } catch {
    // Port already disconnected; the onDisconnect handler will clean up.
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}
