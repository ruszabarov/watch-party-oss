import { storage } from '#imports';
import { sanitizeMemberName } from '@open-watch-party/shared';

export interface Settings {
  readonly memberName: string;
}

export const initialSettings: Settings = {
  memberName: 'Guest',
};

export const settingsItem = storage.defineItem<Settings>('local:watch-party-settings', {
  fallback: initialSettings,
  init: createDefaultSettings,
});

export async function getSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  const settings = normalizeSettings(stored);

  if (settings.memberName !== stored.memberName) {
    await settingsItem.setValue(settings);
  }

  return settings;
}

export async function updateSettings(next: Settings): Promise<void> {
  await settingsItem.setValue(normalizeSettings(next));
}

function normalizeSettings(settings: Settings): Settings {
  return {
    memberName: sanitizeMemberName(settings.memberName),
  };
}

function createDefaultSettings(): Settings {
  return {
    memberName: `Guest ${Math.floor(Math.random() * 900 + 100)}`,
  };
}
