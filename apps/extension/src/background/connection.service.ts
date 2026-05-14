import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  RoomResponse,
  ServerToClientEvents,
} from '@open-watch-party/shared';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;

export class RealtimeConnection {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly reconnectHandlers = new Set<() => void | Promise<void>>();
  private readonly connectionErrorHandlers = new Set<(error: Error) => void>();

  constructor(readonly serverUrl: string) {
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      transports: ['websocket'],
      timeout: CONNECT_TIMEOUT_MS,
    });

    this.socket.io.on('reconnect', () => {
      for (const handler of this.reconnectHandlers) {
        void handler();
      }
    });

    this.socket.on('connect_error', (error) => {
      for (const handler of this.connectionErrorHandlers) {
        handler(error);
      }
    });
  }

  async createRoom(payload: CreateRoomRequest): Promise<OperationResult<RoomResponse>> {
    await this.waitForConnect();
    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:create', payload);
  }

  async joinRoom(payload: JoinRoomRequest): Promise<OperationResult<RoomResponse>> {
    await this.waitForConnect();
    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:join', payload);
  }

  async leaveRoom(): Promise<OperationResult<{ roomCode: string }>> {
    await this.waitForConnect();
    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:leave');
  }

  async updatePlayback(payload: PlaybackUpdate): Promise<OperationResult<PartySnapshot>> {
    await this.waitForConnect();
    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('playback:update', payload);
  }

  onRoomState(handler: ServerToClientEvents['room:state']): void {
    this.socket.on('room:state', handler);
  }

  onPlaybackState(handler: ServerToClientEvents['playback:state']): void {
    this.socket.on('playback:state', handler);
  }

  onRoomClosed(handler: ServerToClientEvents['room:closed']): void {
    this.socket.on('room:closed', handler);
  }

  onReconnect(handler: () => void | Promise<void>): void {
    this.reconnectHandlers.add(handler);
  }

  onConnectionError(handler: (error: Error) => void): void {
    this.connectionErrorHandlers.add(handler);
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  private waitForConnect(): Promise<void> {
    if (this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.socket.off('connect', handleConnect);
        this.socket.off('connect_error', handleConnectError);
      };
      const handleConnect = () => {
        cleanup();
        resolve();
      };
      const handleConnectError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.socket.once('connect', handleConnect);
      this.socket.once('connect_error', handleConnectError);
    });
  }
}
