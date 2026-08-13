"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { parseTruckNumberFromLabel, truckCameraLabel } from "@/lib/linxup-truck-label";

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
  if (target.closest("input, select, textarea, option, [contenteditable='true']")) return null;

  const explicit = target.closest<HTMLElement>("[data-truck-camera]");
  const explicitTruck = explicit ? Number(explicit.dataset.truckCamera) : NaN;
  if (explicit && Number.isInteger(explicitTruck) && explicitTruck > 0) {
    return { element: explicit, truck: explicitTruck };
  }

  let candidate: HTMLElement | null = target;
  for (let depth = 0; candidate && depth < 4; depth += 1, candidate = candidate.parentElement) {
    const truck = parseTruckNumberFromLabel(candidate.textContent);
    if (truck) return { element: candidate, truck };
  }
  return null;
}

function VideoPlayer({ url, onPlaybackError }: { url: string; onPlaybackError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      void video.play().catch(() => undefined);
    } else if (Hls.isSupported()) {
      hls = new Hls({ liveDurationInfinity: true, enableWorker: true });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onPlaybackError("The LinxUp stream stopped unexpectedly.");
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
    } else {
      onPlaybackError("This browser cannot play the LinxUp live stream.");
    }

    return () => {
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [onPlaybackError, url]);

  return <video ref={videoRef} className="ops-truck-camera-video" controls playsInline muted autoPlay />;
}

export default function TruckCameraController() {
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
      if (sequence !== requestSequence.current) return;
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

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.button !== 0) return;
      const match = cameraElementFromTarget(event.target);
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      void openCamera(match.truck);
    }

    function handlePointerOver(event: PointerEvent) {
      const match = cameraElementFromTarget(event.target);
      if (!match) return;
      match.element.classList.add("ops-truck-camera-target");
      match.element.title = `Open ${truckCameraLabel(match.truck)} live camera`;
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("pointerover", handlePointerOver, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("pointerover", handlePointerOver, true);
    };
  }, [openCamera]);

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

  useEffect(() => () => stopStream(cameraRef.current, true), [stopStream]);

  const activeStream = camera.status === "playing" || camera.status === "ended" ? camera.stream : null;
  const channels = useMemo(() => activeStream
    ? (Object.keys(activeStream.channels) as CameraOrientation[])
    : [], [activeStream]);
  const streamUrl = activeStream?.channels[orientation];
  const truck = camera.status === "closed" ? null
    : camera.status === "playing" || camera.status === "ended" ? camera.stream.truck
      : camera.truck;

  if (camera.status === "closed") return null;

  return (
    <div className="ops-truck-camera-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeCamera();
    }}>
      <section className="ops-truck-camera-dialog" role="dialog" aria-modal="true" aria-label={`${truckCameraLabel(truck || 0)} live camera`}>
        <header className="ops-truck-camera-header">
          <div>
            <div className="ops-eyebrow">LinxUp live camera</div>
            <h2>{truckCameraLabel(truck || 0)}</h2>
          </div>
          <button type="button" className="ops-truck-camera-close" onClick={closeCamera} aria-label="Close live camera">×</button>
        </header>

        {camera.status === "loading" ? (
          <div className="ops-truck-camera-message" aria-live="polite">
            <span className="ops-truck-camera-spinner" />
            <strong>Connecting to {truckCameraLabel(camera.truck)}…</strong>
            <span>This can take up to 20 seconds.</span>
          </div>
        ) : null}

        {camera.status === "error" ? (
          <div className="ops-truck-camera-message is-error" role="alert">
            <strong>Live view unavailable</strong>
            <span>{camera.message}</span>
            {camera.code === "NOT_CONFIGURED" || camera.code === "NOT_AUTHENTICATED" ? (
              <span className="ops-truck-camera-help">The LinxUp sign-in needs to be reconnected on Mission Control.</span>
            ) : null}
            <button type="button" className="ops-button" onClick={() => void openCamera(camera.truck)}>Try again</button>
          </div>
        ) : null}

        {activeStream ? (
          <>
            <div className="ops-truck-camera-stage">
              {camera.status === "playing" && streamUrl ? (
                <VideoPlayer
                  key={streamUrl}
                  url={streamUrl}
                  onPlaybackError={handlePlaybackError}
                />
              ) : (
                <div className="ops-truck-camera-message">
                  <strong>Live view ended</strong>
                  <span>LinxUp limits each live session to one minute.</span>
                  <button type="button" className="ops-button" onClick={() => void openCamera(activeStream.truck)}>Continue live view</button>
                </div>
              )}
            </div>
            <footer className="ops-truck-camera-footer">
              <div className="ops-truck-camera-channels" aria-label="Camera view">
                {channels.map((channel) => (
                  <button
                    type="button"
                    key={channel}
                    className={orientation === channel ? "is-active" : ""}
                    onClick={() => setOrientation(channel)}
                    disabled={camera.status !== "playing"}
                  >
                    {ORIENTATION_LABELS[channel]}
                  </button>
                ))}
              </div>
              <div className="ops-truck-camera-timer" aria-live="off">
                <span className="ops-pulse" />
                {camera.status === "playing" ? `Live · 0:${String(secondsRemaining).padStart(2, "0")}` : "Session complete"}
              </div>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
