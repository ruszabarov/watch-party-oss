import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationResult, PartySnapshot, RoomResponse } from '@open-watch-party/shared';
import { MAX_TITLE_LENGTH } from '@open-watch-party/shared';

import { RealtimeSocketService } from '../src/socket';

/** Mirrors `DEFAULT_ROOM_IDLE_TTL_MS` in room.service (not exported). */
const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;

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
  readonly emitted: RecordedEmission[] = [];
  disconnectCalls: boolean[] = [];

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

  disconnect(close?: boolean): void {
    this.disconnectCalls.push(close ?? false);
  }
}

const validPlaybackUpdatePayload = {
  mediaId: 'abc123',
  title: 'Clip',
  playing: false,
  positionSec: 15,
};

function createSocketServiceContext() {
  const io = new FakeIo();
  const socketService = new RealtimeSocketService(io as never);
  return { io, socketService };
}

function connectSocket(socketService: RealtimeSocketService, socketId: string): FakeSocket {
  const socket = new FakeSocket(socketId);
  socketService.handleConnection(socket as never);
  return socket;
}

function getHandler<TResponse>(
  socket: FakeSocket,
  event: string,
): (payload: unknown, acknowledge: (response: OperationResult<TResponse>) => void) => void {
  return socket.handlers.get(event) as (
    payload: unknown,
    acknowledge: (response: OperationResult<TResponse>) => void,
  ) => void;
}

function createRoom(
  socket: FakeSocket,
  overrides: Partial<{
    memberId: string;
    memberName: string;
    streamingServiceId: string;
    title: string;
  }> = {},
): RoomResponse {
  const roomCreateHandler = getHandler<RoomResponse>(socket, 'room:create');
  let response: OperationResult<RoomResponse> | null = null;

  roomCreateHandler(
    {
      memberId: overrides.memberId ?? 'member-a',
      memberName: overrides.memberName ?? 'Member A',
      streamingServiceId: overrides.streamingServiceId ?? 'youtube',
      initialPlayback: {
        mediaId: 'abc123',
        title: overrides.title ?? 'Clip',
        playing: true,
        positionSec: 10,
      },
    },
    (value) => {
      response = value;
    },
  );

  const acknowledgedResponse = response as OperationResult<RoomResponse> | null;
  if (acknowledgedResponse?.ok !== true) {
    throw new Error('Expected room creation to succeed.');
  }

  socket.emitted.length = 0;
  return acknowledgedResponse.data;
}

