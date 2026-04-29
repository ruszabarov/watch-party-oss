import { browser } from 'wxt/browser';
import { ZodType } from 'zod';
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
import type { BackgroundBus } from './bus';
import { RealtimeConnection } from './realtime-connection';
import {
  clearControlledTab,
  clearSession,
  selectSession,
  setControlledTab,
  setJoinedSession,
  setSessionError,
  syncBackgroundState,
  type BackgroundState,
  updateSessionConnectionStatus,
  updateSessionRoom,
} from './state';
import type { SettingsStore } from './settings-store';
import type { ControlledTabService } from './controlled-tab-service';
import { SERVER_URL } from '../config';

const ACTIVE_ROOM_EXISTS_ERROR = 'Leave your current room before joining or creating another room.';

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(
    private readonly state: BackgroundState,
    private readonly bus: BackgroundBus,
    private readonly settingsStore: SettingsStore,
    private readonly controlledTab: ControlledTabService,
  ) {}

  registerEventHandlers(): void {
    this.bus.on('controlled-tab:playback-update', ({ update }) => {
      void this.sendPlaybackUpdate(update, true).catch((error) => {
        this.state.lastError = getErrorMessage(error);
        syncBackgroundState(this.state);
      });
    });
  }

  async connectForStoredSession(): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      return;
    }

    try {
      await this.ensureConnection();
      const response = await this.emitRoomJoin({
        roomCode: session.roomCode,
        memberId: session.memberId,
        memberName: this.state.settings.memberName,
        serviceId: session.serviceId,
      });

      await this.applyRoomResponse(response);
    } catch (error) {
      setSessionError(this.state, getErrorMessage(error), { clearSession: true });
      await this.settingsStore.persist();
      syncBackgroundState(this.state);
    }
  }

  async createRoom(tabId: number): Promise<void> {
    this.assertNoActiveSession();

    const { context, playback } = await this.controlledTab.requireControllableWatchTab(tabId);

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
      serviceId: context.serviceId,
      initialPlayback: playback,
    });

    setControlledTab(this.state, tabId, context);
    await this.applyRoomResponse(response);
    this.bus.emit('session:snapshot-updated', undefined);
  }

  async joinRoom(roomCode: string, tabId: number): Promise<void> {
    this.assertNoActiveSession();

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
    });

    await this.applyRoomResponse(response);

    try {
      await this.controlledTab.navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
    } catch (error) {
      await this.leaveRoom();
      throw error;
    }
  }

  async leaveRoom(): Promise<void> {
    const session = selectSession(this.state);
    if (session && this.connection) {
      try {
        await this.emitRoomLeave();
      } catch {
        // Best effort.
      }
    }

    this.closeConnection();
    clearSession(this.state);
    clearControlledTab(this.state);
    await this.settingsStore.persist();
    syncBackgroundState(this.state);
  }

  async sendPlaybackUpdate(update: PlaybackUpdateDraft, isLocalRelay = false): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      if (isLocalRelay) return;
      throw new Error('Join or create a room first.');
    }

    const playbackContext = this.controlledTab.getControlledTabContext();
    if (playbackContext && playbackContext.mediaId !== update.mediaId) {
      this.state.lastWarning = 'Local title no longer matches the active room.';
      syncBackgroundState(this.state);
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
    return selectSession(this.state)?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
  }

  private assertNoActiveSession(): void {
    if (selectSession(this.state)) {
      throw new Error(ACTIVE_ROOM_EXISTS_ERROR);
    }
  }

  private async ensureConnection(): Promise<void> {
    const serverUrl = SERVER_URL;

    if (this.connection?.serverUrl === serverUrl) {
      return;
    }

    this.closeConnection();

    const connection = new RealtimeConnection(serverUrl);
    this.connection = connection;

    connection.onStatusChange((status, errorMessage) => {
      if (this.connection !== connection) {
        return;
      }

      updateSessionConnectionStatus(this.state, status);
      this.state.lastError = errorMessage ?? (status === 'connected' ? null : this.state.lastError);
      syncBackgroundState(this.state);
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

      updateSessionRoom(this.state, snapshot);
      syncBackgroundState(this.state);
    });

    connection.on('playback:state', async (snapshot) => {
      if (this.connection !== connection) {
        return;
      }

      updateSessionRoom(this.state, snapshot);
      this.bus.emit('session:snapshot-updated', undefined);
      syncBackgroundState(this.state);
    });
  }

  private async rejoinRoom(): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      return;
    }

    try {
      const response = await this.emitRoomJoin({
        roomCode: session.roomCode,
        memberId: session.memberId,
        memberName: this.state.settings.memberName,
        serviceId: session.serviceId,
      });

      await this.applyRoomResponse(response);
      this.bus.emit('session:snapshot-updated', undefined);
    } catch (error) {
      setSessionError(this.state, getErrorMessage(error));
      syncBackgroundState(this.state);
    }
  }

  private async applyRoomResponse(response: RoomResponse): Promise<void> {
    const currentSession = selectSession(this.state);
    const nextSession = {
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
    setJoinedSession(this.state, nextSession, response.snapshot);
    this.state.lastError = null;
    await this.settingsStore.persistSession(nextSession);
    syncBackgroundState(this.state);
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
    updateSessionRoom(this.state, snapshot);
    syncBackgroundState(this.state);
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
    session: NonNullable<ReturnType<typeof selectSession>>,
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

  private validateOutboundPayload<T>(schema: ZodType<T>, payload: unknown): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new Error('Invalid request payload.');
    }

    return result.data;
  }
}
