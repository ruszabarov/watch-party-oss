import { createRoomCode, normalizeRoomCode, type RoomState } from '@open-watch-party/shared';
import { LRUCache } from 'lru-cache';

export interface RoomStore {
  get(roomCode: string): RoomState | undefined;
  set(room: RoomState): void;
  delete(roomCode: string): void;
  has(roomCode: string): boolean;
  size(): number;
  generateUniqueRoomCode(): string;
}

export type RoomStoreRemovalReason = LRUCache.DisposeReason;

export type InMemoryRoomStoreOptions = {
  maxRooms: number;
  roomIdleTtlMs: number;
  onRoomRemoved?: (room: RoomState, reason: RoomStoreRemovalReason) => void;
};

export function createInMemoryRoomStore(options: InMemoryRoomStoreOptions): RoomStore {
  const rooms = new LRUCache<string, RoomState>({
    max: options.maxRooms,
    ttl: options.roomIdleTtlMs,
    ttlAutopurge: true,
    perf: { now: Date.now },
    disposeAfter: (room, _roomCode, reason) => {
      options.onRoomRemoved?.(room, reason);
    },
  });

  return {
    get(roomCode: string): RoomState | undefined {
      return rooms.get(normalizeRoomCode(roomCode));
    },

    set(room: RoomState): void {
      const roomCode = normalizeRoomCode(room.roomCode);
      rooms.set(roomCode, room, {
        noDisposeOnSet: rooms.has(roomCode),
      });
    },

    delete(roomCode: string): void {
      rooms.delete(normalizeRoomCode(roomCode));
    },

    has(roomCode: string): boolean {
      return rooms.has(normalizeRoomCode(roomCode));
    },

    size(): number {
      return rooms.size;
    },

    generateUniqueRoomCode(): string {
      let roomCode = createRoomCode();

      while (rooms.has(roomCode)) {
        roomCode = createRoomCode();
      }

      return roomCode;
    },
  };
}