function joinRoom(
  socket: FakeSocket,
  roomCode: string,
  overrides: Partial<{
    memberId: string;
    memberName: string;
  }> = {},
): OperationResult<RoomResponse> {
  const roomJoinHandler = getHandler<RoomResponse>(socket, 'room:join');
  let response: OperationResult<RoomResponse> | null = null;

  roomJoinHandler(
    {
      roomCode,
      memberId: overrides.memberId ?? 'member-b',
      memberName: overrides.memberName ?? 'Member B',
    },
    (value) => {
      response = value;
    },
  );

  if (response == null) {
    throw new Error('Expected room join to acknowledge.');
  }

  return response;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('socket handlers', () => {
  it('sanitizes valid room creation payloads before storing and broadcasting', () => {
    const { io, socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    const roomCreateHandler = getHandler<RoomResponse>(socket, 'room:create');

    let response: OperationResult<RoomResponse> | null = null;
    roomCreateHandler(
      {
        memberId: ' member-a ',
        memberName: '\n  Host\u0000  ',
        streamingServiceId: 'youtube',
        initialPlayback: {
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

    expect(response).toMatchObject({
      ok: true,
      data: {
        memberId: 'member-a',
        snapshot: {
          members: [{ id: 'member-a', name: 'Host' }],
          playback: {
            streamingServiceId: 'youtube',
            title: 'T'.repeat(MAX_TITLE_LENGTH),
          },
        },
      },
    });
    expect(socket.joinedRooms).toHaveLength(1);
    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0]?.event).toBe('room:state');
  });

  it('acknowledges streaming-service-specific media validation failures during room creation', () => {
    const { io, socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    const roomCreateHandler = getHandler<RoomResponse>(socket, 'room:create');

    let response: OperationResult<RoomResponse> | null = null;
    expect(() => {
      roomCreateHandler(
        {
          memberId: 'member-a',
          memberName: 'Member A',
          streamingServiceId: 'netflix',
          initialPlayback: {
            mediaId: 'not-a-netflix-id',
            title: 'Clip',
            playing: true,
            positionSec: 5,
          },
        },
        (value) => {
          response = value;
        },
      );
    }).not.toThrow();

    expect(response).toEqual({
      ok: false,
      error: 'Invalid media id for streaming service.',
    });
    expect(socket.joinedRooms).toHaveLength(0);
    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(0);
  });

  it('rejects invalid playback payloads without broadcasting playback state', () => {
    const { io, socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    createRoom(socket);

    let response: OperationResult<unknown> | null = null;
    getHandler<unknown>(socket, 'playback:update')({ extra: 'field' }, (value) => {
      response = value;
    });

    expect(response).toEqual({ ok: false, error: 'Invalid request payload.' });
    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(0);
  });

  it('acknowledges streaming-service-specific media validation failures during playback updates', () => {
    const { io, socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    createRoom(socket);

    let response: OperationResult<unknown> | null = null;
    expect(() => {
      getHandler<unknown>(socket, 'playback:update')(
        {
          ...validPlaybackUpdatePayload,
          mediaId: 'abc/123',
        },
        (value) => {
          response = value;
        },
      );
    }).not.toThrow();

    expect(response).toEqual({
      ok: false,
      error: 'Invalid media id for streaming service.',
    });
    expect(io.emitted).toHaveLength(0);
    expect(socket.emitted).toHaveLength(0);
  });

  it('broadcasts playback state when a member switches to same streaming service media', () => {
    const { socketService } = createSocketServiceContext();
    const hostSocket = connectSocket(socketService, 'socket-host');
    const guestSocket = connectSocket(socketService, 'socket-guest');
    const room = createRoom(hostSocket);
    expect(joinRoom(guestSocket, room.snapshot.roomCode)).toMatchObject({ ok: true });
    hostSocket.emitted.length = 0;

    let response: OperationResult<PartySnapshot> | null = null;
    getHandler<PartySnapshot>(hostSocket, 'playback:update')(
      {
        ...validPlaybackUpdatePayload,
        mediaId: 'next456',
        title: 'Next clip',
        positionSec: 0,
        playing: false,
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        watchUrl: 'https://www.youtube.com/watch?v=next456',
        playback: {
          streamingServiceId: 'youtube',
          mediaId: 'next456',
          title: 'Next clip',
          positionSec: 0,
          playing: false,
        },
      },
    });
    expect(hostSocket.emitted).toHaveLength(1);
    expect(hostSocket.emitted[0]).toMatchObject({
      room: room.snapshot.roomCode,
      event: 'playback:state',
      payload: {
        watchUrl: 'https://www.youtube.com/watch?v=next456',
        playback: {
          mediaId: 'next456',
        },
      },
    });
  });

  it('rejects playback updates without a bound socket session', () => {
    const { socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');

    let response: OperationResult<unknown> | null = null;
    getHandler<unknown>(socket, 'playback:update')(validPlaybackUpdatePayload, (value) => {
      response = value;
    });

    expect(response).toEqual({
      ok: false,
      error: 'Socket session not found.',
    });
  });

  it('rate limits playback updates per socket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    createRoom(socket);
    const playbackUpdateHandler = getHandler<unknown>(socket, 'playback:update');

    for (let index = 0; index < 20; index += 1) {
      playbackUpdateHandler(
        {
          ...validPlaybackUpdatePayload,
        },
        () => undefined,
      );
    }

    let response: OperationResult<unknown> | null = null;
    playbackUpdateHandler(
      {
        ...validPlaybackUpdatePayload,
      },
      (value) => {
        response = value;
      },
    );

    expect(response).toEqual({
      ok: false,
      error: 'Playback update rate limit exceeded.',
    });
  });

  it('removes only the bound member on room leave', () => {
    const { io, socketService } = createSocketServiceContext();
    const hostSocket = connectSocket(socketService, 'socket-host');
    const guestSocket = connectSocket(socketService, 'socket-guest');
    const room = createRoom(hostSocket);
    expect(joinRoom(guestSocket, room.snapshot.roomCode)).toMatchObject({ ok: true });

    let response: OperationResult<{ roomCode: string }> | null = null;
    const roomLeaveHandler = hostSocket.handlers.get('room:leave') as (
      acknowledge: (response: OperationResult<{ roomCode: string }>) => void,
    ) => void;
    roomLeaveHandler((value) => {
      response = value;
    });

    expect(response).toEqual({
      ok: true,
      data: { roomCode: room.snapshot.roomCode },
    });
    expect(io.emitted).toHaveLength(1);
    expect(io.emitted[0]).toMatchObject({
      room: room.snapshot.roomCode,
      event: 'room:state',
    });
  });

  it('does not emit room:closed when a room is removed by an explicit leave', () => {
    const { io, socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    const room = createRoom(socket);

    let response: OperationResult<{ roomCode: string }> | null = null;
    const roomLeaveHandler = socket.handlers.get('room:leave') as (
      acknowledge: (response: OperationResult<{ roomCode: string }>) => void,
    ) => void;
    roomLeaveHandler((value) => {
      response = value;
    });

    expect(response).toEqual({
      ok: true,
      data: { roomCode: room.snapshot.roomCode },
    });
    expect(io.emitted.filter((entry) => entry.event === 'room:closed')).toEqual([]);
    expect(io.leftRooms).toEqual([room.snapshot.roomCode]);
  });

  it('emits room:closed with reason "evicted" when LRU drops a room', () => {
    const { io, socketService } = createSocketServiceContext();
    const firstSocket = connectSocket(socketService, 'socket-1');
    const firstRoom = createRoom(firstSocket);

    for (let roomIndex = 2; roomIndex <= 1_001; roomIndex += 1) {
      const socket = connectSocket(socketService, `socket-${roomIndex}`);
      createRoom(socket, {
        memberId: `member-${roomIndex}`,
        memberName: `Member ${roomIndex}`,
        title: `Clip ${roomIndex}`,
      });
    }

    expect(io.emitted.filter((entry) => entry.event === 'room:closed')).toEqual([
      {
        room: firstRoom.snapshot.roomCode,
        event: 'room:closed',
        payload: { roomCode: firstRoom.snapshot.roomCode, reason: 'evicted' },
      },
    ]);
    expect(io.leftRooms).toContain(firstRoom.snapshot.roomCode);
  });

  it('emits room:closed with reason "expired" when a room idles past its TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const { io, socketService } = createSocketServiceContext();
    const socket = connectSocket(socketService, 'socket-1');
    const room = createRoom(socket);

    vi.advanceTimersByTime(ROOM_IDLE_TTL_MS + 2_000);

    expect(io.emitted.filter((entry) => entry.event === 'room:closed')).toEqual([
      {
        room: room.snapshot.roomCode,
        event: 'room:closed',
        payload: { roomCode: room.snapshot.roomCode, reason: 'expired' },
      },
    ]);
    expect(io.leftRooms).toContain(room.snapshot.roomCode);
  });

  it('broadcasts room state when a bound socket disconnects', () => {
    const { io, socketService } = createSocketServiceContext();
    const hostSocket = connectSocket(socketService, 'socket-host');
    const guestSocket = connectSocket(socketService, 'socket-guest');
    const room = createRoom(hostSocket);
    expect(joinRoom(guestSocket, room.snapshot.roomCode)).toMatchObject({ ok: true });

    const disconnectHandler = hostSocket.handlers.get('disconnect');
    if (!disconnectHandler) {
      throw new Error('Expected disconnect handler to be registered.');
    }

    disconnectHandler();

    expect(io.emitted).toHaveLength(1);
    expect(io.emitted[0]).toMatchObject({
      room: room.snapshot.roomCode,
      event: 'room:state',
    });
  });

  it('disconnects the prior socket when the same member reconnects', () => {
    const { socketService, io } = createSocketServiceContext();
    const priorSocket = connectSocket(socketService, 'socket-old');
    const nextSocket = connectSocket(socketService, 'socket-new');
    const room = createRoom(priorSocket);
    io.sockets.sockets.set(priorSocket.id, priorSocket);

    const response = joinRoom(nextSocket, room.snapshot.roomCode, {
      memberId: 'member-a',
      memberName: 'Member A',
    });

    expect(response).toMatchObject({ ok: true });
    expect(priorSocket.disconnectCalls).toEqual([true]);
  });

  it('rejects room join while the same member is active in another room', () => {
    const { socketService } = createSocketServiceContext();
    const firstSocket = connectSocket(socketService, 'socket-1');
    const secondSocket = connectSocket(socketService, 'socket-2');
    const firstRoom = createRoom(firstSocket);
    const secondRoom = createRoom(secondSocket, {
      memberId: 'member-b',
      memberName: 'Member B',
    });

    const response = joinRoom(firstSocket, secondRoom.snapshot.roomCode, {
      memberId: firstRoom.memberId,
      memberName: 'Member A',
    });

    expect(response).toEqual({
      ok: false,
      error: 'Leave your current room before joining or creating another room.',
    });
  });
});
