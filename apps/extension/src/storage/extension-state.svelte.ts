import {
  backgroundStateItem,
  initialBackgroundState,
  type BackgroundState,
} from '../background/state';
import { useStorageItem } from '../utils/storage-item-state.svelte';
import { initialSettings, settingsItem, type Settings } from './settings';

export function useBackgroundState() {
  return useStorageItem<BackgroundState>(backgroundStateItem, initialBackgroundState);
}

export function useSettingsState() {
  return useStorageItem<Settings>(settingsItem, initialSettings);
}
