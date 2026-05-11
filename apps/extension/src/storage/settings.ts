import { storage } from '#imports';
import { sanitizeMemberName } from '@open-watch-party/shared';

export interface Settings {
  readonly memberName: string;
}

const settingsItem = storage.defineItem<Settings>('local:watch-party-settings', {
  init: () => ({
    memberName: createGuestName(),
  }),
});

export async function getSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  const settings = normalizeSettings(stored);

  if (settings.memberName !== stored.memberName) {
    await settingsItem.setValue(settings);
  }

  return settings;
}

export async function updateSettings(next: Settings): Promise<Settings> {
  const settings = normalizeSettings(next);
  await settingsItem.setValue(settings);
  return settings;
}

function normalizeSettings(settings: Settings): Settings {
  return {
    memberName: sanitizeMemberName(settings.memberName),
  };
}

function createGuestName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}
