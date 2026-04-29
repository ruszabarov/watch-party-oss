import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationResult, RoomResponse } from '@open-watch-party/shared';
import { createRoomState, MAX_TITLE_LENGTH, upsertRoomMember } from '@open-watch-party/shared';

import { createConnectionHandler, createRealtimeState, type SessionRecord } from '../src/socket';
import { createPlaybackUpdateTokenConsumer } from '../src/rate-limiter';

type RecordedEmission = {
  room: string;
  event: string;
  payload: unknown;
};

class FakeIo {
  readonly emitted: RecordedEmission[] = [];
  readonly leftRooms: string[] = [];
  readonly sockets = {
    sockets: new Map<string, { disconnect: (close?: boolean) => void }>(),
  };

  socketsLeave(room: string): void {
    this.leftRooms.push(room);
  }

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
  readonly leftRooms: string[] = [];
  readonly emitted: RecordedEmission[] = [];
  disconnectCalls: boolean[] = [];

  constructor(readonly id: string) {}

  on(event: string, handler: Function): void {
    this.handlers.set(event, handler);
  }

  join(room: string): void {
    this.joinedRooms.push(room);
  }

  leave(room: string): void {
    this.leftRooms.push(room);
  }

  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emitted.push({ room, event, payload });
      },
    };
  }

  disconnect(close?: boolean): void {
    this.disconnectCalls.push(close ?? false);
  }
}

const validPlaybackUpdatePayload = {
  update: {
    serviceId: 'youtube',
    mediaId: 'abc123',
    title: 'Clip',
    playing: false,
    positionSec: 15,
    clientSequence: 1,
  },
};

function createPlaybackUpdatePayload(clientSequence: number) {
  return {
    update: {
      ...validPlaybackUpdatePayload.update,
      clientSequence,
    },
  };
}

