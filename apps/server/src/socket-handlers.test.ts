import { describe, expect, it } from 'vitest';
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

describe('socket handlers', () => {
  it('rejects invalid payloads before mutating room state', () => {
    const io = new FakeIo();
    const socket = new FakeSocket('socket-1');
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
