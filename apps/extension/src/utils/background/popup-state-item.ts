import { storage } from '#imports';
import { createDefaultPopupState, type PopupState } from '../protocol/extension';
import { selectPopupView, type BackgroundState } from './state';

export const popupStateItem = storage.defineItem<PopupState>('session:popup-state', {
  fallback: createDefaultPopupState(),
});

export function syncPopupState(state: BackgroundState): void {
  void popupStateItem.setValue(selectPopupView(state));
}
