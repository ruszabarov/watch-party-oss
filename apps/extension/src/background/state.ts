import { createStore } from '@xstate/store';
import type { PartySnapshot } from '@open-watch-party/shared';
import type { ServiceId } from '@open-watch-party/shared';
import type { WatchPageContext } from '../messaging';

export type SessionInfo = {
  readonly roomCode: string;
  readonly memberId: string;
  readonly serviceId: ServiceId;
};

export type BackgroundState = {
  readonly session: SessionInfo | undefined;
  readonly room: PartySnapshot | undefined;
  readonly controlledTab: {
    readonly tabId: number;
    readonly context: WatchPageContext;
  } | null;
  readonly lastError: string | null;
  readonly lastWarning: string | null;
};

export function createBackgroundState(): BackgroundState {
  return {
    session: undefined,
    room: undefined,
    controlledTab: null,
    lastError: null,
    lastWarning: null,
  };
}

function updateSessionRoom(state: BackgroundState, room: PartySnapshot): BackgroundState {
  if (!state.session) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      roomCode: room.roomCode,
      serviceId: room.serviceId,
    },
    room,
    lastWarning: null,
  };
}

export function createBackgroundStore() {
  return createStore({
    context: createBackgroundState(),
    emits: {
      controlledTabClosed: () => {},
      controlledTabMediaSwitchRequested: (_payload: { context: WatchPageContext }) => {},
      roomSnapshotChanged: () => {},
    },
    on: {
      setControlledTab: (
        state,
        event: {
          tabId: number;
          context: WatchPageContext;
          requestMediaSwitch?: boolean;
        },
        enqueue,
      ) => {
        if (event.requestMediaSwitch) {
          enqueue.emit.controlledTabMediaSwitchRequested({ context: event.context });
        }

        return {
          ...state,
          controlledTab: {
            tabId: event.tabId,
            context: event.context,
          },
        };
      },

      clearControlledTab: (state) => ({
        ...state,
        controlledTab: null,
      }),

      closeControlledTab: (state, _event, enqueue) => {
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
      ) => {
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

      setSessionError: (state, event: { message: string; clearSession?: boolean }) => ({
        ...state,
        session: event.clearSession ? undefined : state.session,
        room: event.clearSession ? undefined : state.room,
        lastError: event.message,
      }),

      leaveRoom: (state) => ({
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
      ) => {
        if (event.applySnapshotToControlledTab) {
          enqueue.emit.roomSnapshotChanged();
        }

        return updateSessionRoom(state, event.room);
      },

      reportError: (state, event: { message: string }) => ({
        ...state,
        lastError: event.message,
      }),

      setLastWarning: (state, event: { message: string | null }) => ({
        ...state,
        lastWarning: event.message,
      }),
    },
  });
}

export type BackgroundStore = ReturnType<typeof createBackgroundStore>;
