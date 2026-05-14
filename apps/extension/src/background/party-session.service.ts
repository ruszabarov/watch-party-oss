import { browser } from 'wxt/browser';
import { normalizeRoomCode } from '@open-watch-party/shared';

import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  RoomClosedEvent,
  RoomClosedReason,
  RoomResponse,
  StreamingServiceId,
} from '@open-watch-party/shared';

import { getErrorMessage } from '~/utils/errors.js';
import { getSettings } from '../storage/settings';
import { RealtimeConnection } from './connection.service';
import {
  getBackgroundState,
  leaveRoomState,
  reportBackgroundError,
  setControlledTab,
  setJoinedSession,
  setLastWarning,
  updateSessionRoom,
} from './state';

const ACTIVE_ROOM_EXISTS_ERROR = 'Leave your current room before joining or creating another room.';
const SERVER_URL = __DEFAULT_SERVER_URL__;

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(
    private readonly options: {
      onRoomSnapshotChanged: () => void;
    },
  ) {}

  updateRoomPlaybackFromControlledTab(update: PlaybackUpdate): void {
    void this.sendPlaybackUpdate(update).catch((error) => {
      void reportBackgroundError(getErrorMessage(error));
    });
  }

  updateRoomMediaFromControlledTab(mediaId: string): void {
    void this.sendMediaSwitchUpdate(mediaId).catch((error) => {
      void reportBackgroundError(getErrorMessage(error));
    });
  }

  async resumeStoredSession(): Promise<void> {
    if (!(await getBackgroundState()).session) {
      return;
    }

    await this.rejoinRoom();
  }

  async createRoom(
    tabId: number,
    streamingServiceId: StreamingServiceId,
    playback: PlaybackUpdate,
  ): Promise<void> {
    await this.assertNoActiveSession();

    const settings = await getSettings();

    const response = await this.emitRoomCreate({
      memberId: await this.ensureMemberId(),
      memberName: settings.memberName,
      streamingServiceId,
      initialPlayback: playback,
    });

    await setControlledTab({ tabId, mediaId: playback.mediaId });
    await this.applyRoomResponse(response, true);
  }

  async joinRoom(roomCode: string): Promise<RoomResponse> {
    await this.assertNoActiveSession();
    const settings = await getSettings();

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: await this.ensureMemberId(),
      memberName: settings.memberName,
    });

    await this.applyRoomResponse(response);
    return response;
  }

  async leaveRoom(): Promise<void> {
    if ((await getBackgroundState()).session && this.connection) {
      try {
        await this.emitRoomLeave();
      } catch {
        // Best effort.
      }
    }

    this.closeConnection();
    await leaveRoomState();
  }

  private async sendPlaybackUpdate(update: PlaybackUpdate): Promise<void> {
    const state = await getBackgroundState();
    if (!state.session) {
      return;
    }

    const controlledMediaId = state.controlledTab?.mediaId ?? null;
    if (controlledMediaId !== null && controlledMediaId !== update.mediaId) {
      await setLastWarning('Local media no longer matches the active room.');
      return;
    }

    const snapshot = await this.emitPlaybackUpdate(update);
    await updateSessionRoom(snapshot);
  }

  private async ensureMemberId(): Promise<string> {
    return (
      (await getBackgroundState()).session?.memberId ??
      `${browser.runtime.id}:${crypto.randomUUID()}`
    );
  }

  private async assertNoActiveSession(): Promise<void> {
    if ((await getBackgroundState()).session) {
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
      void reportBackgroundError(getErrorMessage(error));
    });

    connection.onReconnect(() => this.rejoinRoom());

    connection.onRoomState((snapshot) => {
      void updateSessionRoom(snapshot);
    });

    connection.onPlaybackState((snapshot) => {
      void this.applyIncomingPlaybackSnapshot(snapshot);
    });

    connection.onRoomClosed((event) => {
      void this.handleRoomClosed(connection, event);
    });

    return connection;
  }

  private async rejoinRoom(): Promise<void> {
    const session = (await getBackgroundState()).session;
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
      await reportBackgroundError(getErrorMessage(error));
    }
  }

  private async handleRoomClosed(
    connection: RealtimeConnection,
    event: RoomClosedEvent,
  ): Promise<void> {
    if (this.connection !== connection) {
      return;
    }

    const session = (await getBackgroundState()).session;
    if (!session || session.roomCode !== event.roomCode) {
      return;
    }

    this.closeConnection();
    await leaveRoomState();
    await reportBackgroundError(roomClosedMessage(event.reason));
  }

  private async sendMediaSwitchUpdate(mediaId: string): Promise<void> {
    const state = await getBackgroundState();
    if (!state.session) {
      return;
    }

    if (state.room?.playback.mediaId === mediaId) {
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
    await setJoinedSession(nextSession, response.snapshot);

    if (applySnapshotToControlledTab) {
      this.options.onRoomSnapshotChanged();
    }
  }

  private async applyIncomingPlaybackSnapshot(snapshot: PartySnapshot): Promise<void> {
    await updateSessionRoom(snapshot);
    this.options.onRoomSnapshotChanged();
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

function roomClosedMessage(reason: RoomClosedReason): string {
  switch (reason) {
    case 'evicted':
      return 'The server is at capacity and this room was closed. Please create or join a new one.';
    case 'expired':
      return 'This room was closed due to inactivity.';
  }
}
