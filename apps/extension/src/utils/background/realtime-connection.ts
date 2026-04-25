import { io, type Socket } from 'socket.io-client';
import { match, P } from 'ts-pattern';
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

import { createLogger, elapsedMs, getLogError } from '../logger';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
const log = createLogger('background:realtime');

type RequestArgs =
  | [event: 'room:create', payload: CreateRoomRequest]
  | [event: 'room:join', payload: JoinRoomRequest]
  | [event: 'room:leave', payload: LeaveRoomRequest]
  | [event: 'playback:update', payload: PlaybackUpdateRequest];

type RequestResult =
  | OperationResult<RoomResponse>
  | OperationResult<{ roomCode: string }>
  | OperationResult<PartySnapshot>;

export class RealtimeConnection {
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
    log.info({ serverUrl }, 'realtime:connect_started');

    this.socket.on('connect', () => {
      const isReconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.setStatus('connected');
      log.info({ serverUrl, socketId: this.socket.id, isReconnect }, 'realtime:connected');

      if (isReconnect) {
        for (const handler of this.reconnectHandlers) {
          void handler();
        }
      }
    });

    this.socket.on('disconnect', () => {
      log.info(
        { serverUrl, socketId: this.socket.id, manuallyDisconnected: this.manuallyDisconnected },
        'realtime:disconnected',
      );
      this.setStatus(this.manuallyDisconnected ? 'disconnected' : 'reconnecting');
    });

    this.socket.on('connect_error', (error) => {
      log.warn({ serverUrl, error: getLogError(error) }, 'realtime:connect_error');
      this.setStatus('error', error.message);
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
  async request(...args: RequestArgs): Promise<RequestResult> {
    await this.waitForConnect();
    const startedAt = performance.now();
    const [event] = args;

    try {
      const response = await this.dispatchRequest(args);
      log.debug({ event, ok: response.ok, durationMs: elapsedMs(startedAt) }, 'realtime:ack');
      return response;
    } catch (error) {
      log.warn(
        { event, durationMs: elapsedMs(startedAt), error: getLogError(error) },
        'realtime:ack_failed',
      );
      throw error;
    }
  }

  on(event: 'room:state', handler: ServerToClientEvents['room:state']): () => void;
  on(event: 'playback:state', handler: ServerToClientEvents['playback:state']): () => void;
  on(event: keyof ServerToClientEvents, handler: (snapshot: PartySnapshot) => void): () => void {
    const loggedHandler = (snapshot: PartySnapshot) => {
      log.debug(
        { event, roomCode: snapshot.roomCode, sequence: snapshot.sequence },
        'realtime:event_received',
      );
      handler(snapshot);
    };
    this.socket.on(event, loggedHandler);
    return () => {
      this.socket.off(event, loggedHandler);
    };
  }

  onReconnect(handler: () => void | Promise<void>): () => void {
    this.reconnectHandlers.add(handler);
    return () => {
      this.reconnectHandlers.delete(handler);
    };
  }

  onStatusChange(handler: (status: ConnectionStatus, errorMessage?: string) => void): () => void {
    handler(this.currentStatus, this.currentErrorMessage);
    this.statusChangeHandlers.add(handler);
    return () => {
      this.statusChangeHandlers.delete(handler);
    };
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    log.info({ serverUrl: this.serverUrl }, 'realtime:disconnect_requested');
    this.socket.disconnect();
  }

  private dispatchRequest(args: RequestArgs): Promise<RequestResult> {
    return match(args)
      .returnType<Promise<RequestResult>>()
      .with(['room:create', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:create', p),
      )
      .with(['room:join', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:join', p),
      )
      .with(['room:leave', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:leave', p),
      )
      .with(['playback:update', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('playback:update', p),
      )
      .exhaustive();
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
        log.trace({ serverUrl: this.serverUrl }, 'realtime:wait_for_connect_ok');
        resolve();
      };
      const handleConnectError = (error: Error) => {
        cleanup();
        log.warn(
          { serverUrl: this.serverUrl, error: getLogError(error) },
          'realtime:wait_for_connect_failed',
        );
        reject(error);
      };
      const timeoutId = setTimeout(() => {
        cleanup();
        log.warn({ serverUrl: this.serverUrl }, 'realtime:wait_for_connect_timeout');
        reject(new Error('Timed out connecting to the realtime server.'));
      }, CONNECT_TIMEOUT_MS);

      this.socket.once('connect', handleConnect);
      this.socket.once('connect_error', handleConnectError);
    });
  }

  private setStatus(status: ConnectionStatus, errorMessage?: string): void {
    this.currentStatus = status;
    this.currentErrorMessage = errorMessage;
    for (const handler of this.statusChangeHandlers) {
      handler(status, errorMessage);
    }
  }
}
