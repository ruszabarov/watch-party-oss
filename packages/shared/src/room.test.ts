import { describe, expect, it } from 'vitest';

import {
  applyPlaybackUpdate,
  createRoomRequestSchema,
  createRoomState,
  findServiceDefinitionByUrl,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  MAX_MEMBER_NAME_LENGTH,
  MAX_PLAYBACK_POSITION_SEC,
  MAX_TITLE_LENGTH,
  removeRoomMember,
  playbackUpdateRequestSchema,
  normalizeRoomCode,
  resolvePlaybackState,
  sanitizeMemberName,
  SERVICE_DEFINITION_BY_ID,
  SUPPORTED_SERVICES,
  SUPPORTED_SERVICE_CONTENT_MATCHES,
  toPartySnapshot,
  upsertRoomMember,
} from './index';

describe('room reducer', () => {
  it('normalizes room codes for lookups and joins', () => {
    expect(normalizeRoomCode(' ab12cd ')).toBe('AB12CD');
  });

  it('accepts playback updates with increasing client sequence numbers', () => {
    const room = createRoomState(
      'ROOM01',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
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
        title: 'Example',
        positionSec: 10,
        playing: true,
        clientSequence: 1,
      },
      'member-a',
      1_500,
    );

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'netflix',
        mediaId: '123',
        title: 'Example',
        positionSec: 12,
        playing: false,
        clientSequence: 1,
      },
      'member-b',
      1_600,
    );

    expect(room.sequence).toBe(3);
    expect(room.playback.playing).toBe(false);
    expect(room.playback.sequence).toBe(3);
    expect(room.playback.sourceMemberId).toBe('member-b');
  });

  it('ignores stale playback updates from the same member', () => {
    const room = createRoomState(
      'ROOM01',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
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

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'netflix',
        mediaId: '123',
        title: 'Example',
        positionSec: 10,
        playing: true,
        clientSequence: 2,
      },
      'member-a',
      1_500,
    );

    const playback = applyPlaybackUpdate(
      room,
      {
        serviceId: 'netflix',
        mediaId: '123',
        title: 'Example',
        positionSec: 3,
        playing: false,
        clientSequence: 1,
      },
      'member-a',
      1_600,
    );

    expect(playback).toBe(room.playback);
    expect(room.sequence).toBe(2);
    expect(room.playback.positionSec).toBe(10);
    expect(room.playback.playing).toBe(true);
  });

  it('resolves live playback position for late join snapshots', () => {
    const room = createRoomState(
      'ROOM02',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
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
        title: 'Example',
        positionSec: 25,
        playing: true,
        clientSequence: 1,
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

  it('builds canonical watch urls per service', () => {
    expect(SERVICE_DEFINITION_BY_ID.netflix.buildCanonicalWatchUrl('123456')).toBe(
      'https://www.netflix.com/watch/123456',
    );
    expect(SERVICE_DEFINITION_BY_ID.youtube.buildCanonicalWatchUrl('abc123_-')).toBe(
      'https://www.youtube.com/watch?v=abc123_-',
    );
  });

  it('classifies supported service watch urls', () => {
    expect(findServiceDefinitionByUrl(new URL('https://www.netflix.com/watch/123456'))).toEqual({
      serviceId: 'netflix',
      service: expect.any(Object),
      isWatchPage: true,
    });
    expect(findServiceDefinitionByUrl(new URL('https://www.youtube.com/watch?v=abc123'))).toEqual({
      serviceId: 'youtube',
      service: expect.any(Object),
      isWatchPage: true,
    });
    expect(findServiceDefinitionByUrl(new URL('https://youtu.be/abc123'))).toEqual({
      serviceId: 'youtube',
      service: expect.any(Object),
      isWatchPage: true,
    });
    expect(findServiceDefinitionByUrl(new URL('https://www.youtube.com/embed/abc123'))).toEqual({
      serviceId: 'youtube',
      service: expect.any(Object),
      isWatchPage: true,
    });
    expect(findServiceDefinitionByUrl(new URL('https://www.youtube.com/live/abc123'))).toEqual({
      serviceId: 'youtube',
      service: expect.any(Object),
      isWatchPage: true,
    });
  });

  it('classifies supported service non-watch urls and unsupported urls', () => {
    expect(findServiceDefinitionByUrl(new URL('https://www.netflix.com/browse'))).toEqual({
      serviceId: 'netflix',
      service: expect.any(Object),
      isWatchPage: false,
    });
    expect(
      findServiceDefinitionByUrl(new URL('https://www.youtube.com/feed/subscriptions')),
    ).toEqual({
      serviceId: 'youtube',
      service: expect.any(Object),
      isWatchPage: false,
    });
    expect(findServiceDefinitionByUrl(new URL('https://www.youtube.com/watch?v='))).toEqual({
      serviceId: 'youtube',
      service: expect.any(Object),
      isWatchPage: false,
    });
    expect(findServiceDefinitionByUrl(new URL('https://example.com/watch/123'))).toBeUndefined();
  });

  it('exposes supported service ids and content matches from one catalog', () => {
    expect(SUPPORTED_SERVICES).toEqual(['netflix', 'youtube']);
    expect(SUPPORTED_SERVICE_CONTENT_MATCHES).toEqual([
      '*://*.netflix.com/*',
      '*://*.youtube.com/*',
      '*://youtu.be/*',
      '*://*.youtube-nocookie.com/*',
    ]);
  });

  it('rejects invalid media ids when deriving canonical watch urls', () => {
    expect(SERVICE_DEFINITION_BY_ID.netflix.isMediaIdValid('abc123')).toBe(false);
    expect(SERVICE_DEFINITION_BY_ID.youtube.isMediaIdValid('abc/123')).toBe(false);
    expect(() =>
      createRoomState('ROOM04', {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'youtube',
        initialPlayback: {
          serviceId: 'youtube',
          mediaId: 'abc/123',
          title: 'Clip',
          positionSec: 4,
          playing: true,
        },
      }),
    ).toThrow('Invalid media id for service.');
  });

  it('updates the canonical watch url when playback media changes', () => {
    const room = createRoomState('ROOM05', {
      memberId: 'member-a',
      memberName: 'Member A',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'abc123',
        title: 'Clip',
        positionSec: 4,
        playing: true,
      },
    });

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'youtube',
        mediaId: 'next456',
        title: 'Clip 2',
        positionSec: 0,
        playing: false,
        clientSequence: 1,
      },
      'member-a',
      2_200,
    );

    expect(toPartySnapshot(room).watchUrl).toBe('https://www.youtube.com/watch?v=next456');
  });

  it('sanitizes member names before storing them in the room', () => {
    const room = createRoomState('ROOM06', {
      memberId: 'member-a',
      memberName: 'Member A',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'abc123',
        title: 'Clip',
        positionSec: 4,
        playing: true,
      },
    });

    upsertRoomMember(room, 'member-b', '\n  Member\tB\u0000  ');

    expect(room.members.get('member-b')?.name).toBe('MemberB');
  });
});

