import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@open-watch-party/shared';

import type { RealtimeState } from './socket-handlers';

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export type RoomSweeperOptions = {
  idleTtlMs: number;
  now?: () => number;
};

export function sweepIdleRooms(
  io: RealtimeServer,
  state: RealtimeState,
  options: RoomSweeperOptions,
): string[] {
  const now = options.now ?? Date.now;
  const cutoff = now() - options.idleTtlMs;
  const expiredRoomCodes = state.roomStore.listIdle(cutoff).map((record) => record.room.roomCode);

  for (const roomCode of expiredRoomCodes) {
    io.socketsLeave(roomCode);
    state.removeRoom(roomCode);
  }

  return expiredRoomCodes;
}

export function startRoomSweeper(
  io: RealtimeServer,
  state: RealtimeState,
  sweepIntervalMs: number,
  options: RoomSweeperOptions,
): NodeJS.Timeout {
  return setInterval(() => {
    sweepIdleRooms(io, state, options);
  }, sweepIntervalMs);
}
