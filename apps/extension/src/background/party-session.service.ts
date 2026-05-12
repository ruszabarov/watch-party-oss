import { browser } from 'wxt/browser';
import { normalizeRoomCode } from '@open-watch-party/shared';

import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  RoomResponse,
  StreamingServiceId,
} from '@open-watch-party/shared';

import { getErrorMessage } from '~/utils/errors.js';
import { getSettings } from '../storage/settings';
import { RealtimeConnection } from './connection.service';
import { backgroundStore, backgroundSelectors } from './state';

const ACTIVE_ROOM_EXISTS_ERROR = 'Leave your current room before joining or creating another room.';
const SERVER_URL = __DEFAULT_SERVER_URL__;

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  updateRoomPlaybackFromControlledTab(update: PlaybackUpdate): void {
    void this.sendPlaybackUpdate(update).catch((error) => {
      backgroundStore.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  updateRoomMediaFromControlledTab(mediaId: string): void {
    void this.sendMediaSwitchUpdate(mediaId).catch((error) => {
      backgroundStore.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  async createRoom(
    tabId: number,
    streamingServiceId: StreamingServiceId,
    playback: PlaybackUpdate,
  ): Promise<void> {
    this.assertNoActiveSession();

    const settings = await getSettings();

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: settings.memberName,
      streamingServiceId,
      initialPlayback: playback,
    });

    backgroundStore.trigger.setControlledTab({ tabId, mediaId: playback.mediaId });
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
    if (backgroundSelectors.session.get() && this.connection) {
      try {
        await this.emitRoomLeave();
      } catch {
        // Best effort.
      }
    }

    this.closeConnection();
    backgroundStore.trigger.leaveRoom();
  }

  private async sendPlaybackUpdate(update: PlaybackUpdate): Promise<void> {
    if (!backgroundSelectors.session.get()) {
      return;
    }

    const controlledMediaId = backgroundSelectors.controlledTab.get()?.mediaId ?? null;
    if (controlledMediaId !== null && controlledMediaId !== update.mediaId) {
      backgroundStore.trigger.setLastWarning({
        message: 'Local media no longer matches the active room.',
      });
      return;
    }

    const snapshot = await this.emitPlaybackUpdate(update);
    backgroundStore.trigger.updateSessionRoom({ room: snapshot });
  }

  private ensureMemberId(): string {
    return backgroundSelectors.session.get()?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
  }

  private assertNoActiveSession(): void {
    if (backgroundSelectors.session.get()) {
      throw new Error(ACTIVE_ROOM_EXISTS_ERROR);
    }
  }

  private ensureConnection(): RealtimeConnection {
    if (this.connection) {
      return this.connection;
    }

    const connection = new RealtimeConnection(SERVER_URL);
    this.connection = connection;

    connection.onConnectionError((error) => {
      backgroundStore.trigger.reportError({ message: getErrorMessage(error) });
    });

    connection.onReconnect(() => this.rejoinRoom());

    connection.on('room:state', (snapshot) => {
      backgroundStore.trigger.updateSessionRoom({ room: snapshot });
    });

    connection.on('playback:state', (snapshot) => {
      backgroundStore.trigger.updateSessionRoom({
        room: snapshot,
        applySnapshotToControlledTab: true,
      });
    });

    return connection;
  }

  private async rejoinRoom(): Promise<void> {
    const session = backgroundSelectors.session.get();
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
      backgroundStore.trigger.setSessionError({ message: getErrorMessage(error) });
    }
  }

  private async sendMediaSwitchUpdate(mediaId: string): Promise<void> {
    const session = backgroundSelectors.session.get();
    if (!session) {
      return;
    }

    if (backgroundSelectors.room.get()?.playback.mediaId === mediaId) {
      return;
    }

    await this.sendPlaybackUpdate({
      mediaId,
      title: '',
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
      streamingServiceId: response.snapshot.streamingServiceId,
    };
    backgroundStore.trigger.setJoinedSession({
      session: nextSession,
      room: response.snapshot,
      applySnapshotToControlledTab,
    });
  }

  private async emitRoomCreate(payload: CreateRoomRequest): Promise<RoomResponse> {
    return this.unwrapAckResponse(await this.ensureConnection().createRoom(payload));
  }

  private async emitRoomJoin(payload: JoinRoomRequest): Promise<RoomResponse> {
    return this.unwrapAckResponse(await this.ensureConnection().joinRoom(payload));
  }

  private async emitRoomLeave(): Promise<{ roomCode: string }> {
    return this.unwrapAckResponse(await this.ensureConnection().leaveRoom());
  }

  private async emitPlaybackUpdate(update: PlaybackUpdate): Promise<PartySnapshot> {
    return this.unwrapAckResponse(await this.ensureConnection().updatePlayback(update));
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
