"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { truckCameraLabel } from "../lib/linxup-truck-label";
import styles from "./TruckCameraController.module.css";

type CameraOrientation = "outside" | "inside" | "aux";
type CameraStream = {
  truck: number;
  label: string;
  channels: Partial<Record<CameraOrientation, string>>;
  startedAt: string;
  durationSeconds: number;
};
type CameraState =
  | { status: "closed" }
  | { status: "loading"; truck: number }
  | { status: "playing"; stream: CameraStream }
  | { status: "ended"; stream: CameraStream }
  | { status: "error"; truck: number; message: string; code?: string };

const ORIENTATION_LABELS: Record<CameraOrientation, string> = {
  outside: "Outside",
  inside: "Inside",
  aux: "Aux",
};

function cameraElementFromTarget(target: EventTarget | null): { element: HTMLElement; truck: number } | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest(".ops-truck-camera-dialog")) return null;

  const explicit = target.closest<HTMLElement>("[data-truck-camera]");
  const explicitTruck = explicit ? Number(explicit.dataset.truckCamera) : NaN;
  if (explicit && Number.isInteger(explicitTruck) && explicitTruck > 0) {
    return { element: explicit, truck: explicitTruck };
  }
  return null;
}

function VideoPlayer({ url, onPlaybackError }: { url: string; onPlaybackError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let destroyHls: (() => void) | null = null;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      void video.play().catch(() => undefined);
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          onPlaybackError("This browser cannot play the LinxUp live stream.");
          return;
        }
        const hls = new Hls({ liveDurationInfinity: true, enableWorker: true });
        destroyHls = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) onPlaybackError("The LinxUp stream stopped unexpectedly.");
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
      }).catch(() => onPlaybackError("The LinxUp stream could not be loaded."));
    }

    return () => {
      disposed = true;
      destroyHls?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [onPlaybackError, url]);

  return <video ref={videoRef} className={styles.video} controls playsInline muted autoPlay />;
}

