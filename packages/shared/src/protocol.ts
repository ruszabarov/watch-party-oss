export const SUPPORTED_SERVICES = ['netflix', 'youtube'] as const;

export type ServiceId = (typeof SUPPORTED_SERVICES)[number];
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface PartyMember {
  id: string;
  name: string;
  joinedAt: number;
}

export interface PlaybackState {
  serviceId: ServiceId;
  mediaId: string;
  title?: string;
  playing: boolean;
  positionSec: number;
  updatedAt: number;
  sourceMemberId: string;
  sequence: number;
}

export interface PlaybackUpdate {
  serviceId: ServiceId;
  mediaId: string;
  title?: string;
  positionSec: number;
  playing: boolean;
  issuedAt: number;
}

export interface PartySnapshot {
  roomCode: string;
  serviceId: ServiceId;
  members: PartyMember[];
  playback: PlaybackState;
  sequence: number;
  createdAt: number;
}

export interface PresenceUpdate {
  roomCode: string;
  memberId: string;
  mediaId?: string;
  playbackReady: boolean;
}

export interface ServerError {
  code:
    | 'INVALID_ROOM'
    | 'ROOM_NOT_FOUND'
    | 'SERVICE_MISMATCH'
    | 'NOT_IN_ROOM'
    | 'INVALID_COMMAND';
  message: string;
}

export type OperationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type Acknowledge<T> = (response: OperationResult<T>) => void;

export interface CreateRoomRequest {
  memberId: string;
  memberName: string;
  serviceId: ServiceId;
  initialPlayback: Omit<PlaybackState, 'sequence' | 'updatedAt' | 'sourceMemberId'>;
}

export interface JoinRoomRequest {
  roomCode: string;
  memberId: string;
  memberName: string;
  serviceId: ServiceId;
}

export interface LeaveRoomRequest {
  roomCode: string;
  memberId: string;
}

export interface PlaybackUpdateRequest {
  roomCode: string;
  memberId: string;
  update: PlaybackUpdate;
}

export interface PingRequest {
  roomCode?: string;
  memberId?: string;
}

export interface RoomResponse {
  memberId: string;
  snapshot: PartySnapshot;
}

export interface ClientToServerEvents {
  'room:create': (
    payload: CreateRoomRequest,
    acknowledge: Acknowledge<RoomResponse>,
  ) => void;
  'room:join': (
    payload: JoinRoomRequest,
    acknowledge: Acknowledge<RoomResponse>,
  ) => void;
  'room:leave': (
    payload: LeaveRoomRequest,
    acknowledge: Acknowledge<{ roomCode: string }>,
  ) => void;
  'playback:update': (
    payload: PlaybackUpdateRequest,
    acknowledge: Acknowledge<PartySnapshot>,
  ) => void;
  'presence:update': (payload: PresenceUpdate) => void;
  ping: (payload: PingRequest, acknowledge: Acknowledge<{ pong: true }>) => void;
}

export interface ServerToClientEvents {
  'room:state': (snapshot: PartySnapshot) => void;
  'playback:state': (snapshot: PartySnapshot) => void;
  'presence:state': (snapshot: PartySnapshot) => void;
  'server:error': (error: ServerError) => void;
}
