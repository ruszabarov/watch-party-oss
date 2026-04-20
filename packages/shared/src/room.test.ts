import { describe, expect, it } from 'vitest';

import {
  applyPlaybackUpdate,
  createRoomState,
  resolvePlaybackState,
  toPartySnapshot,
  upsertRoomMember,
} from './index';

describe('room reducer', () => {
  it('orders playback updates by server receive sequence', () => {
    const room = createRoomState(
      'ROOM01',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
      },
      1_000,
    );

    upsertRoomMember(room, 'member-a', 'Member A', 1_000);
    upsertRoomMember(room, 'member-b', 'Member B', 1_000);

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'netflix',
        mediaId: '123',
        positionSec: 10,
        playing: true,
        issuedAt: 1_200,
      },
      'member-a',
      1_500,
    );

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'netflix',
        mediaId: '123',
        positionSec: 12,
        playing: false,
        issuedAt: 1_300,
      },
      'member-b',
      1_600,
    );

    expect(room.sequence).toBe(2);
    expect(room.playback?.playing).toBe(false);
    expect(room.playback?.sequence).toBe(2);
    expect(room.playback?.sourceMemberId).toBe('member-b');
  });

  it('resolves live playback position for late join snapshots', () => {
    const room = createRoomState(
      'ROOM02',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
      },
      1_000,
    );

    upsertRoomMember(room, 'member-a', 'Member A', 1_000);

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'netflix',
        mediaId: '456',
        positionSec: 25,
        playing: true,
        issuedAt: 1_050,
      },
      'member-a',
      1_100,
    );

    const playback = resolvePlaybackState(room.playback, 3_100);
    expect(playback?.positionSec).toBe(27);

    const snapshot = toPartySnapshot(room, 3_100);
    expect(snapshot.playback?.positionSec).toBe(27);
  });
});
