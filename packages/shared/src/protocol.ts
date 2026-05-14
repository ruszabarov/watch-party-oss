import { z } from 'zod';
import { isStreamingServiceId, type StreamingServiceId } from './streaming-services';
export type { StreamingServiceId } from './streaming-services';

export const MAX_MEMBER_NAME_LENGTH = 64;
export const MAX_TITLE_LENGTH = 256;
export const MAX_PLAYBACK_POSITION_SEC = 48 * 60 * 60;

const CONTROL_CHARACTERS_PATTERN = /\p{Cc}+/gu;

export interface PartyMember {
  id: string;
  name: string;
  joinedAt: number;
}

export interface PlaybackState {
  streamingServiceId: StreamingServiceId;
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
  streamingServiceId: StreamingServiceId;
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
const streamingServiceIdSchema = z.custom<StreamingServiceId>(
  (value) => typeof value === 'string' && isStreamingServiceId(value),
  { message: 'Unsupported streaming service id' },
);
const positionSchema = z.number().min(0).max(MAX_PLAYBACK_POSITION_SEC);
const memberNameSchema = z.string().transform(sanitizeMemberName);
const titleSchema = z
  .string()
  .optional()
  .transform((value) => sanitizeOptionalTitle(value));

export const playbackDraftSchema = z.object({
  mediaId: mediaIdSchema,
  title: titleSchema,
  positionSec: positionSchema,
  playing: z.boolean(),
});

export const playbackStateInputSchema = playbackDraftSchema;

export const createRoomRequestSchema = z.object({
  memberId: memberIdSchema,
  memberName: memberNameSchema,
  streamingServiceId: streamingServiceIdSchema,
  initialPlayback: playbackStateInputSchema,
});

export const joinRoomRequestSchema = z.object({
  roomCode: roomCodeSchema,
  memberId: memberIdSchema,
  memberName: memberNameSchema,
});

export const playbackUpdateRequestSchema = playbackDraftSchema.strict();

export type PlaybackStateInput = z.output<typeof playbackStateInputSchema>;
export type PlaybackUpdate = z.output<typeof playbackUpdateRequestSchema>;
export type CreateRoomRequest = z.output<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.output<typeof joinRoomRequestSchema>;

export type RoomClosedReason = 'evicted' | 'expired';

export interface RoomClosedEvent {
  roomCode: string;
  reason: RoomClosedReason;
}

export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomRequest, acknowledge: Acknowledge<RoomResponse>) => void;
  'room:join': (payload: JoinRoomRequest, acknowledge: Acknowledge<RoomResponse>) => void;
  'room:leave': (acknowledge: Acknowledge<{ roomCode: string }>) => void;
  'playback:update': (payload: PlaybackUpdate, acknowledge: Acknowledge<PartySnapshot>) => void;
}

export interface ServerToClientEvents {
  'room:state': (snapshot: PartySnapshot) => void;
  'playback:state': (snapshot: PartySnapshot) => void;
  'room:closed': (event: RoomClosedEvent) => void;
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARACTERS_PATTERN, '').trim().slice(0, maxLength);
}
