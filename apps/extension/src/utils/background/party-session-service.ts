import { browser } from 'wxt/browser';
import { io, type Socket } from 'socket.io-client';
import {
  createRoomRequestSchema,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  normalizeRoomCode,
  playbackUpdateRequestSchema,
} from '@open-watch-party/shared';

import type {
  ClientToServerEvents,
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  PlaybackUpdateDraft,
  RoomResponse,
  ServerToClientEvents,
} from '@open-watch-party/shared';

import { getErrorMessage } from '../errors';
import { emitStateChanged } from './notifier';
import type { InternalState } from './state';
import { normalizeServerUrl } from './state';
import type { SettingsStore } from './settings-store';
import type { TabSyncService } from './tab-sync-service';

export class PartySessionService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  private currentSocketUrl: string | null = null;

  constructor(
    private readonly state: InternalState,
    private readonly settingsStore: SettingsStore,
    private readonly tabSync: TabSyncService,
  ) {}

  async connectForStoredSession(): Promise<void> {
    if (!this.state.session) {
      return;
    }

    try {
      await this.ensureSocket();
      const response = await this.emitRoomJoin({
        roomCode: this.state.session.roomCode,
        memberId: this.state.session.memberId,
        memberName: this.state.settings.memberName,
        serviceId: this.state.session.serviceId,
      });

      await this.applyRoomResponse(response);
    } catch (error) {
      this.state.room = null;
      this.state.roomMemberId = null;
      this.state.session = null;
      this.state.lastError = getErrorMessage(error);
      this.state.connectionStatus = 'error';
      await this.settingsStore.persist();
      emitStateChanged(this.state);
    }
  }

  async createRoom(): Promise<void> {
    await this.tabSync.refreshActiveTab(false);
    const { context } = this.tabSync.requireControllableWatchTab();

    const response = await this.emitRoomCreate({
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
      serviceId: context.serviceId,
      initialPlayback: {
        serviceId: context.serviceId,
        mediaId: context.mediaId,
        title: context.mediaTitle,
        playing: context.playing,
        positionSec: context.positionSec,
      },
    });

    this.state.controlledTabId = this.state.activeTab.tabId;
    await this.applyRoomResponse(response);
    await this.tabSync.applySnapshotToControlledTab();
  }

  async joinRoom(roomCode: string): Promise<void> {
    await this.tabSync.refreshActiveTab(false);
    const tabId = this.state.activeTab.tabId;
    if (tabId == null) {
      throw new Error('Open a browser tab before joining a room.');
    }

    const response = await this.emitRoomJoin({
      roomCode: normalizeRoomCode(roomCode),
      memberId: this.ensureMemberId(),
      memberName: this.state.settings.memberName,
    });

    this.state.controlledTabId = tabId;
    await this.applyRoomResponse(response);

    try {
      await this.tabSync.navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
    } catch (error) {
      await this.leaveRoom();
      throw error;
    }
  }

  async leaveRoom(): Promise<void> {
    if (this.state.session && this.socket) {
      try {
        await this.emitRoomLeave();
      } catch {
        // Best effort.
      }
    }

    this.state.room = null;
    this.state.roomMemberId = null;
    this.state.session = null;
    this.socket?.disconnect();
    this.socket = null;
    this.currentSocketUrl = null;
    this.state.connectionStatus = 'disconnected';
    this.state.lastError = null;
    this.state.lastWarning = null;
    await this.settingsStore.persist();
    emitStateChanged(this.state);
  }

  async sendPlaybackUpdate(update: PlaybackUpdateDraft, isLocalRelay = false): Promise<void> {
    const session = this.state.session;
    if (!session) {
      if (isLocalRelay) return;
      throw new Error('Join or create a room first.');
    }

    const playbackContext = this.tabSync.getControlledTabContext();
    if (playbackContext?.mediaId && playbackContext.mediaId !== update.mediaId) {
      this.state.lastWarning = 'Local title no longer matches the active room.';
      emitStateChanged(this.state);
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

  private async ensureSocket(): Promise<void> {
    const serverUrl = normalizeServerUrl(this.state.settings.serverUrl);

    if (this.socket && this.socket.connected && this.currentSocketUrl === serverUrl) {
      return;
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.state.connectionStatus = 'connecting';
    emitStateChanged(this.state);

    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      transports: ['websocket'],
    });
    this.currentSocketUrl = serverUrl;
    let hasConnectedBefore = false;

    this.socket.on('connect', async () => {
      const isReconnect = hasConnectedBefore;
      hasConnectedBefore = true;
      this.state.connectionStatus = 'connected';
      this.state.lastError = null;

      if (isReconnect && this.state.session) {
        try {
          const response = await this.emitRoomJoin({
            roomCode: this.state.session.roomCode,
            memberId: this.state.session.memberId,
            memberName: this.state.settings.memberName,
            serviceId: this.state.session.serviceId,
          });

          await this.applyRoomResponse(response);
          await this.tabSync.applySnapshotToControlledTab();
        } catch (error) {
          this.state.lastError = getErrorMessage(error);
          this.state.connectionStatus = 'error';
        }
      }

      emitStateChanged(this.state);
    });

    this.socket.on('disconnect', () => {
      this.state.connectionStatus = this.state.session ? 'reconnecting' : 'disconnected';
      emitStateChanged(this.state);
    });

    this.socket.on('connect_error', (error) => {
      this.state.connectionStatus = 'error';
      this.state.lastError = error.message;
      emitStateChanged(this.state);
    });

    this.socket.on('room:state', async (snapshot) => {
      this.state.room = snapshot;
      this.state.lastWarning = null;
      emitStateChanged(this.state);
    });

    this.socket.on('playback:state', async (snapshot) => {
      this.state.room = snapshot;
      this.state.lastWarning = null;
      await this.tabSync.applySnapshotToControlledTab();
      emitStateChanged(this.state);
    });

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timed out connecting to the realtime server.'));
      }, 5_000);

      this.socket?.once('connect', () => {
        clearTimeout(timeoutId);
        resolve();
      });

      this.socket?.once('connect_error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  private async applyRoomResponse(response: RoomResponse): Promise<void> {
    const currentSession = this.state.session;
    this.state.room = response.snapshot;
    this.state.roomMemberId = response.memberId;
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
    emitStateChanged(this.state);
  }

  private async emitRoomCreate(payload: CreateRoomRequest): Promise<RoomResponse> {
    await this.ensureSocket();
    const activeSocket = this.socket;
    if (!activeSocket) {
      throw new Error('Realtime connection unavailable.');
    }
    const response = await activeSocket
      .timeout(5_000)
      .emitWithAck('room:create', this.validateOutboundPayload(createRoomRequestSchema, payload));
    return this.unwrapAckResponse(response);
  }

  private async emitRoomJoin(payload: JoinRoomRequest): Promise<RoomResponse> {
    await this.ensureSocket();
    const activeSocket = this.socket;
    if (!activeSocket) {
      throw new Error('Realtime connection unavailable.');
    }
    const response = await activeSocket
      .timeout(5_000)
      .emitWithAck('room:join', this.validateOutboundPayload(joinRoomRequestSchema, payload));
    return this.unwrapAckResponse(response);
  }

  private async emitRoomLeave(): Promise<{ roomCode: string }> {
    await this.ensureSocket();
    const activeSocket = this.socket;
    if (!activeSocket) {
      throw new Error('Realtime connection unavailable.');
    }
    const response = await activeSocket
      .timeout(5_000)
      .emitWithAck('room:leave', this.validateOutboundPayload(leaveRoomRequestSchema, {}));
    return this.unwrapAckResponse(response);
  }

  private async emitPlaybackUpdate(update: PlaybackUpdate): Promise<PartySnapshot> {
    await this.ensureSocket();
    const activeSocket = this.socket;
    if (!activeSocket) {
      throw new Error('Realtime connection unavailable.');
    }
    const response = await activeSocket
      .timeout(5_000)
      .emitWithAck(
        'playback:update',
        this.validateOutboundPayload(playbackUpdateRequestSchema, { update }),
      );
    return this.unwrapAckResponse(response);
  }

  private applyPlaybackSnapshot(snapshot: PartySnapshot): void {
    this.state.room = snapshot;
    this.state.lastWarning = null;
    emitStateChanged(this.state);
  }

  private async incrementPlaybackClientSequence(
    session: NonNullable<InternalState['session']>,
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