export default function TruckCameraController({ children, className = "ops-app" }: { children: ReactNode; className?: string }) {
  const [camera, setCamera] = useState<CameraState>({ status: "closed" });
  const [orientation, setOrientation] = useState<CameraOrientation>("outside");
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const requestSequence = useRef(0);
  const cameraRef = useRef(camera);
  const orientationRef = useRef(orientation);
  cameraRef.current = camera;
  orientationRef.current = orientation;

  const stopStream = useCallback((state: CameraState, keepalive = false) => {
    if (state.status !== "playing" && state.status !== "ended") return;
    void fetch("/api/linxup/live-camera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "stop",
        truck: state.stream.truck,
        channel: orientationRef.current,
      }),
      keepalive,
    }).catch(() => undefined);
  }, []);

  const openCamera = useCallback(async (truck: number) => {
    const sequence = ++requestSequence.current;
    stopStream(cameraRef.current, true);
    setCamera({ status: "loading", truck });
    setOrientation("outside");
    setSecondsRemaining(60);

    try {
      const response = await fetch("/api/linxup/live-camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", truck }),
      });
      const payload = await response.json() as CameraStream & { error?: string; code?: string };
      if (sequence !== requestSequence.current) {
        if (response.ok && payload.channels) stopStream({ status: "playing", stream: payload }, true);
        return;
      }
      if (!response.ok) throw Object.assign(new Error(payload.error || "Live video could not start."), { code: payload.code });
      const available = Object.keys(payload.channels) as CameraOrientation[];
      setOrientation(available.includes("outside") ? "outside" : available[0]);
      setSecondsRemaining(payload.durationSeconds || 60);
      setCamera({ status: "playing", stream: payload });
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      const value = error as Error & { code?: string };
      setCamera({ status: "error", truck, message: value.message, code: value.code });
    }
  }, [stopStream]);

  const closeCamera = useCallback(() => {
    requestSequence.current += 1;
    stopStream(cameraRef.current, true);
    setCamera({ status: "closed" });
  }, [stopStream]);

  const handlePlaybackError = useCallback((message: string) => {
    const current = cameraRef.current;
    if (current.status !== "playing") return;
    stopStream(current, true);
    setCamera({ status: "error", truck: current.stream.truck, message });
  }, [stopStream]);

  const handleTruckClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const match = cameraElementFromTarget(event.target);
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    void openCamera(match.truck);
  }, [openCamera]);

  const handleTruckPointerOver = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const match = cameraElementFromTarget(event.target);
    if (!match) return;
    match.element.classList.add(styles.cameraTarget);
    match.element.title = `Open ${truckCameraLabel(match.truck)} live camera`;
  }, []);

  useEffect(() => {
    if (camera.status !== "playing") return;
    const timer = window.setInterval(() => {
      setSecondsRemaining((current) => {
        if (current > 1) return current - 1;
        window.clearInterval(timer);
        setCamera((state) => {
          if (state.status !== "playing") return state;
          stopStream(state, true);
          return { status: "ended", stream: state.stream };
        });
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [camera.status, stopStream]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && cameraRef.current.status !== "closed") closeCamera();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeCamera]);

  useEffect(() => () => { requestSequence.current += 1; stopStream(cameraRef.current, true); }, [stopStream]);

  const activeStream = camera.status === "playing" || camera.status === "ended" ? camera.stream : null;
  const channels = useMemo(() => activeStream
    ? (Object.keys(activeStream.channels) as CameraOrientation[])
    : [], [activeStream]);
  const streamUrl = activeStream?.channels[orientation];
  const truck = camera.status === "closed" ? null
    : camera.status === "playing" || camera.status === "ended" ? camera.stream.truck
      : camera.truck;

  return (
    <div
      className={`${className} ${styles.root}`}
      data-truck-camera-controller="ready"
      onClickCapture={handleTruckClick}
      onPointerOverCapture={handleTruckPointerOver}
    >
      {children}
      {camera.status !== "closed" ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCamera();
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={`${truckCameraLabel(truck || 0)} live camera`}>
        <header className={styles.header}>
          <div>
            <div className="ops-eyebrow">LinxUp live camera</div>
            <h2>{truckCameraLabel(truck || 0)}</h2>
          </div>
          <button type="button" className={styles.close} onClick={closeCamera} aria-label="Close live camera">×</button>
        </header>

        {camera.status === "loading" ? (
          <div className={styles.message} aria-live="polite">
            <span className={styles.spinner} />
            <strong>Connecting to {truckCameraLabel(camera.truck)}…</strong>
            <span>This can take up to 20 seconds.</span>
          </div>
        ) : null}

        {camera.status === "error" ? (
          <div className={`${styles.message} ${styles.error}`} role="alert">
            <strong>Live view unavailable</strong>
            <span>{camera.message}</span>
            {camera.code === "NOT_CONFIGURED" || camera.code === "NOT_AUTHENTICATED" ? (
              <span className={styles.help}>The LinxUp sign-in needs to be reconnected on Mission Control.</span>
            ) : null}
            <button type="button" className="ops-button" onClick={() => void openCamera(camera.truck)}>Try again</button>
          </div>
        ) : null}

        {activeStream ? (
          <>
            <div className={styles.stage}>
              {camera.status === "playing" && streamUrl ? (
                <VideoPlayer
                  key={streamUrl}
                  url={streamUrl}
                  onPlaybackError={handlePlaybackError}
                />
              ) : (
                <div className={styles.message}>
                  <strong>Live view ended</strong>
                  <span>LinxUp limits each live session to one minute.</span>
                  <button type="button" className="ops-button" onClick={() => void openCamera(activeStream.truck)}>Continue live view</button>
                </div>
              )}
            </div>
            <footer className={styles.footer}>
              <div className={styles.channels} aria-label="Camera view">
                {channels.map((channel) => (
                  <button
                    type="button"
                    key={channel}
                    className={orientation === channel ? styles.active : ""}
                    onClick={() => setOrientation(channel)}
                    disabled={camera.status !== "playing"}
                  >
                    {ORIENTATION_LABELS[channel]}
                  </button>
                ))}
              </div>
              <div className={styles.timer} aria-live="off">
                <span className="ops-pulse" />
                {camera.status === "playing" ? `Live · 0:${String(secondsRemaining).padStart(2, "0")}` : "Session complete"}
              </div>
            </footer>
          </>
        ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
