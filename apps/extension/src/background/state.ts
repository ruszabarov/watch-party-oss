import { createStore } from '@xstate/store';
import type { PartySnapshot } from '@open-watch-party/shared';
import type { StreamingServiceId } from '@open-watch-party/shared';

export type SessionInfo = {
  readonly roomCode: string;
  readonly memberId: string;
  readonly streamingServiceId: StreamingServiceId;
};

export type BackgroundState = {
  readonly session: SessionInfo | undefined;
  readonly room: PartySnapshot | undefined;
  readonly controlledTab: {
    readonly tabId: number;
    readonly mediaId: string;
  } | null;
  readonly lastError: string | null;
  readonly lastWarning: string | null;
};

function updateSessionRoom(state: BackgroundState, room: PartySnapshot): BackgroundState {
  if (!state.session) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      roomCode: room.roomCode,
      streamingServiceId: room.streamingServiceId,
    },
    room,
    lastWarning: null,
  };
}

const initialBackgroundState: BackgroundState = {
  session: undefined,
  room: undefined,
  controlledTab: null,
  lastError: null,
  lastWarning: null,
};

export const backgroundStore = createStore({
  context: initialBackgroundState,
  emits: {
    controlledTabClosed: () => {},
    controlledTabMediaSwitchRequested: (_payload: { mediaId: string }) => {},
    roomSnapshotChanged: () => {},
  },
  on: {
    setControlledTab: (
      state,
      event: {
        tabId: number;
        mediaId: string;
        requestMediaSwitch?: boolean;
      },
      enqueue,
    ): BackgroundState => {
      if (event.requestMediaSwitch) {
        enqueue.emit.controlledTabMediaSwitchRequested({ mediaId: event.mediaId });
      }

      return {
        ...state,
        controlledTab: {
          tabId: event.tabId,
          mediaId: event.mediaId,
        },
      };
    },

    clearControlledTab: (state): BackgroundState => ({
      ...state,
      controlledTab: null,
    }),

    closeControlledTab: (state, _event, enqueue): BackgroundState => {
      enqueue.emit.controlledTabClosed();

      return {
        ...state,
        controlledTab: null,
      };
    },

    setJoinedSession: (
      state,
      event: {
        session: SessionInfo;
        room: PartySnapshot;
        applySnapshotToControlledTab?: boolean;
      },
      enqueue,
    ): BackgroundState => {
      if (event.applySnapshotToControlledTab) {
        enqueue.emit.roomSnapshotChanged();
      }

      return {
        ...state,
        session: event.session,
        room: event.room,
        lastError: null,
      };
    },

    setSessionError: (
      state,
      event: { message: string; clearSession?: boolean },
    ): BackgroundState => ({
      ...state,
      session: event.clearSession ? undefined : state.session,
      room: event.clearSession ? undefined : state.room,
      lastError: event.message,
    }),

    leaveRoom: (state): BackgroundState => ({
      ...state,
      session: undefined,
      room: undefined,
      controlledTab: null,
      lastError: null,
      lastWarning: null,
    }),

    updateSessionRoom: (
      state,
      event: { room: PartySnapshot; applySnapshotToControlledTab?: boolean },
      enqueue,
    ): BackgroundState => {
      if (event.applySnapshotToControlledTab) {
        enqueue.emit.roomSnapshotChanged();
      }

      return updateSessionRoom(state, event.room);
    },

    reportError: (state, event: { message: string }): BackgroundState => ({
      ...state,
      lastError: event.message,
    }),

    setLastWarning: (state, event: { message: string | null }): BackgroundState => ({
      ...state,
      lastWarning: event.message,
    }),
  },
});

export const backgroundSelectors = {
  session: backgroundStore.select((s) => s.session),
  room: backgroundStore.select((s) => s.room),
  controlledTab: backgroundStore.select((s) => s.controlledTab),
};
