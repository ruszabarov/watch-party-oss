import type { BackgroundBroadcast } from '../protocol/extension';
import { buildPopupState, type InternalState } from './state';

export function emitStateChanged(state: InternalState): void {
  const message: BackgroundBroadcast = {
    type: 'party:state-updated',
    state: buildPopupState(state),
  };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}
