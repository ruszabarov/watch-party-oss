import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationResult, RoomResponse } from '@watch-party/shared';
import { createRoomState, MAX_TITLE_LENGTH, upsertRoomMember } from '@watch-party/shared';

import { createConnectionHandler, createRealtimeState } from '../src/socket-handlers';

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
  state.roomStore.set({ room, lastActivity: Date.now() });
  state.sessionsBySocket.set(socketId, {
    socketId,
    roomCode: room.roomCode,
    memberId: 'member-a',
  });
  state.activeSocketByMember.set(`${room.roomCode}:member-a`, socketId);

  createConnectionHandler(io as never, state)(socket as never);

  const playbackUpdateHandler = socket.handlers.get('playback:update') as (
    payload: unknown,
    acknowledge: (response: OperationResult<unknown>) => void,
  ) => void;
  const roomLeaveHandler = socket.handlers.get('room:leave') as (
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
    roomLeaveHandler,
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
        extra: 'field',
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

  it('rejects playback updates without a bound socket session', () => {
    const { room, socket, state, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    state.sessionsBySocket.delete(socket.id);
    state.activeSocketByMember.delete(`${room.roomCode}:member-a`);

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(validPlaybackUpdatePayload, (value) => {
      response = value;
    });

    expect(response).toEqual({
      ok: false,
      error: 'Socket session not found.',
    });
    expect(room.sequence).toBe(1);
    expect(socket.emitted).toHaveLength(0);
  });

  it('rejects playback updates with unexpected identity fields', () => {
    const { room, socket, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(
      {
        ...validPlaybackUpdatePayload,
        roomCode: 'ROOM99',
        memberId: 'member-b',
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({
      ok: false,
      error: 'Invalid request payload.',
    });
    expect(room.sequence).toBe(1);
    expect(socket.emitted).toHaveLength(0);
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
    expect(state.roomStore.size()).toBe(0);
  });

  it('attributes playback updates to the bound session member, not the payload member', () => {
    const { room, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(validPlaybackUpdatePayload, (value) => {
      response = value;
    });

    expect(response).toMatchObject({ ok: true });
    expect(room.playback.sourceMemberId).toBe('member-a');
  });

  it('rejects room leave without a bound socket session', () => {
    const { room, socket, state, roomLeaveHandler } = createPlaybackUpdateTestContext();

    state.sessionsBySocket.delete(socket.id);
    state.activeSocketByMember.delete(`${room.roomCode}:member-a`);

    let response: OperationResult<unknown> | null = null;
    roomLeaveHandler(
      {},
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({
      ok: false,
      error: 'Socket session not found.',
    });
    expect(room.members.has('member-a')).toBe(true);
  });

  it('rejects room leave with unexpected identity fields', () => {
    const { room, roomLeaveHandler } = createPlaybackUpdateTestContext();

    let response: OperationResult<unknown> | null = null;
    roomLeaveHandler(
      {
        roomCode: room.roomCode,
        memberId: 'member-a',
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({
      ok: false,
      error: 'Invalid request payload.',
    });
    expect(room.members.has('member-a')).toBe(true);
  });

  it('removes only the bound member on room leave', () => {
    const { io, room, roomLeaveHandler, state } = createPlaybackUpdateTestContext();

    upsertRoomMember(room, 'member-b', 'Member B');

    let response: OperationResult<unknown> | null = null;
    roomLeaveHandler({}, (value) => {
      response = value;
    });

    expect(response).toEqual({
      ok: true,
      data: { roomCode: room.roomCode },
    });
    expect(room.members.has('member-a')).toBe(false);
    expect(room.members.has('member-b')).toBe(true);
    expect(state.sessionsBySocket.has('socket-1')).toBe(false);
    expect(io.emitted).toHaveLength(1);
    expect(io.emitted[0]?.event).toBe('room:state');
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

    expect(response).not.toBeNull();
    const successfulResponse = response as { ok: true; data: RoomResponse } | null;
    if (successfulResponse == null) {
      throw new Error('Expected room creation to succeed.');
    }

    expect(successfulResponse.data.memberId).toBe('member-a');
    expect(successfulResponse.data.snapshot.members[0]?.name).toBe('Host');
    expect(successfulResponse.data.snapshot.playback.title).toBe('T'.repeat(MAX_TITLE_LENGTH));
    expect(state.roomStore.size()).toBe(1);
    expect(socket.joinedRooms).toEqual([successfulResponse.data.snapshot.roomCode]);
    expect(io.emitted).toHaveLength(1);
    expect(io.emitted[0]?.event).toBe('room:state');
  });

  it('rejects room creation when the room cap is reached', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-3');
    const state = createRealtimeState({ maxRooms: 1 });
    const room = createRoomState('ROOM01', {
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
    });

    state.roomStore.set({ room, lastActivity: Date.now() });
    createConnectionHandler(io as never, state)(socket as never);

    const roomCreateHandler = socket.handlers.get('room:create') as (
      payload: unknown,
      acknowledge: (response: OperationResult<RoomResponse>) => void,
    ) => void;

    let response: OperationResult<RoomResponse> | null = null;
    roomCreateHandler(
      {
        memberId: 'member-b',
        memberName: 'Member B',
        serviceId: 'youtube',
        initialPlayback: {
          serviceId: 'youtube',
          mediaId: 'def456',
          title: 'Another Clip',
          playing: false,
          positionSec: 0,
        },
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({
      ok: false,
      error: 'Room limit reached (1). Please try again later.',
    });
    expect(state.roomStore.size()).toBe(1);
  });

  it('refreshes last activity on room joins', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const io = new FakeIo();
    const socket = new FakeSocket('socket-4');
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
        positionSec: 5,
      },
    });
    upsertRoomMember(room, 'member-a', 'Member A');
    state.roomStore.set({ room, lastActivity: Date.now() - 10_000 });

    createConnectionHandler(io as never, state)(socket as never);

    const roomJoinHandler = socket.handlers.get('room:join') as (
      payload: unknown,
      acknowledge: (response: OperationResult<RoomResponse>) => void,
    ) => void;

    roomJoinHandler(
      {
        roomCode: 'ROOM01',
        memberId: 'member-b',
        memberName: 'Member B',
      },
      () => undefined,
    );

    expect(state.roomStore.get('ROOM01')?.lastActivity).toBe(Date.now());
  });

  it('refreshes last activity on playback updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { state, playbackUpdateHandler } = createPlaybackUpdateTestContext();
    state.roomStore.set({
      room: state.roomStore.get('ROOM01')!.room,
      lastActivity: Date.now() - 10_000,
    });

    playbackUpdateHandler(validPlaybackUpdatePayload, () => undefined);

    expect(state.roomStore.get('ROOM01')?.lastActivity).toBe(Date.now());
  });
});
