import { browser } from 'wxt/browser';
import { normalizeRoomCode } from '@open-watch-party/shared';

import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  RoomResponse,
} from '@open-watch-party/shared';

import { getErrorMessage } from '~/utils/errors.js';
import { getSettings } from '../storage/settings';
import type { WatchPageContext } from '../messaging';
import { RealtimeConnection } from './realtime-connection';
import type { BackgroundState, BackgroundStore } from './state';

const ACTIVE_ROOM_EXISTS_ERROR = 'Leave your current room before joining or creating another room.';
const SERVER_URL = __DEFAULT_SERVER_URL__;

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(private readonly store: BackgroundStore) {}

  private get state(): BackgroundState {
    return this.store.getSnapshot().context;
  }

  updateRoomPlaybackFromControlledTab(update: PlaybackUpdate): void {
    void this.sendPlaybackUpdate(update).catch((error) => {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  updateRoomMediaFromControlledTab(context: WatchPageContext): void {
    void this.sendMediaSwitchUpdate(context).catch((error) => {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  async createRoom(
    tabId: number,
    context: WatchPageContext,
    playback: PlaybackUpdate,
  ): Promise<void> {
    this.assertNoActiveSession();

    const { serviceId: _playbackServiceId, ...initialPlayback } = playback;
    const settings = await getSettings();

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: settings.memberName,
      serviceId: context.serviceId,
      initialPlayback,
    });

    this.store.trigger.setControlledTab({ tabId, context });
    await this.applyRoomResponse(response, true);
  }

  async joinRoom(roomCode: string): Promise<RoomResponse> {
    this.assertNoActiveSession();
    const settings = await getSettings();

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: this.ensureMemberId(),
      memberName: settings.memberName,
    });

    await this.applyRoomResponse(response);
    return response;
  }

  async leaveRoom(): Promise<void> {
    if (this.state.session && this.connection) {
      try {
        await this.emitRoomLeave();
      } catch {
        // Best effort.
      }
    }

    this.closeConnection();
    this.store.trigger.leaveRoom();
  }

  private async sendPlaybackUpdate(update: PlaybackUpdate): Promise<void> {
    if (!this.state.session) {
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

    const snapshot = await this.emitPlaybackUpdate(update);
    this.store.trigger.updateSessionRoom({ room: snapshot });
  }

  private ensureMemberId(): string {
    return this.state.session?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
  }

  private assertNoActiveSession(): void {
    if (this.state.session) {
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

    connection.onConnectionError((error) => {
      if (this.connection !== connection) {
        return;
      }

      this.store.trigger.reportError({ message: getErrorMessage(error) });
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
    const session = this.state.session;
    if (!session) {
      return;
    }

    try {
      const settings = await getSettings();
      const response = await this.emitRoomJoin({
        roomCode: session.roomCode,
        memberId: session.memberId,
        memberName: settings.memberName,
      });

      await this.applyRoomResponse(response, true);
    } catch (error) {
      this.store.trigger.setSessionError({ message: getErrorMessage(error) });
    }
  }

  private async sendMediaSwitchUpdate(context: WatchPageContext): Promise<void> {
    const session = this.state.session;
    if (!session) {
      return;
    }

    if (context.serviceId !== session.serviceId) {
      this.store.trigger.setLastWarning({
        message: 'Rooms can only switch media within the original service.',
      });
      return;
    }

    if (this.state.room?.playback.mediaId === context.mediaId) {
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
    const nextSession = {
      roomCode: response.snapshot.roomCode,
      memberId: response.memberId,
      serviceId: response.snapshot.serviceId,
    };
    this.store.trigger.setJoinedSession({
      session: nextSession,
      room: response.snapshot,
      applySnapshotToControlledTab,
    });
  }

  private async emitRoomCreate(payload: CreateRoomRequest): Promise<RoomResponse> {
    const connection = await this.getConnection();
    const response = await connection.createRoom(payload);
    return this.unwrapAckResponse(response);
  }

  private async emitRoomJoin(payload: JoinRoomRequest): Promise<RoomResponse> {
    const connection = await this.getConnection();
    const response = await connection.joinRoom(payload);
    return this.unwrapAckResponse(response);
  }

  private async emitRoomLeave(): Promise<{ roomCode: string }> {
    const connection = await this.getConnection();
    const response = await connection.leaveRoom();
    return this.unwrapAckResponse(response);
  }

  private async emitPlaybackUpdate(update: PlaybackUpdate): Promise<PartySnapshot> {
    const connection = await this.getConnection();
    const response = await connection.updatePlayback(update);
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

  private unwrapAckResponse<T>(response: OperationResult<T>): T {
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.data == null) {
      throw new Error('Server returned an empty payload.');
    }

    return response.data;
  }
}
