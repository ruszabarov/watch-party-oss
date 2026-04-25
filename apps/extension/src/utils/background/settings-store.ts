import { storage } from '#imports';

import type { BackgroundState, SessionInfo, StoredSettings } from './state';
import { normalizeMemberName, normalizeServerUrl } from './state';

const settingsItem = storage.defineItem<StoredSettings>('local:watch-party-settings');

export class SettingsStore {
  constructor(private readonly state: BackgroundState) {}

  async hydrate(): Promise<void> {
    const stored = await settingsItem.getValue();

    if (!stored) {
      await this.persist();
      return;
    }

    this.state.settings.memberName = normalizeMemberName(stored.memberName);
    this.state.settings.serverUrl = normalizeServerUrl(stored.serverUrl);
    this.state.session = stored.session;
  }

  async updateSettings(next: { serverUrl: string; memberName: string }): Promise<void> {
    this.state.settings = {
      serverUrl: normalizeServerUrl(next.serverUrl),
      memberName: normalizeMemberName(next.memberName),
    };
    await this.persist();
  }

  async persistSession(session: SessionInfo | null): Promise<void> {
    this.state.session = session;
    await this.persist();
  }

  async persist(): Promise<void> {
    const storedSettings: StoredSettings = {
      memberName: this.state.settings.memberName,
      serverUrl: this.state.settings.serverUrl,
      session: this.state.session,
    };

    await settingsItem.setValue(storedSettings);
  }
}
