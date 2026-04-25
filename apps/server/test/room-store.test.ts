import { afterEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@open-watch-party/shared';

import { createInMemoryRoomStore } from '../src/room-store';

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

function createStore(options: {
  maxRooms: number;
  roomIdleTtlMs?: number;
  onRoomRemoved?: Parameters<typeof createInMemoryRoomStore>[0]['onRoomRemoved'];
}) {
  const storeOptions: Parameters<typeof createInMemoryRoomStore>[0] = {
    maxRooms: options.maxRooms,
    roomIdleTtlMs: options.roomIdleTtlMs ?? 60_000,
  };

  if (options.onRoomRemoved) {
    storeOptions.onRoomRemoved = options.onRoomRemoved;
  }

  return createInMemoryRoomStore(storeOptions);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('in-memory room store', () => {
  it('normalizes room lookups and deletes', () => {
    const store = createStore({ maxRooms: 2 });
    const room = createRoom('ROOM01');

    store.set(room);

    expect(store.get(' room01 ')?.roomCode).toBe('ROOM01');
    expect(store.has('room01')).toBe(true);

    store.delete(' room01 ');

    expect(store.get('ROOM01')).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('evicts the least recently used room when the maximum room count is reached', () => {
    const removedRooms: string[] = [];
    const store = createStore({
      maxRooms: 1,
      onRoomRemoved: (room, reason) => {
        removedRooms.push(`${room.roomCode}:${reason}`);
      },
    });

    store.set(createRoom('ROOM01'));
    store.set(createRoom('ROOM02'));

    expect(store.get('ROOM01')).toBeUndefined();
    expect(store.get('ROOM02')?.roomCode).toBe('ROOM02');
    expect(store.size()).toBe(1);
    expect(removedRooms).toEqual(['ROOM01:evict']);
  });

  it('keeps recently accessed rooms ahead of older rooms during eviction', () => {
    const store = createStore({ maxRooms: 2 });
    store.set(createRoom('ROOM01'));
    store.set(createRoom('ROOM02'));

    store.get('ROOM01');
    store.set(createRoom('ROOM03'));

    expect(store.get('ROOM01')?.roomCode).toBe('ROOM01');
    expect(store.get('ROOM02')).toBeUndefined();
    expect(store.get('ROOM03')?.roomCode).toBe('ROOM03');
  });

  it('expires idle rooms after the configured ttl', () => {
    vi.useFakeTimers();
    const removedRooms: string[] = [];
    const store = createStore({
      maxRooms: 2,
      roomIdleTtlMs: 1_000,
      onRoomRemoved: (room, reason) => {
        removedRooms.push(`${room.roomCode}:${reason}`);
      },
    });

    store.set(createRoom('ROOM01'));

    vi.advanceTimersByTime(1_001);

    expect(store.get('ROOM01')).toBeUndefined();
    expect(store.size()).toBe(0);
    expect(removedRooms).toEqual(['ROOM01:expire']);
  });

  it('generates a unique room code when collisions occur', () => {
    const store = createStore({ maxRooms: 3 });
    store.set(createRoom('ROOM01'));

    const createRoomCodeSpy = vi
      .spyOn(shared, 'createRoomCode')
      .mockReturnValueOnce('ROOM01')
      .mockReturnValueOnce('ROOM02');

    expect(store.generateUniqueRoomCode()).toBe('ROOM02');

    createRoomCodeSpy.mockRestore();
  });
});
