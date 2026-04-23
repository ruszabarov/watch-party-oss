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
        watchUrl: 'https://www.netflix.com/watch/123',
        initialPlayback: {
          serviceId: 'netflix',
          mediaId: '123',
          title: 'Example',
          positionSec: 0,
          playing: false,
        },
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

    expect(room.sequence).toBe(3);
    expect(room.playback.playing).toBe(false);
    expect(room.playback.sequence).toBe(3);
    expect(room.playback.sourceMemberId).toBe('member-b');
  });

  it('resolves live playback position for late join snapshots', () => {
    const room = createRoomState(
      'ROOM02',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
        watchUrl: 'https://www.netflix.com/watch/456',
        initialPlayback: {
          serviceId: 'netflix',
          mediaId: '456',
          title: 'Example',
          positionSec: 0,
          playing: false,
        },
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
    expect(playback.positionSec).toBe(27);

    const snapshot = toPartySnapshot(room, 3_100);
    expect(snapshot.playback.positionSec).toBe(27);
  });

  it('includes the canonical watch url in snapshots', () => {
    const room = createRoomState(
      'ROOM03',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'youtube',
        watchUrl: 'https://www.youtube.com/watch?v=abc123',
        initialPlayback: {
          serviceId: 'youtube',
          mediaId: 'abc123',
          title: 'Clip',
          positionSec: 4,
          playing: true,
        },
      },
      2_000,
    );

    const snapshot = toPartySnapshot(room, 2_000);
    expect(snapshot.watchUrl).toBe('https://www.youtube.com/watch?v=abc123');
  });
});
