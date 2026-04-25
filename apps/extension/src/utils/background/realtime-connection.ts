import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ConnectionStatus,
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdateRequest,
  RoomResponse,
  ServerToClientEvents,
} from '@open-watch-party/shared';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;

export interface RealtimeConnection {
  readonly serverUrl: string;
  request(event: 'room:create', payload: CreateRoomRequest): Promise<OperationResult<RoomResponse>>;
  request(event: 'room:join', payload: JoinRoomRequest): Promise<OperationResult<RoomResponse>>;
  request(
    event: 'room:leave',
    payload: LeaveRoomRequest,
  ): Promise<OperationResult<{ roomCode: string }>>;
  request(
    event: 'playback:update',
    payload: PlaybackUpdateRequest,
  ): Promise<OperationResult<PartySnapshot>>;
  on(event: 'room:state', handler: ServerToClientEvents['room:state']): () => void;
  on(event: 'playback:state', handler: ServerToClientEvents['playback:state']): () => void;
  onReconnect(handler: () => void | Promise<void>): () => void;
  onStatusChange(handler: (status: ConnectionStatus, errorMessage?: string) => void): () => void;
  disconnect(): void;
}

export function createRealtimeConnection(serverUrl: string): RealtimeConnection {
  return new SocketIoRealtimeConnection(serverUrl);
}

class SocketIoRealtimeConnection implements RealtimeConnection {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly reconnectHandlers = new Set<() => void | Promise<void>>();
  private readonly statusChangeHandlers = new Set<
    (status: ConnectionStatus, errorMessage?: string) => void
  >();
  private currentStatus: ConnectionStatus = 'connecting';
  private currentErrorMessage: string | undefined;
  private hasConnectedBefore = false;
  private manuallyDisconnected = false;

  constructor(readonly serverUrl: string) {
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      const isReconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.emitStatusChange('connected');

      if (isReconnect) {
        for (const handler of this.reconnectHandlers) {
          void handler();
        }
      }
    });

    this.socket.on('disconnect', () => {
      this.emitStatusChange(this.manuallyDisconnected ? 'disconnected' : 'reconnecting');
    });

    this.socket.on('connect_error', (error) => {
      this.emitStatusChange('error', error.message);
    });
  }

  async request(
    event: 'room:create',
    payload: CreateRoomRequest,
  ): Promise<OperationResult<RoomResponse>>;
  async request(
    event: 'room:join',
    payload: JoinRoomRequest,
  ): Promise<OperationResult<RoomResponse>>;
  async request(
    event: 'room:leave',
    payload: LeaveRoomRequest,
  ): Promise<OperationResult<{ roomCode: string }>>;
  async request(
    event: 'playback:update',
    payload: PlaybackUpdateRequest,
  ): Promise<OperationResult<PartySnapshot>>;
  async request(
    ...args: RealtimeRequestArgs
  ): Promise<
    | OperationResult<RoomResponse>
    | OperationResult<{ roomCode: string }>
    | OperationResult<PartySnapshot>
  > {
    await this.waitForConnect();

    if (args[0] === 'room:create') {
      return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(args[0], args[1]);
    }
    if (args[0] === 'room:join') {
      return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(args[0], args[1]);
    }
    if (args[0] === 'room:leave') {
      return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(args[0], args[1]);
    }

    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(args[0], args[1]);
  }

  on(event: 'room:state', handler: ServerToClientEvents['room:state']): () => void;
  on(event: 'playback:state', handler: ServerToClientEvents['playback:state']): () => void;
  on(
    event: 'room:state' | 'playback:state',
    handler: (snapshot: PartySnapshot) => void,
  ): () => void {
    this.socket.on(event, handler);
    return () => {
      this.socket.off(event, handler);
    };
  }

  onReconnect(handler: () => void | Promise<void>): () => void {
    this.reconnectHandlers.add(handler);
    return () => {
      this.reconnectHandlers.delete(handler);
    };
  }

  onStatusChange(handler: (status: ConnectionStatus, errorMessage?: string) => void): () => void {
    this.statusChangeHandlers.add(handler);
    handler(this.currentStatus, this.currentErrorMessage);
    return () => {
      this.statusChangeHandlers.delete(handler);
    };
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.socket.disconnect();
  }

  private waitForConnect(): Promise<void> {
    if (this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutId);
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
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out connecting to the realtime server.'));
      }, CONNECT_TIMEOUT_MS);

      this.socket.once('connect', handleConnect);
      this.socket.once('connect_error', handleConnectError);
    });
  }

  private emitStatusChange(status: ConnectionStatus, errorMessage?: string): void {
    this.currentStatus = status;
    this.currentErrorMessage = errorMessage;
    for (const handler of this.statusChangeHandlers) {
      handler(status, errorMessage);
    }
  }
}

type RealtimeRequestArgs =
  | [event: 'room:create', payload: CreateRoomRequest]
  | [event: 'room:join', payload: JoinRoomRequest]
  | [event: 'room:leave', payload: LeaveRoomRequest]
  | [event: 'playback:update', payload: PlaybackUpdateRequest];
