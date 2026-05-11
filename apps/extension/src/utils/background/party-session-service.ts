import { browser } from 'wxt/browser';
import type { ZodType } from 'zod';
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

import { getErrorMessage } from '$lib/errors.js';
import type { WatchPageContext } from '../protocol/extension';
import { RealtimeConnection } from './realtime-connection';
import { selectRoom, selectSession, type BackgroundState, type BackgroundStore } from './state';
import type { SettingsStore } from './settings-store';

const ACTIVE_ROOM_EXISTS_ERROR = 'Leave your current room before joining or creating another room.';
const SERVER_URL = __DEFAULT_SERVER_URL__;

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(
    private readonly store: BackgroundStore,
    private readonly settingsStore: SettingsStore,
  ) {}

  private get state(): BackgroundState {
    return this.store.getSnapshot().context;
  }

  updateRoomPlaybackFromControlledTab(update: PlaybackUpdateDraft): void {
    void this.sendPlaybackUpdate(update).catch((error) => {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  updateRoomMediaFromControlledTab(context: WatchPageContext): void {
    void this.sendMediaSwitchUpdate(context).catch((error) => {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
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
      });

      await this.applyRoomResponse(response);
    } catch (error) {
      this.store.trigger.setSessionError({
        message: getErrorMessage(error),
        clearSession: true,
      });
      await this.settingsStore.persist();
    }
  }

  async createRoom(
    tabId: number,
    context: WatchPageContext,
    playback: PlaybackUpdateDraft,
  ): Promise<void> {
    this.assertNoActiveSession();

    const { serviceId: _playbackServiceId, ...initialPlayback } = playback;

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
      serviceId: context.serviceId,
      initialPlayback,
    });

    this.store.trigger.setControlledTab({ tabId, context });
    await this.applyRoomResponse(response, true);
  }

  async joinRoom(roomCode: string): Promise<RoomResponse> {
    this.assertNoActiveSession();

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
    });

    await this.applyRoomResponse(response);
    return response;
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
    this.store.trigger.leaveRoom();
    await this.settingsStore.persist();
  }

  private async sendPlaybackUpdate(update: PlaybackUpdateDraft): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      return;
    }

    const playbackContext = this.state.controlledTab?.context ?? null;
    if (
      playbackContext &&
      (playbackContext.serviceId !== update.serviceId || playbackContext.mediaId !== update.mediaId)
    ) {
      this.store.trigger.setLastWarning({
        message: 'Local media no longer matches the active room.',
      });
      return;
    }

    const stampedUpdate = {
      ...update,
      clientSequence: await this.incrementPlaybackClientSequence(),
    };
    const snapshot = await this.emitPlaybackUpdate(stampedUpdate);
    this.store.trigger.updateSessionRoom({ room: snapshot });
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

      this.store.trigger.updateSessionConnectionStatus({ status, errorMessage });
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

      this.store.trigger.updateSessionRoom({ room: snapshot });
    });

    connection.on('playback:state', (snapshot) => {
      if (this.connection !== connection) {
        return;
      }

      this.store.trigger.updateSessionRoom({ room: snapshot, applySnapshotToControlledTab: true });
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
      });

      await this.applyRoomResponse(response, true);
    } catch (error) {
      this.store.trigger.setSessionError({ message: getErrorMessage(error) });
    }
  }

  private async sendMediaSwitchUpdate(context: WatchPageContext): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      return;
    }

    if (context.serviceId !== session.serviceId) {
      this.store.trigger.setLastWarning({
        message: 'Rooms can only switch media within the original service.',
      });
      return;
    }

    const room = selectRoom(this.state);
    if (room?.playback.mediaId === context.mediaId) {
      return;
    }

    await this.sendPlaybackUpdate({
      serviceId: context.serviceId,
      mediaId: context.mediaId,
      title: context.title ?? '',
      positionSec: 0,
      playing: false,
    });
  }

  private async applyRoomResponse(
    response: RoomResponse,
    applySnapshotToControlledTab = false,
  ): Promise<void> {
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
    this.store.trigger.setJoinedSession({
      session: nextSession,
      room: response.snapshot,
      applySnapshotToControlledTab,
    });
    await this.settingsStore.persist();
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
      this.validateOutboundPayload(playbackUpdateRequestSchema, update),
    );
    return this.unwrapAckResponse(response);
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

  private async incrementPlaybackClientSequence(): Promise<number> {
    this.store.trigger.advancePlaybackClientSequence();
    const session = selectSession(this.state);
    if (!session) {
      throw new Error('Join or create a room first.');
    }

    await this.settingsStore.persist();
    return session.playbackClientSequence;
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
