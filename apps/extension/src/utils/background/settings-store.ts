import { storage } from '#imports';

import type { BackgroundStore, SessionInfo } from './state';
import { normalizeMemberName, selectSession } from './state';

type StoredSettings = {
  memberName: string;
  session: SessionInfo | null;
};

const settingsItem = storage.defineItem<StoredSettings>('local:watch-party-settings');

export class SettingsStore {
  constructor(private readonly store: BackgroundStore) {}

  async hydrate(): Promise<void> {
    const stored = await settingsItem.getValue();

    if (!stored) {
      await this.persist();
      return;
    }

    this.store.trigger.hydrateSettings({
      settings: {
        memberName: normalizeMemberName(stored.memberName),
      },
      session: stored.session,
    });
  }

  async updateSettings(next: { memberName: string }): Promise<void> {
    this.store.trigger.updateSettings({
      settings: {
        memberName: normalizeMemberName(next.memberName),
      },
    });
    await this.persist();
  }

  async persistSession(session: SessionInfo | null): Promise<void> {
    this.store.trigger.updatePersistedSession({ session });
    await this.persist();
  }

  async persist(): Promise<void> {
    const state = this.store.getSnapshot().context;
    const storedSettings: StoredSettings = {
      memberName: state.settings.memberName,
      session: selectSession(state),
    };

    await settingsItem.setValue(storedSettings);
  }
}
