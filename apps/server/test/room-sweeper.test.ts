import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomState, upsertRoomMember } from '@open-watch-party/shared';

import { sweepIdleRooms } from '../src/room-sweeper';
import { createRealtimeState } from '../src/socket-handlers';

class FakeIo {
  readonly leftRooms: string[] = [];

  socketsLeave(roomCode: string): void {
    this.leftRooms.push(roomCode);
  }
}

function createStoredRoom(roomCode: string, lastActivity: number) {
  const room = createRoomState(
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
    lastActivity - 100,
  );
  upsertRoomMember(room, 'member-a', 'Member A', lastActivity - 100);
  return { room, lastActivity };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('room sweeper', () => {
  it('removes idle rooms and clears related indexes', () => {
    const io = new FakeIo();
    const state = createRealtimeState();
    const staleRoom = createStoredRoom('ROOM01', 1_000);
    const freshRoom = createStoredRoom('ROOM02', 9_000);

    state.roomStore.set(staleRoom);
    state.roomStore.set(freshRoom);
    state.sessionsBySocket.set('socket-1', {
      socketId: 'socket-1',
      roomCode: 'ROOM01',
      memberId: 'member-a',
    });
    state.activeSocketByMember.set('ROOM01:member-a', 'socket-1');
    state.playbackUpdateRateLimiter.consume('socket-1');

    const expiredRoomCodes = sweepIdleRooms(io as never, state, {
      idleTtlMs: 5_000,
      now: () => 10_000,
    });

    expect(expiredRoomCodes).toEqual(['ROOM01']);
    expect(io.leftRooms).toEqual(['ROOM01']);
    expect(state.roomStore.get('ROOM01')).toBeUndefined();
    expect(state.roomStore.get('ROOM02')?.room.roomCode).toBe('ROOM02');
    expect(state.sessionsBySocket.has('socket-1')).toBe(false);
    expect(state.activeSocketByMember.has('ROOM01:member-a')).toBe(false);

    for (let index = 0; index < 20; index += 1) {
      expect(state.playbackUpdateRateLimiter.consume('socket-1')).toBe(true);
    }
    expect(state.playbackUpdateRateLimiter.consume('socket-1')).toBe(false);
  });
});
