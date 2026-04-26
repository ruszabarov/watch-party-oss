import { storage } from '#imports';

import type { BackgroundState, SessionInfo, StoredSettings } from './state';
import {
  normalizeMemberName,
  selectSession,
  setStoredSession,
  updatePersistedSession,
} from './state';

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
    setStoredSession(this.state, stored.session);
  }

  async updateSettings(next: { memberName: string }): Promise<void> {
    this.state.settings = {
      memberName: normalizeMemberName(next.memberName),
    };
    await this.persist();
  }

  async persistSession(session: SessionInfo | null): Promise<void> {
    updatePersistedSession(this.state, session);
    await this.persist();
  }

  async persist(): Promise<void> {
    const storedSettings: StoredSettings = {
      memberName: this.state.settings.memberName,
      session: selectSession(this.state),
    };

    await settingsItem.setValue(storedSettings);
  }
}
