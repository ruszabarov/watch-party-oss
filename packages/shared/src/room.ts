import type {
  CreateRoomRequest,
  PartyMember,
  PartySnapshot,
  PlaybackState,
  PlaybackUpdate,
  ServiceId,
} from './protocol';

export interface RoomState {
  roomCode: string;
  serviceId: ServiceId;
  watchUrl: string;
  members: Map<string, PartyMember>;
  playback: PlaybackState;
  sequence: number;
  createdAt: number;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

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
  const sequence = 1;
  const playback: PlaybackState = {
    ...request.initialPlayback,
    updatedAt: now,
    sourceMemberId: request.memberId,
    sequence,
  };

  return {
    roomCode,
    serviceId: request.serviceId,
    watchUrl: request.watchUrl,
    members: new Map<string, PartyMember>(),
    playback,
    sequence,
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
    name: memberName.trim() || 'Guest',
    joinedAt: existing?.joinedAt ?? now,
  };

  room.members.set(memberId, nextMember);
  return nextMember;
}

export function removeRoomMember(room: RoomState, memberId: string): boolean {
  return room.members.delete(memberId);
}

export function roomHasMember(room: RoomState, memberId: string): boolean {
  return room.members.has(memberId);
}

export function applyPlaybackUpdate(
  room: RoomState,
  update: PlaybackUpdate,
  memberId: string,
  now = Date.now(),
): PlaybackState {
  room.sequence += 1;
  const playback: PlaybackState = {
    serviceId: update.serviceId,
    mediaId: update.mediaId,
    playing: update.playing,
    positionSec: normalizePosition(update.positionSec),
    updatedAt: now,
    sourceMemberId: memberId,
    sequence: room.sequence,
  };

  if (update.title !== undefined) {
    playback.title = update.title;
  }

  room.playback = playback;
  return playback;
}

export function resolvePlaybackState(
  playback: PlaybackState,
  now = Date.now(),
): PlaybackState {
  if (!playback.playing) {
    return playback;
  }

  const elapsedSec = Math.max(0, (now - playback.updatedAt) / 1000);
  return {
    ...playback,
    positionSec: normalizePosition(playback.positionSec + elapsedSec),
  };
}

export function toPartySnapshot(
  room: RoomState,
  now = Date.now(),
): PartySnapshot {
  return {
    roomCode: room.roomCode,
    serviceId: room.serviceId,
    watchUrl: room.watchUrl,
    members: [...room.members.values()].sort((left, right) => {
      return left.joinedAt - right.joinedAt;
    }),
    playback: resolvePlaybackState(room.playback, now),
    sequence: room.sequence,
    createdAt: room.createdAt,
  };
}

function normalizePosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Number(value.toFixed(3)));
}
