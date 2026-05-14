import type {
  CreateRoomRequest,
  PartyMember,
  PartySnapshot,
  PlaybackState,
  PlaybackUpdate,
  StreamingServiceId,
} from './protocol';
import {
  sanitizeMemberName,
  sanitizeOptionalTitle,
  MAX_PLAYBACK_POSITION_SEC as maxPlaybackPositionSec,
} from './protocol';
import { STREAMING_SERVICE_DEFINITION_BY_ID } from './streaming-services';

export interface RoomState {
  readonly roomCode: string;
  readonly streamingServiceId: StreamingServiceId;
  members: Map<string, PartyMember>;
  playback: PlaybackState;
  createdAt: number;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

export function createRoomCode(): string {
  const values = new Uint32Array(ROOM_CODE_LENGTH);
  globalThis.crypto.getRandomValues(values);

  return Array.from(values, (value) => {
    const index = value % ROOM_CODE_ALPHABET.length;
    return ROOM_CODE_ALPHABET[index] ?? ROOM_CODE_ALPHABET[0];
  }).join('');
}

export function createRoomState(
  roomCode: string,
  request: CreateRoomRequest,
  now = Date.now(),
): RoomState {
  assertValidMediaId(request.streamingServiceId, request.initialPlayback.mediaId);

  const playback: PlaybackState = {
    ...request.initialPlayback,
    streamingServiceId: request.streamingServiceId,
    title: sanitizeOptionalTitle(request.initialPlayback.title),
    updatedAt: now,
    sourceMemberId: request.memberId,
  };

  return {
    roomCode,
    streamingServiceId: request.streamingServiceId,
    members: new Map<string, PartyMember>(),
    playback,
    createdAt: now,
  };
}

export function upsertRoomMember(
  room: RoomState,
  memberId: string,
  memberName: string,
  now = Date.now(),
): PartyMember {
  const existing = room.members.get(memberId);
  const nextMember: PartyMember = {
    id: memberId,
    name: sanitizeMemberName(memberName),
    joinedAt: existing?.joinedAt ?? now,
  };

  room.members.set(memberId, nextMember);
  return nextMember;
}

export function removeRoomMember(room: RoomState, memberId: string): boolean {
  return room.members.delete(memberId);
}

export function applyPlaybackUpdate(
  room: RoomState,
  update: PlaybackUpdate,
  memberId: string,
  now = Date.now(),
): PlaybackState {
  assertValidMediaId(room.streamingServiceId, update.mediaId);

  const playback: PlaybackState = {
    streamingServiceId: room.streamingServiceId,
    mediaId: update.mediaId,
    playing: update.playing,
    positionSec: normalizePosition(update.positionSec),
    updatedAt: now,
    sourceMemberId: memberId,
  };

  if (update.title !== undefined) {
    playback.title = sanitizeOptionalTitle(update.title);
  }

  room.playback = playback;
  return playback;
}

export function resolvePlaybackState(playback: PlaybackState, now = Date.now()): PlaybackState {
  if (!playback.playing) {
    return playback;
  }

  const elapsedSec = Math.max(0, (now - playback.updatedAt) / 1000);
  return {
    ...playback,
    positionSec: normalizePosition(playback.positionSec + elapsedSec),
  };
}

export function toPartySnapshot(room: RoomState, now = Date.now()): PartySnapshot {
  const watchUrl = STREAMING_SERVICE_DEFINITION_BY_ID[
    room.streamingServiceId
  ].buildCanonicalWatchUrl(room.playback.mediaId);

  return {
    roomCode: room.roomCode,
    streamingServiceId: room.streamingServiceId,
    watchUrl,
    members: [...room.members.values()].toSorted((left, right) => {
      return left.joinedAt - right.joinedAt;
    }),
    playback: resolvePlaybackState(room.playback, now),
    createdAt: room.createdAt,
  };
}

function normalizePosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(maxPlaybackPositionSec, Math.max(0, Number(value.toFixed(3))));
}

function assertValidMediaId(streamingServiceId: StreamingServiceId, mediaId: string): void {
  if (!STREAMING_SERVICE_DEFINITION_BY_ID[streamingServiceId].isMediaIdValid(mediaId)) {
    throw new Error('Invalid media id for streaming service.');
  }
}
