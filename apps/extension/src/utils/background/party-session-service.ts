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
import { RealtimeConnection } from './realtime-connection';
import type { BackgroundState } from './state';
import {
  clearControlledTab,
  clearSession,
  normalizeServerUrl,
  selectSession,
  setControlledTab,
  setJoinedSession,
  setSessionError,
  updateSessionConnectionStatus,
  updateSessionRoom,
} from './state';
import type { SettingsStore } from './settings-store';
import type { ControlledTabService } from './controlled-tab-service';
import { createLogger, getLogError } from '../logger';

const log = createLogger('background:party-session');

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(
    private readonly state: BackgroundState,
    private readonly settingsStore: SettingsStore,
    private readonly controlledTab: ControlledTabService,
  ) {}

  async connectForStoredSession(): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      log.trace('session:stored_session_missing');
      return;
    }

    log.info(
      {
        roomCode: session.roomCode,
        serviceId: session.serviceId,
      },
      'session:stored_session_connect',
    );
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
      log.warn({ error: getLogError(error) }, 'session:stored_session_connect_failed');
      setSessionError(this.state, getErrorMessage(error), { clearSession: true });
      await this.settingsStore.persist();
      syncPopupState(this.state);
    }
  }

  async createRoom(): Promise<void> {
    log.info('session:create_room_started');
    const { tabId, context, playback } = await this.controlledTab.requireControllableWatchTab();

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
      serviceId: context.serviceId,
      initialPlayback: playback,
    });

    setControlledTab(this.state, tabId, context);
    await this.applyRoomResponse(response);
    await this.controlledTab.applySnapshotToControlledTab();
    log.info(
      {
        roomCode: response.snapshot.roomCode,
        mediaId: response.snapshot.playback.mediaId,
      },
      'session:create_room_ok',
    );
  }

  async joinRoom(roomCode: string): Promise<void> {
    log.info({ roomCode: normalizeRoomCode(roomCode) }, 'session:join_room_started');
    const tabId = await this.controlledTab.getFreshActiveTabId();

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
    });

    setControlledTab(this.state, tabId);
    await this.applyRoomResponse(response);

    try {
      await this.controlledTab.navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
    } catch (error) {
      log.warn(
        {
          roomCode: response.snapshot.roomCode,
          tabId,
          error: getLogError(error),
        },
        'session:join_room_navigation_failed',
      );
      await this.leaveRoom();
      throw error;
    }
    log.info(
      {
        roomCode: response.snapshot.roomCode,
        mediaId: response.snapshot.playback.mediaId,
        tabId,
      },
      'session:join_room_ok',
    );
  }

  async leaveRoom(): Promise<void> {
    const session = selectSession(this.state);
    log.info({ roomCode: session?.roomCode }, 'session:leave_room_started');
    if (session && this.connection) {
      try {
        await this.emitRoomLeave();
      } catch (error) {
        log.trace({ error: getLogError(error) }, 'session:leave_room_emit_failed');
        // Best effort.
      }
    }

    this.closeConnection();
    clearSession(this.state);
    clearControlledTab(this.state);
    await this.settingsStore.persist();
    syncPopupState(this.state);
    log.info('session:leave_room_ok');
  }

  async sendPlaybackUpdate(update: PlaybackUpdateDraft, isLocalRelay = false): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      log.trace(
        { mediaId: update.mediaId, isLocalRelay },
        'session:playback_update_without_session',
      );
      if (isLocalRelay) return;
      throw new Error('Join or create a room first.');
    }

    const playbackContext = this.controlledTab.getControlledTabContext();
    if (playbackContext?.mediaId && playbackContext.mediaId !== update.mediaId) {
      log.warn(
        {
          contextMediaId: playbackContext.mediaId,
          updateMediaId: update.mediaId,
        },
        'session:playback_update_media_mismatch',
      );
      this.state.lastWarning = 'Local title no longer matches the active room.';
      syncPopupState(this.state);
      return;
    }

    const stampedUpdate = {
      ...update,
      clientSequence: await this.incrementPlaybackClientSequence(session),
    };
    log.trace(
      {
        roomCode: session.roomCode,
        mediaId: stampedUpdate.mediaId,
        playing: stampedUpdate.playing,
        positionSec: stampedUpdate.positionSec,
        clientSequence: stampedUpdate.clientSequence,
        isLocalRelay,
      },
      'session:playback_update_send',
    );
    const snapshot = await this.emitPlaybackUpdate(stampedUpdate);
    this.applyPlaybackSnapshot(snapshot);
  }

  private ensureMemberId(): string {
    return selectSession(this.state)?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
  }

  private async ensureConnection(): Promise<void> {
    const serverUrl = normalizeServerUrl(this.state.settings.serverUrl);

    if (this.connection?.serverUrl === serverUrl) {
      log.trace({ serverUrl }, 'session:connection_reuse');
      return;
    }

    this.closeConnection();

    const connection = new RealtimeConnection(serverUrl);
    this.connection = connection;
    log.info({ serverUrl }, 'session:connection_created');

    connection.onStatusChange((status, errorMessage) => {
      if (this.connection !== connection) {
        return;
      }

      updateSessionConnectionStatus(this.state, status);
      this.state.lastError = errorMessage ?? (status === 'connected' ? null : this.state.lastError);
      syncPopupState(this.state);
      log.trace({ status, errorMessage }, 'session:connection_status');
    });

    connection.onReconnect(async () => {
      if (this.connection !== connection) {
        return;
      }

      log.info({ roomCode: selectSession(this.state)?.roomCode }, 'session:connection_reconnected');
      await this.rejoinRoom();
    });

    connection.on('room:state', (snapshot) => {
      if (this.connection !== connection) {
        return;
      }

      updateSessionRoom(this.state, snapshot);
      syncPopupState(this.state);
      log.debug(
        {
          roomCode: snapshot.roomCode,
          sequence: snapshot.sequence,
          memberCount: snapshot.members.length,
        },
        'session:room_state_received',
      );
    });

    connection.on('playback:state', async (snapshot) => {
      if (this.connection !== connection) {
        return;
      }

      updateSessionRoom(this.state, snapshot);
      await this.controlledTab.applySnapshotToControlledTab();
      syncPopupState(this.state);
      log.debug(
        {
          roomCode: snapshot.roomCode,
          sequence: snapshot.sequence,
          playbackSequence: snapshot.playback.sequence,
          mediaId: snapshot.playback.mediaId,
        },
        'session:playback_state_received',
      );
    });
  }

  private async rejoinRoom(): Promise<void> {
    const session = selectSession(this.state);
    if (!session) {
      log.trace('session:rejoin_skipped_without_session');
      return;
    }

    try {
      log.info({ roomCode: session.roomCode }, 'session:rejoin_started');
      const response = await this.emitRoomJoin({
        roomCode: session.roomCode,
        memberId: session.memberId,
        memberName: this.state.settings.memberName,
        serviceId: session.serviceId,
      });

      await this.applyRoomResponse(response);
      await this.controlledTab.applySnapshotToControlledTab();
      log.info({ roomCode: response.snapshot.roomCode }, 'session:rejoin_ok');
    } catch (error) {
      log.warn({ error: getLogError(error) }, 'session:rejoin_failed');
      setSessionError(this.state, getErrorMessage(error));
      syncPopupState(this.state);
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
    syncPopupState(this.state);
    log.trace(
      {
        roomCode: response.snapshot.roomCode,
        memberId: response.memberId,
        serviceId: response.snapshot.serviceId,
        sequence: response.snapshot.sequence,
      },
      'session:room_response_applied',
    );
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
    if (this.connection) {
      log.info({ serverUrl: this.connection.serverUrl }, 'session:connection_closed');
    }
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
    log.debug(
      {
        roomCode: session.roomCode,
        previousClientSequence: session.playbackClientSequence,
        nextClientSequence,
      },
      'session:playback_sequence_incremented',
    );
    return nextClientSequence;
  }

  private unwrapAckResponse<T>(response: OperationResult<T>): T {
    if (!response.ok) {
      log.warn({ error: response.error }, 'session:ack_error');
      throw new Error(response.error);
    }
    if (response.data == null) {
      log.warn('session:ack_empty');
      throw new Error('Server returned an empty payload.');
    }

    return response.data;
  }

  private validateOutboundPayload<T>(schema: ZodSchemaLike<T>, payload: unknown): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      log.warn('session:invalid_outbound_payload');
      throw new Error('Invalid request payload.');
    }

    return result.data;
  }
}

type ZodSchemaLike<T> = {
  safeParse(payload: unknown): { success: true; data: T } | { success: false };
};
