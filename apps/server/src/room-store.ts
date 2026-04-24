import { createRoomCode, normalizeRoomCode, type RoomState } from '@open-watch-party/shared';

export type RoomRecord = {
  room: RoomState;
  lastActivity: number;
};

export interface RoomStore {
  get(roomCode: string): RoomRecord | undefined;
  set(record: RoomRecord): void;
  delete(roomCode: string): void;
  has(roomCode: string): boolean;
  size(): number;
  listIdle(beforeTimestamp: number): RoomRecord[];
  generateUniqueRoomCode(): string;
}

export class RoomStoreCapacityError extends Error {
  constructor(readonly maxRooms: number) {
    super(`Room limit reached (${maxRooms}). Please try again later.`);
  }
}

export type InMemoryRoomStoreOptions = {
  maxRooms: number;
};

export function createInMemoryRoomStore(options: InMemoryRoomStoreOptions): RoomStore {
  const rooms = new Map<string, RoomRecord>();

  return {
    get(roomCode: string): RoomRecord | undefined {
      return rooms.get(normalizeRoomCode(roomCode));
    },

    set(record: RoomRecord): void {
      const roomCode = normalizeRoomCode(record.room.roomCode);
      if (!rooms.has(roomCode) && rooms.size >= options.maxRooms) {
        throw new RoomStoreCapacityError(options.maxRooms);
      }

      rooms.set(roomCode, record);
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

    listIdle(beforeTimestamp: number): RoomRecord[] {
      return [...rooms.values()].filter((record) => record.lastActivity < beforeTimestamp);
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
