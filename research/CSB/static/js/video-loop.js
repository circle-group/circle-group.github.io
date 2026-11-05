const initializedVideos = new WeakSet();

// Opt any video into delayed looping with data-loop-delay-ms="500" (milliseconds).
export function setupDelayedVideoLoops(root = document) {
  root.querySelectorAll('video[data-loop-delay-ms]').forEach((video) => {
    const setting = video.dataset.loopDelayMs.trim();
    const delay = Number(setting);
    if (!setting || !Number.isFinite(delay) || delay < 0 || initializedVideos.has(video)) return;

    initializedVideos.add(video);
    video.loop = false;
    let restartTimer;

    const cancelRestart = () => {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    };

    video.addEventListener('ended', () => {
      cancelRestart();
      restartTimer = setTimeout(() => {
        restartTimer = undefined;
        if (!video.isConnected || !video.ended) return;

        video.currentTime = 0;
        // Browser playback restrictions can still require the viewer to press play.
        video.play().catch(() => {});
      }, delay);
    });

    // A manual replay, seek, or source change takes precedence over a pending restart.
    ['play', 'seeking', 'emptied', 'error'].forEach((event) => {
      video.addEventListener(event, cancelRestart);
    });
  });
}
