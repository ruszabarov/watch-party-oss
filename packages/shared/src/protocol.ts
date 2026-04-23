import { z } from 'zod';

export const SUPPORTED_SERVICES = ['netflix', 'youtube'] as const;
export const MAX_MEMBER_NAME_LENGTH = 64;
export const MAX_TITLE_LENGTH = 256;

const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001F\u007F]+/g;

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

export interface PartySnapshot {
  roomCode: string;
  serviceId: ServiceId;
  watchUrl: string;
  members: PartyMember[];
  playback: PlaybackState;
  sequence: number;
  createdAt: number;
}

export type OperationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type Acknowledge<T> = (response: OperationResult<T>) => void;

export interface RoomResponse {
  memberId: string;
  snapshot: PartySnapshot;
}

export function sanitizeMemberName(value: string): string {
  return sanitizeText(value, MAX_MEMBER_NAME_LENGTH) || 'Guest';
}

export function sanitizeOptionalTitle(value: string | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }

  return sanitizeText(value, MAX_TITLE_LENGTH) || undefined;
}

const serviceIdSchema = z.enum(SUPPORTED_SERVICES);
const roomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().min(1));
const memberIdSchema = z.string().trim().min(1);
const mediaIdSchema = z.string().trim().min(1);
const finiteTimestampSchema = z.number().finite();
const positionSchema = z.number().finite().min(0);
const memberNameSchema = z.string().transform(sanitizeMemberName);
const titleSchema = z
  .string()
  .optional()
  .transform((value) => sanitizeOptionalTitle(value));

export const playbackStateInputSchema = z.object({
  serviceId: serviceIdSchema,
  mediaId: mediaIdSchema,
  title: titleSchema,
  playing: z.boolean(),
  positionSec: positionSchema,
});

export const playbackUpdateSchema = z.object({
  serviceId: serviceIdSchema,
  mediaId: mediaIdSchema,
  title: titleSchema,
  positionSec: positionSchema,
  playing: z.boolean(),
  issuedAt: finiteTimestampSchema,
});

export const createRoomRequestSchema = z.object({
  memberId: memberIdSchema,
  memberName: memberNameSchema,
  serviceId: serviceIdSchema,
  initialPlayback: playbackStateInputSchema,
});

export const joinRoomRequestSchema = z.object({
  roomCode: roomCodeSchema,
  memberId: memberIdSchema,
  memberName: memberNameSchema,
  serviceId: serviceIdSchema.optional(),
});

export const leaveRoomRequestSchema = z.object({
  roomCode: roomCodeSchema,
  memberId: memberIdSchema,
});

export const playbackUpdateRequestSchema = z.object({
  roomCode: roomCodeSchema,
  memberId: memberIdSchema,
  update: playbackUpdateSchema,
});

export type PlaybackStateInput = z.output<typeof playbackStateInputSchema>;
export type PlaybackUpdate = z.output<typeof playbackUpdateSchema>;
export type CreateRoomRequest = z.output<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.output<typeof joinRoomRequestSchema>;
export type LeaveRoomRequest = z.output<typeof leaveRoomRequestSchema>;
export type PlaybackUpdateRequest = z.output<typeof playbackUpdateRequestSchema>;

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
}

export interface ServerToClientEvents {
  'room:state': (snapshot: PartySnapshot) => void;
  'playback:state': (snapshot: PartySnapshot) => void;
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARACTERS_PATTERN, '').trim().slice(0, maxLength);
}
