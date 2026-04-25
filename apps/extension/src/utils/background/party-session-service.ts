import { browser } from 'wxt/browser';
import {
  createRoomRequestSchema,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  normalizeRoomCode,
  playbackUpdateRequestSchema,
} from '@open-watch-party/shared';

import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  PlaybackUpdateDraft,
  RoomResponse,
} from '@open-watch-party/shared';

import { getErrorMessage } from '../errors';
import { syncPopupState } from './popup-state-item';
import { createRealtimeConnection, type RealtimeConnection } from './realtime-connection';
import type { BackgroundState } from './state';
import { normalizeServerUrl } from './state';
import type { SettingsStore } from './settings-store';
import type { ControlledTabService } from './controlled-tab-service';

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(
    private readonly state: BackgroundState,
    private readonly settingsStore: SettingsStore,
    private readonly controlledTab: ControlledTabService,
  ) {}

  async connectForStoredSession(): Promise<void> {
    if (!this.state.session) {
      return;
    }

    try {
      await this.ensureConnection();
      const response = await this.emitRoomJoin({
        roomCode: this.state.session.roomCode,
        memberId: this.state.session.memberId,
        memberName: this.state.settings.memberName,
        serviceId: this.state.session.serviceId,
      });

      await this.applyRoomResponse(response);
    } catch (error) {
      this.state.room = null;
      this.state.session = null;
      this.state.lastError = getErrorMessage(error);
      this.state.connectionStatus = 'error';
      await this.settingsStore.persist();
      syncPopupState(this.state);
    }
  }

  async createRoom(): Promise<void> {
    const { context, playback } = await this.controlledTab.requireControllableWatchTab();

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
      serviceId: context.serviceId,
      initialPlayback: playback,
    });

    this.state.controlledTabId = this.state.activeTab.tabId;
    await this.applyRoomResponse(response);
    await this.controlledTab.applySnapshotToControlledTab();
  }

  async joinRoom(roomCode: string): Promise<void> {
    const tabId = await this.controlledTab.getFreshActiveTabId();

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
    });

    this.state.controlledTabId = tabId;
    await this.applyRoomResponse(response);

    try {
      await this.controlledTab.navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
    } catch (error) {
      await this.leaveRoom();
      throw error;
    }
  }

  async leaveRoom(): Promise<void> {
    if (this.state.session && this.connection) {
      try {
        await this.emitRoomLeave();
      } catch {
        // Best effort.
      }
    }

    this.state.room = null;
    this.state.session = null;
    this.closeConnection();
    this.state.connectionStatus = 'disconnected';
    this.state.lastError = null;
    this.state.lastWarning = null;
    await this.settingsStore.persist();
    syncPopupState(this.state);
  }

  async sendPlaybackUpdate(update: PlaybackUpdateDraft, isLocalRelay = false): Promise<void> {
    const session = this.state.session;
    if (!session) {
      if (isLocalRelay) return;
      throw new Error('Join or create a room first.');
    }

    const playbackContext = this.controlledTab.getControlledTabContext();
    if (playbackContext?.mediaId && playbackContext.mediaId !== update.mediaId) {
      this.state.lastWarning = 'Local title no longer matches the active room.';
      syncPopupState(this.state);
      return;
    }

    const stampedUpdate = {
      ...update,
      clientSequence: await this.incrementPlaybackClientSequence(session),
    };
    const snapshot = await this.emitPlaybackUpdate(stampedUpdate);
    this.applyPlaybackSnapshot(snapshot);
  }

  private ensureMemberId(): string {
    return this.state.session?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
  }

  private async ensureConnection(): Promise<void> {
    const serverUrl = normalizeServerUrl(this.state.settings.serverUrl);

    if (this.connection?.serverUrl === serverUrl) {
      return;
    }

    this.closeConnection();

    const connection = createRealtimeConnection(serverUrl);
    this.connection = connection;

    connection.onStatusChange((status, errorMessage) => {
      if (this.connection !== connection) {
        return;
      }

      this.state.connectionStatus = status;
      this.state.lastError = errorMessage ?? (status === 'connected' ? null : this.state.lastError);
      syncPopupState(this.state);
    });

    connection.onReconnect(async () => {
      if (this.connection !== connection) {
        return;
      }

      await this.rejoinRoom();
    });

    connection.on('room:state', (snapshot) => {
      if (this.connection !== connection) {
        return;
      }

      this.state.room = snapshot;
      this.state.lastWarning = null;
      syncPopupState(this.state);
    });

    connection.on('playback:state', async (snapshot) => {
      if (this.connection !== connection) {
        return;
      }

      this.state.room = snapshot;
      this.state.lastWarning = null;
      await this.controlledTab.applySnapshotToControlledTab();
      syncPopupState(this.state);
    });
  }

  private async rejoinRoom(): Promise<void> {
    if (!this.state.session) {
      return;
    }

    try {
      const response = await this.emitRoomJoin({
        roomCode: this.state.session.roomCode,
        memberId: this.state.session.memberId,
        memberName: this.state.settings.memberName,
        serviceId: this.state.session.serviceId,
      });

      await this.applyRoomResponse(response);
      await this.controlledTab.applySnapshotToControlledTab();
    } catch (error) {
      this.state.lastError = getErrorMessage(error);
      this.state.connectionStatus = 'error';
      syncPopupState(this.state);
    }
  }

  private async applyRoomResponse(response: RoomResponse): Promise<void> {
    const currentSession = this.state.session;
    this.state.room = response.snapshot;
    this.state.session = {
      roomCode: response.snapshot.roomCode,
      memberId: response.memberId,
      serviceId: response.snapshot.serviceId,
      playbackClientSequence:
        currentSession &&
        currentSession.roomCode === response.snapshot.roomCode &&
        currentSession.memberId === response.memberId &&
        currentSession.serviceId === response.snapshot.serviceId
          ? currentSession.playbackClientSequence
          : 0,
    };
    this.state.connectionStatus = 'connected';
    this.state.lastError = null;
    await this.settingsStore.persistSession(this.state.session);
    syncPopupState(this.state);
  }

  private async emitRoomCreate(payload: CreateRoomRequest): Promise<RoomResponse> {
    const connection = await this.getConnection();
    const response = await connection.request(
      'room:create',
      this.validateOutboundPayload(createRoomRequestSchema, payload),
    );
    return this.unwrapAckResponse(response);
  }

  private async emitRoomJoin(payload: JoinRoomRequest): Promise<RoomResponse> {
    const connection = await this.getConnection();
    const response = await connection.request(
      'room:join',
      this.validateOutboundPayload(joinRoomRequestSchema, payload),
    );
    return this.unwrapAckResponse(response);
  }

  private async emitRoomLeave(): Promise<{ roomCode: string }> {
    const connection = await this.getConnection();
    const response = await connection.request(
      'room:leave',
      this.validateOutboundPayload(leaveRoomRequestSchema, {}),
    );
    return this.unwrapAckResponse(response);
  }

  private async emitPlaybackUpdate(update: PlaybackUpdate): Promise<PartySnapshot> {
    const connection = await this.getConnection();
    const response = await connection.request(
      'playback:update',
      this.validateOutboundPayload(playbackUpdateRequestSchema, { update }),
    );
    return this.unwrapAckResponse(response);
  }

  private applyPlaybackSnapshot(snapshot: PartySnapshot): void {
    this.state.room = snapshot;
    this.state.lastWarning = null;
    syncPopupState(this.state);
  }

  private async getConnection(): Promise<RealtimeConnection> {
    await this.ensureConnection();
    if (!this.connection) {
      throw new Error('Realtime connection unavailable.');
    }

    return this.connection;
  }

  private closeConnection(): void {
    this.connection?.disconnect();
    this.connection = null;
  }

  private async incrementPlaybackClientSequence(
    session: NonNullable<BackgroundState['session']>,
  ): Promise<number> {
    const nextClientSequence = session.playbackClientSequence + 1;
    await this.settingsStore.persistSession({
      ...session,
      playbackClientSequence: nextClientSequence,
    });
    return nextClientSequence;
  }

  private unwrapAckResponse<T>(response: OperationResult<T>): T {
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.data == null) {
      throw new Error('Server returned an empty payload.');
    }

    return response.data;
  }

  private validateOutboundPayload<T>(schema: ZodSchemaLike<T>, payload: unknown): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new Error('Invalid request payload.');
    }

    return result.data;
  }
}

type ZodSchemaLike<T> = {
  safeParse(payload: unknown): { success: true; data: T } | { success: false };
};