describe('protocol schemas', () => {
  it('normalizes room create payloads', () => {
    const payload = createRoomRequestSchema.parse({
      memberId: ' member-a ',
      memberName: ` ${'A'.repeat(MAX_MEMBER_NAME_LENGTH + 10)} \u0000`,
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: ' abc123 ',
        title: `  ${'T'.repeat(MAX_TITLE_LENGTH + 20)}  `,
        playing: true,
        positionSec: 3.25,
      },
    });

    expect(payload.memberId).toBe('member-a');
    expect(payload.memberName).toBe('A'.repeat(MAX_MEMBER_NAME_LENGTH));
    expect(payload.initialPlayback.mediaId).toBe('abc123');
    expect(payload.initialPlayback.title).toBe('T'.repeat(MAX_TITLE_LENGTH));
  });

  it('normalizes join requests and falls back blank member names to Guest', () => {
    const payload = joinRoomRequestSchema.parse({
      roomCode: ' ab12cd ',
      memberId: 'member-a',
      memberName: '\u0000\t ',
    });

    expect(payload.roomCode).toBe('AB12CD');
    expect(payload.memberName).toBe('Guest');
  });

  it('rejects malformed playback updates', () => {
    const result = playbackUpdateRequestSchema.safeParse({
      update: {
        serviceId: 'youtube',
        mediaId: 'abc123',
        playing: true,
        positionSec: Number.POSITIVE_INFINITY,
        clientSequence: 0,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects playback updates with oversized positions', () => {
    const result = playbackUpdateRequestSchema.safeParse({
      update: {
        serviceId: 'youtube',
        mediaId: 'abc123',
        playing: true,
        positionSec: 1e308,
        clientSequence: 0,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects unexpected identity fields on leave requests', () => {
    const result = leaveRoomRequestSchema.safeParse({
      roomCode: 'AB12CD',
      memberId: 'member-a',
    });

    expect(result.success).toBe(false);
  });

  it('sanitizes member names consistently', () => {
    expect(sanitizeMemberName('\u0000 \n ')).toBe('Guest');
    expect(sanitizeMemberName(` ${'B'.repeat(MAX_MEMBER_NAME_LENGTH + 5)} `)).toBe(
      'B'.repeat(MAX_MEMBER_NAME_LENGTH),
    );
  });

  it('caps resolved playback positions to the shared maximum', () => {
    const room = createRoomState(
      'ROOM08',
      {
        memberId: 'member-a',
        memberName: 'Member A',
        serviceId: 'netflix',
        initialPlayback: {
          serviceId: 'netflix',
          mediaId: '123',
          title: 'Example',
          positionSec: MAX_PLAYBACK_POSITION_SEC - 1,
          playing: true,
        },
      },
      1_000,
    );

    const playback = resolvePlaybackState(room.playback, 5_000);
    expect(playback.positionSec).toBe(MAX_PLAYBACK_POSITION_SEC);
  });

  it('clears per-member client sequence state when removing a member', () => {
    const room = createRoomState('ROOM09', {
      memberId: 'member-a',
      memberName: 'Member A',
      serviceId: 'youtube',
      initialPlayback: {
        serviceId: 'youtube',
        mediaId: 'abc123',
        title: 'Clip',
        positionSec: 4,
        playing: true,
      },
    });

    upsertRoomMember(room, 'member-a', 'Member A');

    applyPlaybackUpdate(
      room,
      {
        serviceId: 'youtube',
        mediaId: 'abc123',
        title: 'Clip',
        positionSec: 5,
        playing: true,
        clientSequence: 3,
      },
      'member-a',
      2_000,
    );

    expect(room.lastPlaybackClientSequenceByMember.get('member-a')).toBe(3);

    expect(removeRoomMember(room, 'member-a')).toBe(true);
    expect(room.lastPlaybackClientSequenceByMember.has('member-a')).toBe(false);
  });
});
