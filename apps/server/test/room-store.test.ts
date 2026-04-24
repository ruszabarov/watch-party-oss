import { describe, expect, it, vi } from 'vitest';
import * as shared from '@open-watch-party/shared';

import { RoomStoreCapacityError, createInMemoryRoomStore } from '../src/room-store';

function createRoom(roomCode: string, now = 1_000) {
  return shared.createRoomState(
    roomCode,
    {
      memberId: 'member-a',
      memberName: 'Member A',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'abc123',
        title: 'Clip',
        playing: true,
        positionSec: 5,
      },
    },
    now,
  );
}

describe('in-memory room store', () => {
  it('normalizes room lookups and deletes', () => {
    const store = createInMemoryRoomStore({ maxRooms: 2 });
    const room = createRoom('ROOM01');

    store.set({ room, lastActivity: 1_000 });

    expect(store.get(' room01 ')?.room.roomCode).toBe('ROOM01');
    expect(store.has('room01')).toBe(true);

    store.delete(' room01 ');

    expect(store.get('ROOM01')).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('enforces the maximum room count for new rooms', () => {
    const store = createInMemoryRoomStore({ maxRooms: 1 });
    store.set({ room: createRoom('ROOM01'), lastActivity: 1_000 });

    expect(() => {
      store.set({ room: createRoom('ROOM02'), lastActivity: 2_000 });
    }).toThrowError(new RoomStoreCapacityError(1));
  });

  it('lists rooms older than the idle cutoff', () => {
    const store = createInMemoryRoomStore({ maxRooms: 3 });
    store.set({ room: createRoom('ROOM01'), lastActivity: 1_000 });
    store.set({ room: createRoom('ROOM02'), lastActivity: 4_000 });

    expect(store.listIdle(3_000).map((record) => record.room.roomCode)).toEqual(['ROOM01']);
  });

  it('generates a unique room code when collisions occur', () => {
    const store = createInMemoryRoomStore({ maxRooms: 3 });
    store.set({ room: createRoom('ROOM01'), lastActivity: 1_000 });

    const createRoomCodeSpy = vi
      .spyOn(shared, 'createRoomCode')
      .mockReturnValueOnce('ROOM01')
      .mockReturnValueOnce('ROOM02');

    expect(store.generateUniqueRoomCode()).toBe('ROOM02');

    createRoomCodeSpy.mockRestore();
  });
});
