import { z } from 'zod';
import { isServiceId, type ServiceId } from './services';
export type { ServiceId } from './services';

export const MAX_MEMBER_NAME_LENGTH = 64;
export const MAX_TITLE_LENGTH = 256;
export const MAX_PLAYBACK_POSITION_SEC = 48 * 60 * 60;

const CONTROL_CHARACTERS_PATTERN = /\p{Cc}+/gu;

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

export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type Acknowledge<T> = (response: OperationResult<T>) => void;

export interface RoomResponse {
  memberId: string;
  snapshot: PartySnapshot;
}

export function sanitizeMemberName(value: string): string {
  return sanitizeText(value, MAX_MEMBER_NAME_LENGTH) || 'Guest';
}

export function sanitizeOptionalTitle(value: string | undefined): string {
  if (value == null) {
    return '';
  }

  return sanitizeText(value, MAX_TITLE_LENGTH) || '';
}

const roomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().min(1));
const memberIdSchema = z.string().trim().min(1);
const mediaIdSchema = z.string().trim().min(1);
const serviceIdSchema = z.custom<ServiceId>(
  (value) => typeof value === 'string' && isServiceId(value),
  { message: 'Unsupported service id' },
);
const positionSchema = z.number().min(0).max(MAX_PLAYBACK_POSITION_SEC);
const memberNameSchema = z.string().transform(sanitizeMemberName);
const titleSchema = z
  .string()
  .optional()
  .transform((value) => sanitizeOptionalTitle(value));

export const playbackDraftSchema = z.object({
  serviceId: serviceIdSchema,
  mediaId: mediaIdSchema,
  title: titleSchema,
  positionSec: positionSchema,
  playing: z.boolean(),
});

export const playbackStateInputSchema = playbackDraftSchema;

export const playbackUpdateSchema = playbackDraftSchema.extend({
  clientSequence: z.number().int().min(0),
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

export const leaveRoomRequestSchema = z.object({}).strict();

export const playbackUpdateRequestSchema = z
  .object({
    update: playbackUpdateSchema,
  })
  .strict();

export type PlaybackStateInput = z.output<typeof playbackStateInputSchema>;
export type PlaybackUpdate = z.output<typeof playbackUpdateSchema>;
export type PlaybackUpdateDraft = z.output<typeof playbackDraftSchema>;
export type CreateRoomRequest = z.output<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.output<typeof joinRoomRequestSchema>;
export type LeaveRoomRequest = z.output<typeof leaveRoomRequestSchema>;
export type PlaybackUpdateRequest = z.output<typeof playbackUpdateRequestSchema>;

export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomRequest, acknowledge: Acknowledge<RoomResponse>) => void;
  'room:join': (payload: JoinRoomRequest, acknowledge: Acknowledge<RoomResponse>) => void;
  'room:leave': (payload: LeaveRoomRequest, acknowledge: Acknowledge<{ roomCode: string }>) => void;
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