function createTestSessionRecord(
  socketId: string,
  roomCode: string,
  memberId: string,
): SessionRecord {
  return {
    socketId,
    roomCode,
    memberId,
    allowPlaybackUpdate: createPlaybackUpdateTokenConsumer(),
  };
}

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
  state.roomStore.set(room);
  state.sessionsBySocket.set(
    socketId,
    createTestSessionRecord(socketId, room.roomCode, 'member-a'),
  );
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

  it('rejects playback updates after the socket exhausts its rate limit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { io, room, socket, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    for (let index = 0; index < 20; index += 1) {
      let response: OperationResult<unknown> | null = null;
      playbackUpdateHandler(createPlaybackUpdatePayload(index + 1), (value) => {
        response = value;
      });
      expect(response).toMatchObject({ ok: true });
    }

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(createPlaybackUpdatePayload(21), (value) => {
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
    playbackUpdateHandler(createPlaybackUpdatePayload(1), (value) => {
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
      playbackUpdateHandler(createPlaybackUpdatePayload(index + 1), () => undefined);
    }

    let rejectedResponse: OperationResult<unknown> | null = null;
    playbackUpdateHandler(createPlaybackUpdatePayload(21), (value) => {
      rejectedResponse = value;
    });
    expect(rejectedResponse).toEqual({
      ok: false,
      error: 'Playback update rate limit exceeded.',
    });

    vi.advanceTimersByTime(100);

    let acceptedResponse: OperationResult<unknown> | null = null;
    playbackUpdateHandler(createPlaybackUpdatePayload(22), (value) => {
      acceptedResponse = value;
    });

    expect(acceptedResponse).toMatchObject({ ok: true });
    expect(room.sequence).toBe(22);
    expect(socket.emitted).toHaveLength(21);
  });

  it('cleans up playback rate limit state on disconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { disconnectHandler, playbackUpdateHandler, state } = createPlaybackUpdateTestContext();

    playbackUpdateHandler(createPlaybackUpdatePayload(1), () => undefined);

    disconnectHandler();

    expect(state.sessionsBySocket.has('socket-1')).toBe(false);
    expect(state.roomStore.size()).toBe(0);
  });

  it('attributes playback updates to the bound session member, not the payload member', () => {
    const { room, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(createPlaybackUpdatePayload(1), (value) => {
      response = value;
    });

    expect(response).toMatchObject({ ok: true });
    expect(room.playback.sourceMemberId).toBe('member-a');
  });

  it('acknowledges stale playback updates without mutating room state', () => {
    const { room, socket, playbackUpdateHandler } = createPlaybackUpdateTestContext();

    let acceptedResponse: OperationResult<unknown> | null = null;
    playbackUpdateHandler(createPlaybackUpdatePayload(1), (value) => {
      acceptedResponse = value;
    });

    expect(acceptedResponse).toMatchObject({ ok: true });

    let staleResponse: OperationResult<unknown> | null = null;
    playbackUpdateHandler(createPlaybackUpdatePayload(1), (value) => {
      staleResponse = value;
    });

    expect(staleResponse).toMatchObject({ ok: true });
    expect(room.sequence).toBe(2);
    expect(socket.emitted).toHaveLength(1);
  });

  it('rejects room leave without a bound socket session', () => {
    const { room, socket, state, roomLeaveHandler } = createPlaybackUpdateTestContext();

    state.sessionsBySocket.delete(socket.id);
    state.activeSocketByMember.delete(`${room.roomCode}:member-a`);

    let response: OperationResult<unknown> | null = null;
    roomLeaveHandler({}, (value) => {
      response = value;
    });

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
    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0]?.event).toBe('room:state');
  });

  it('rejects room creation while the same member is active in another room', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-create-blocked');
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
    state.roomStore.set(room);
    state.sessionsBySocket.set(
      socket.id,
      createTestSessionRecord(socket.id, room.roomCode, 'member-a'),
    );
    state.activeSocketByMember.set(`${room.roomCode}:member-a`, socket.id);
    createConnectionHandler(io as never, state)(socket as never);

    const roomCreateHandler = socket.handlers.get('room:create') as (
      payload: unknown,
      acknowledge: (response: OperationResult<RoomResponse>) => void,
    ) => void;

    let response: OperationResult<RoomResponse> | null = null;
    roomCreateHandler(
      {
        memberId: 'member-a',
        memberName: 'Member A',
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
      error: 'Leave your current room before joining or creating another room.',
    });
    expect(state.roomStore.size()).toBe(1);
    expect(room.members.has('member-a')).toBe(true);
    expect(socket.joinedRooms).toHaveLength(0);
  });

  it('evicts the least recently used room when creating a room at capacity', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-3');
    const state = createRealtimeState({
      maxRooms: 1,
      onRoomRemoved: (room) => {
        io.socketsLeave(room.roomCode);
      },
    });
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

    state.roomStore.set(room);
    state.sessionsBySocket.set(
      'socket-old',
      createTestSessionRecord('socket-old', 'ROOM01', 'member-a'),
    );
    state.activeSocketByMember.set('ROOM01:member-a', 'socket-old');
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

    const successfulResponse = response as { ok: true; data: RoomResponse } | null;
    if (successfulResponse == null) {
      throw new Error('Expected room creation to succeed.');
    }

    expect(successfulResponse.ok).toBe(true);
    expect(successfulResponse.data.memberId).toBe('member-b');
    expect(successfulResponse.data.snapshot.roomCode).not.toBe('ROOM01');
    expect(state.roomStore.size()).toBe(1);
    expect(state.roomStore.get('ROOM01')).toBeUndefined();
    expect(state.roomStore.get(successfulResponse.data.snapshot.roomCode)?.roomCode).toBe(
      successfulResponse.data.snapshot.roomCode,
    );
    expect(io.leftRooms).toEqual(['ROOM01']);
    expect(state.sessionsBySocket.has('socket-old')).toBe(false);
    expect(state.activeSocketByMember.has('ROOM01:member-a')).toBe(false);
  });

  it('cleans up room indexes when the lru ttl expires a room', () => {
    vi.useFakeTimers();

    const io = new FakeIo();
    const state = createRealtimeState({
      roomIdleTtlMs: 1_000,
      onRoomRemoved: (room) => {
        io.socketsLeave(room.roomCode);
      },
    });
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

    state.roomStore.set(room);
    state.sessionsBySocket.set(
      'socket-old',
      createTestSessionRecord('socket-old', 'ROOM01', 'member-a'),
    );
    state.activeSocketByMember.set('ROOM01:member-a', 'socket-old');

    vi.advanceTimersByTime(1_001);

    expect(state.roomStore.get('ROOM01')).toBeUndefined();
    expect(io.leftRooms).toEqual(['ROOM01']);
    expect(state.sessionsBySocket.has('socket-old')).toBe(false);
    expect(state.activeSocketByMember.has('ROOM01:member-a')).toBe(false);
  });

  it('refreshes room recency on joins', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-4');
    const state = createRealtimeState({ maxRooms: 2 });
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
    const otherRoom = createRoomState('ROOM02', {
      memberId: 'member-c',
      memberName: 'Member C',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'def456',
        title: 'Another Clip',
        playing: false,
        positionSec: 0,
      },
    });
    const overflowRoom = createRoomState('ROOM03', {
      memberId: 'member-d',
      memberName: 'Member D',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'ghi789',
        title: 'Third Clip',
        playing: false,
        positionSec: 0,
      },
    });
    upsertRoomMember(room, 'member-a', 'Member A');
    state.roomStore.set(room);
    state.roomStore.set(otherRoom);

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

    state.roomStore.set(overflowRoom);

    expect(state.roomStore.get('ROOM01')?.roomCode).toBe('ROOM01');
    expect(state.roomStore.get('ROOM02')).toBeUndefined();
    expect(state.roomStore.get('ROOM03')?.roomCode).toBe('ROOM03');
  });

  it('broadcasts room join state only to the other sockets in the room', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-join');
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
    state.roomStore.set(room);

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

    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0]?.event).toBe('room:state');
  });

  it('disconnects the prior socket when the same member reconnects', () => {
    const io = new FakeIo();
    const priorSocket = new FakeSocket('socket-old');
    const nextSocket = new FakeSocket('socket-new');
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
    state.roomStore.set(room);
    state.sessionsBySocket.set(
      priorSocket.id,
      createTestSessionRecord(priorSocket.id, room.roomCode, 'member-a'),
    );
    state.activeSocketByMember.set(`${room.roomCode}:member-a`, priorSocket.id);
    io.sockets.sockets.set(priorSocket.id, priorSocket as never);

    createConnectionHandler(io as never, state)(nextSocket as never);

    const roomJoinHandler = nextSocket.handlers.get('room:join') as (
      payload: unknown,
      acknowledge: (response: OperationResult<RoomResponse>) => void,
    ) => void;

    let response: OperationResult<RoomResponse> | null = null;
    roomJoinHandler(
      {
        roomCode: room.roomCode,
        memberId: 'member-a',
        memberName: 'Member A',
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toMatchObject({ ok: true });
    expect(priorSocket.disconnectCalls).toEqual([true]);
    expect(state.sessionsBySocket.has(priorSocket.id)).toBe(false);
    expect(state.sessionsBySocket.get(nextSocket.id)).toMatchObject({
      socketId: nextSocket.id,
      roomCode: room.roomCode,
      memberId: 'member-a',
    });
    expect(state.activeSocketByMember.get(`${room.roomCode}:member-a`)).toBe(nextSocket.id);
  });

  it('rejects room join while the same member is active in another room', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-join-blocked');
    const state = createRealtimeState();
    const firstRoom = createRoomState('ROOM01', {
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
    const secondRoom = createRoomState('ROOM02', {
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
    });

    upsertRoomMember(firstRoom, 'member-a', 'Member A');
    upsertRoomMember(firstRoom, 'member-c', 'Member C');
    upsertRoomMember(secondRoom, 'member-b', 'Member B');
    state.roomStore.set(firstRoom);
    state.roomStore.set(secondRoom);
    state.sessionsBySocket.set(
      socket.id,
      createTestSessionRecord(socket.id, firstRoom.roomCode, 'member-a'),
    );
    state.activeSocketByMember.set(`${firstRoom.roomCode}:member-a`, socket.id);

    createConnectionHandler(io as never, state)(socket as never);

    const roomJoinHandler = socket.handlers.get('room:join') as (
      payload: unknown,
      acknowledge: (response: OperationResult<RoomResponse>) => void,
    ) => void;

    let response: OperationResult<RoomResponse> | null = null;
    roomJoinHandler(
      {
        roomCode: secondRoom.roomCode,
        memberId: 'member-a',
        memberName: 'Member A',
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({
      ok: false,
      error: 'Leave your current room before joining or creating another room.',
    });
    expect(socket.leftRooms).toHaveLength(0);
    expect(socket.joinedRooms).toHaveLength(0);
    expect(firstRoom.members.has('member-a')).toBe(true);
    expect(firstRoom.members.has('member-c')).toBe(true);
    expect(secondRoom.members.has('member-a')).toBe(false);
    expect(secondRoom.members.has('member-b')).toBe(true);
    expect(state.activeSocketByMember.get(`${firstRoom.roomCode}:member-a`)).toBe(socket.id);
    expect(state.sessionsBySocket.get(socket.id)).toMatchObject({
      socketId: socket.id,
      roomCode: firstRoom.roomCode,
      memberId: 'member-a',
    });
    expect(io.emitted).toHaveLength(0);
  });

  it('refreshes room recency on playback updates', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-playback-recency');
    const state = createRealtimeState({ maxRooms: 2 });
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
    const otherRoom = createRoomState('ROOM02', {
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
    });
    const overflowRoom = createRoomState('ROOM03', {
      memberId: 'member-c',
      memberName: 'Member C',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'ghi789',
        title: 'Third Clip',
        playing: false,
        positionSec: 0,
      },
    });

    upsertRoomMember(room, 'member-a', 'Member A');
    state.roomStore.set(room);
    state.roomStore.set(otherRoom);
    state.sessionsBySocket.set(
      socket.id,
      createTestSessionRecord(socket.id, room.roomCode, 'member-a'),
    );
    state.activeSocketByMember.set(`${room.roomCode}:member-a`, socket.id);
    createConnectionHandler(io as never, state)(socket as never);

    const playbackUpdateHandler = socket.handlers.get('playback:update') as (
      payload: unknown,
      acknowledge: (response: OperationResult<unknown>) => void,
    ) => void;

    playbackUpdateHandler(validPlaybackUpdatePayload, () => undefined);
    state.roomStore.set(overflowRoom);

    expect(state.roomStore.get('ROOM01')?.roomCode).toBe('ROOM01');
    expect(state.roomStore.get('ROOM02')).toBeUndefined();
    expect(state.roomStore.get('ROOM03')?.roomCode).toBe('ROOM03');
  });
});
