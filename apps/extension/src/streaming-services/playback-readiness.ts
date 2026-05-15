const HAVE_METADATA_READY_STATE = 1;

type TimelineCandidate = Pick<HTMLMediaElement, 'currentTime' | 'readyState'>;

export function isVideoTimelineReady(video: TimelineCandidate | null): video is TimelineCandidate {
  return (
    video !== null &&
    video.readyState >= HAVE_METADATA_READY_STATE &&
    Number.isFinite(video.currentTime)
  );
}
