import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationResult, RoomResponse } from '@watch-party/shared';
import { createRoomState, MAX_TITLE_LENGTH, upsertRoomMember } from '@watch-party/shared';

import { createConnectionHandler, createRealtimeState } from './socket-handlers';

type RecordedEmission = {
  room: string;
  event: string;
  payload: unknown;
};

class FakeIo {
  readonly emitted: RecordedEmission[] = [];

  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emitted.push({ room, event, payload });
      },
    };
  }
}

class FakeSocket {
  readonly handlers = new Map<string, Function>();
  readonly joinedRooms: string[] = [];
  readonly emitted: RecordedEmission[] = [];

  constructor(readonly id: string) {}

  on(event: string, handler: Function): void {
    this.handlers.set(event, handler);
  }

  join(room: string): void {
    this.joinedRooms.push(room);
  }

  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emitted.push({ room, event, payload });
      },
    };
  }
}

const validPlaybackUpdatePayload = {
  roomCode: 'ROOM01',
  memberId: 'member-a',
  update: {
    serviceId: 'youtube',
    mediaId: 'abc123',
    title: 'Clip',
    playing: false,
    positionSec: 15,
    issuedAt: 1_777_000_000_000,
  },
};

function createPlaybackUpdateTestContext(socketId = 'socket-1') {
  const io = new FakeIo();
  const socket = new FakeSocket(socketId);
  const state = createRealtimeState();
  const room = createRoomState('ROOM01', {
    memberId: 'member-a',
    memberName: 'Member A',
    serviceId: 'youtube',
    initialPlayback: {
      serviceId: 'youtube',
      mediaId: 'abc123',
      title: 'Clip',
      playing: true,
      positionSec: 10,
    },
  });

  upsertRoomMember(room, 'member-a', 'Member A');
  state.rooms.set(room.roomCode, room);

  createConnectionHandler(io as never, state)(socket as never);

  const playbackUpdateHandler = socket.handlers.get('playback:update') as (
    payload: unknown,
    acknowledge: (response: OperationResult<unknown>) => void,
  ) => void;

  const disconnectHandler = socket.handlers.get('disconnect') as () => void;

  return {
    io,
    room,
    socket,
    state,
    playbackUpdateHandler,
    disconnectHandler,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('socket handlers', () => {
  it('rejects invalid payloads before mutating room state', () => {
    const { io, room, socket, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(
      {
        roomCode: 'ROOM01',
        memberId: 'member-a',
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({ ok: false, error: 'Invalid request payload.' });
    expect(room.sequence).toBe(1);
    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(0);
  });

  it('rejects playback updates after the socket exhausts its token bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { io, room, socket, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    for (let index = 0; index < 20; index += 1) {
      let response: OperationResult<unknown> | null = null;
      playbackUpdateHandler(validPlaybackUpdatePayload, (value) => {
        response = value;
      });
      expect(response).toMatchObject({ ok: true });
    }

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(validPlaybackUpdatePayload, (value) => {
      response = value;
    });

    expect(response).toEqual({
      ok: false,
      error: 'Playback update rate limit exceeded.',
    });
    expect(room.sequence).toBe(21);
    expect(socket.emitted).toHaveLength(20);
    expect(io.emitted).toHaveLength(0);
  });

  it('refills playback update tokens over time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { room, socket, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    for (let index = 0; index < 20; index += 1) {
      playbackUpdateHandler(validPlaybackUpdatePayload, () => undefined);
    }

    let rejectedResponse: OperationResult<unknown> | null = null;
    playbackUpdateHandler(validPlaybackUpdatePayload, (value) => {
      rejectedResponse = value;
    });
    expect(rejectedResponse).toEqual({
      ok: false,
      error: 'Playback update rate limit exceeded.',
    });

    vi.setSystemTime(new Date('2026-04-23T12:00:00.100Z'));

    let acceptedResponse: OperationResult<unknown> | null = null;
    playbackUpdateHandler(validPlaybackUpdatePayload, (value) => {
      acceptedResponse = value;
    });

    expect(acceptedResponse).toMatchObject({ ok: true });
    expect(room.sequence).toBe(22);
    expect(socket.emitted).toHaveLength(21);
  });

  it('cleans up playback rate limit state on disconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { disconnectHandler, playbackUpdateHandler, state } =
      createPlaybackUpdateTestContext();

    playbackUpdateHandler(validPlaybackUpdatePayload, () => undefined);

    expect(state.playbackUpdateRateLimiter.consume('socket-1')).toBe(true);

    disconnectHandler();

    for (let index = 0; index < 20; index += 1) {
      expect(state.playbackUpdateRateLimiter.consume('socket-1')).toBe(true);
    }
    expect(state.playbackUpdateRateLimiter.consume('socket-1')).toBe(false);
  });

  it('sanitizes valid room creation payloads before storing and broadcasting', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-2');
    const state = createRealtimeState();

    createConnectionHandler(io as never, state)(socket as never);

    const roomCreateHandler = socket.handlers.get('room:create') as (
      payload: unknown,
      acknowledge: (response: OperationResult<RoomResponse>) => void,
    ) => void;

    let response: OperationResult<RoomResponse> | null = null;
    roomCreateHandler(
      {
        memberId: ' member-a ',
        memberName: '\n  Host\u0000  ',
        serviceId: 'youtube',
        initialPlayback: {
          serviceId: 'youtube',
          mediaId: ' abc123 ',
          title: ` ${'T'.repeat(MAX_TITLE_LENGTH + 20)} `,
          playing: true,
          positionSec: 5,
        },
      },
      (value) => {
        response = value;
      },
    );

    expect(response?.ok).toBe(true);
    if (!response?.ok) {
      return;
    }

    expect(response.data.memberId).toBe('member-a');
    expect(response.data.snapshot.members[0]?.name).toBe('Host');
    expect(response.data.snapshot.playback.title).toBe('T'.repeat(MAX_TITLE_LENGTH));
    expect(state.rooms.size).toBe(1);
    expect(socket.joinedRooms).toEqual([response.data.snapshot.roomCode]);
    expect(io.emitted).toHaveLength(1);
    expect(io.emitted[0]?.event).toBe('room:state');
  });
});
