"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FeedAppointment = {
  id: string;
  appointmentId: string;
  jobNumber: string;
  customerName: string;
  address: string;
  appointmentTime: string;
  appointmentType: string;
  assignedTruck: string;
  href: string;
};

type AppointmentFeed = {
  date: string;
  generatedAt: string | null;
  appointments: FeedAppointment[];
};

type TruckProximity = {
  miles: number | null;
  travelMinutes: number | null;
  status: string;
  source: "google_live_traffic" | "estimated";
  gpsFreshness: string;
  gpsUpdatedAt: string | null;
};

type StoredNotification = FeedAppointment & {
  notificationId: string;
  date: string;
  detectedAt: string;
  nearestTruck: string | null;
  nearestMiles: number | null;
  nearestTravelMinutes: number | null;
  proximitySource: "google_live_traffic" | "estimated" | null;
  gpsFreshness: string | null;
  read: boolean;
};

type NotificationState = {
  knownByDate: Record<string, string[]>;
  notifications: StoredNotification[];
  lastCheckedAt: string | null;
};

const EMPTY_STATE: NotificationState = {
  knownByDate: {},
  notifications: [],
  lastCheckedAt: null,
};
const POLL_INTERVAL_MS = 45_000;
const MAX_NOTIFICATIONS = 50;
const MAX_KNOWN_DATES = 8;

function safeStoredState(value: string | null): NotificationState {
  if (!value) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(value);
    return {
      knownByDate: parsed?.knownByDate && typeof parsed.knownByDate === "object" ? parsed.knownByDate : {},
      notifications: Array.isArray(parsed?.notifications) ? parsed.notifications.slice(0, MAX_NOTIFICATIONS) : [],
      lastCheckedAt: typeof parsed?.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function trimKnownDates(knownByDate: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(knownByDate)
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, MAX_KNOWN_DATES),
  );
}

function travelTimeLabel(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "drive time unavailable";
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min drive`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${hours} hr ${remainder} min drive` : `${hours} hr drive`;
}

function nearestLabel(notification: StoredNotification): string {
  if (!notification.nearestTruck || notification.nearestMiles == null) return "Closest truck unavailable";
  const prefix = notification.proximitySource === "google_live_traffic" ? "" : "~";
  return `${notification.nearestTruck} is closest · ${prefix}${notification.nearestMiles.toFixed(1)} mi · ${travelTimeLabel(notification.nearestTravelMinutes)}`;
}

function detectedTime(value: string): string {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(stamp);
}

function nearestForAppointment(
  appointmentId: string,
  distances: Record<string, Record<string, TruckProximity>>,
): { truck: string; proximity: TruckProximity } | null {
  const options = Object.entries(distances?.[appointmentId] || {})
    .filter(([, proximity]) => proximity?.status === "available" && proximity.miles != null)
    .sort(([, left], [, right]) => Number(left.miles) - Number(right.miles));
  if (!options.length) return null;
  return { truck: options[0][0], proximity: options[0][1] };
}

export default function AddOnNotifications({ sessionEmail }: { sessionEmail?: string | null }) {
  const storageKey = useMemo(
    () => `opscenter:add-on-notifications:v1:${encodeURIComponent(String(sessionEmail || "session").toLowerCase())}`,
    [sessionEmail],
  );
  const [state, setState] = useState<NotificationState>(EMPTY_STATE);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [visibleToasts, setVisibleToasts] = useState<string[]>([]);
  const [feedAvailable, setFeedAvailable] = useState(true);
  const stateRef = useRef<NotificationState>(EMPTY_STATE);
  const pollingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toastTimersRef = useRef<number[]>([]);

  const saveState = useCallback((next: NotificationState) => {
    stateRef.current = next;
    setState(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Keep notifications working in memory if browser storage is unavailable.
    }
  }, [storageKey]);

  function markAllRead() {
    const current = stateRef.current;
    if (!current.notifications.some((notification) => !notification.read)) return;
    saveState({
      ...current,
      notifications: current.notifications.map((notification) => ({ ...notification, read: true })),
    });
  }

  function markRead(notificationId: string) {
    const current = stateRef.current;
    saveState({
      ...current,
      notifications: current.notifications.map((notification) =>
        notification.notificationId === notificationId ? { ...notification, read: true } : notification,
      ),
    });
    setOpen(false);
  }

  useEffect(() => {
    let stored = EMPTY_STATE;
    try {
      stored = safeStoredState(window.localStorage.getItem(storageKey));
    } catch {
      stored = EMPTY_STATE;
    }
    stateRef.current = stored;
    setState(stored);
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    let active = true;

    async function checkForAddOns() {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const response = await fetch("/api/add-on-notifications", { cache: "no-store" });
        const feed = await response.json().catch(() => null) as AppointmentFeed | null;
        if (!response.ok || !feed?.date || !Array.isArray(feed.appointments)) {
          throw new Error("Appointment feed unavailable");
        }
        if (!active) return;
        setFeedAvailable(true);

        const current = stateRef.current;
        const hasBaseline = Object.prototype.hasOwnProperty.call(current.knownByDate, feed.date);
        const feedIds = feed.appointments.map((appointment) => appointment.id);
        if (!hasBaseline) {
          saveState({
            ...current,
            knownByDate: trimKnownDates({ ...current.knownByDate, [feed.date]: feedIds }),
            lastCheckedAt: new Date().toISOString(),
          });
          return;
        }

        const knownIds = new Set(current.knownByDate[feed.date] || []);
        const additions = feed.appointments.filter((appointment) => !knownIds.has(appointment.id));
        if (!additions.length) {
          const mergedIds = Array.from(new Set([...knownIds, ...feedIds]));
          saveState({
            ...current,
            knownByDate: trimKnownDates({ ...current.knownByDate, [feed.date]: mergedIds }),
            lastCheckedAt: new Date().toISOString(),
          });
          return;
        }

        let distances: Record<string, Record<string, TruckProximity>> = {};
        const locatedAdditions = additions
          .filter((appointment) => appointment.address && appointment.address !== "Address unavailable")
          .slice(0, 40);
        if (locatedAdditions.length) {
          try {
            const proximityResponse = await fetch("/api/job-route-proximity", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                date: feed.date,
                jobs: locatedAdditions.map((appointment) => ({
                  jobKey: appointment.id,
                  address: appointment.address,
                })),
              }),
            });
            const proximityPayload = await proximityResponse.json().catch(() => null);
            if (proximityResponse.ok && proximityPayload?.distances) distances = proximityPayload.distances;
          } catch {
            // The add-on alert is still useful when routing or GPS is temporarily unavailable.
          }
        }
        if (!active) return;

        const detectedAt = new Date().toISOString();
        const newNotifications = additions.map((appointment): StoredNotification => {
          const nearest = nearestForAppointment(appointment.id, distances);
          return {
            ...appointment,
            notificationId: `${feed.date}|${appointment.id}`,
            date: feed.date,
            detectedAt,
            nearestTruck: nearest?.truck || null,
            nearestMiles: nearest?.proximity.miles ?? null,
            nearestTravelMinutes: nearest?.proximity.travelMinutes ?? null,
            proximitySource: nearest?.proximity.source || null,
            gpsFreshness: nearest?.proximity.gpsFreshness || null,
            read: false,
          };
        });
        const latest = stateRef.current;
        const next: NotificationState = {
          knownByDate: trimKnownDates({
            ...latest.knownByDate,
            [feed.date]: Array.from(new Set([...(latest.knownByDate[feed.date] || []), ...feedIds])),
          }),
          notifications: [...newNotifications, ...latest.notifications]
            .filter((notification, index, all) =>
              all.findIndex((candidate) => candidate.notificationId === notification.notificationId) === index,
            )
            .slice(0, MAX_NOTIFICATIONS),
          lastCheckedAt: detectedAt,
        };
        saveState(next);
        const toastIds = newNotifications.slice(0, 3).map((notification) => notification.notificationId);
        setVisibleToasts(toastIds);
        const timer = window.setTimeout(() => setVisibleToasts([]), 12_000);
        toastTimersRef.current.push(timer);
      } catch {
        if (active) setFeedAvailable(false);
      } finally {
        pollingRef.current = false;
      }
    }

    void checkForAddOns();
    const timer = window.setInterval(() => void checkForAddOns(), POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void checkForAddOns();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [ready, saveState]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (open && rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const toastTimers = toastTimersRef.current;
    return () => {
      for (const timer of toastTimers) window.clearTimeout(timer);
    };
  }, []);

  const unreadCount = state.notifications.filter((notification) => !notification.read).length;
  const toastNotifications = visibleToasts
    .map((notificationId) => state.notifications.find((notification) => notification.notificationId === notificationId))
    .filter((notification): notification is StoredNotification => Boolean(notification));

  return (
    <>
      <div className="ops-notification-center" ref={rootRef}>
        <button
          type="button"
          className={`ops-notification-trigger${open ? " is-open" : ""}${!feedAvailable ? " is-offline" : ""}`}
          aria-label={`Add-on notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={feedAvailable ? "Add-on notifications" : "Notifications will reconnect automatically"}
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) {
              markAllRead();
              setVisibleToasts([]);
            }
          }}
        >
          <span className="ops-notification-bell" aria-hidden="true">●</span>
          <span className="ops-notification-trigger-label">Alerts</span>
          {unreadCount ? <span className="ops-notification-count">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
        </button>

        {open ? (
          <div className="ops-notification-panel" role="dialog" aria-label="Add-on notifications">
            <div className="ops-notification-panel-head">
              <div>
                <span>Dispatch alerts</span>
                <strong>Add-on appointments</strong>
              </div>
              <span className={`ops-notification-feed-state${feedAvailable ? "" : " unavailable"}`}>
                {feedAvailable ? "Watching live" : "Reconnecting"}
              </span>
            </div>
            <div className="ops-notification-list">
              {state.notifications.length ? state.notifications.map((notification) => (
                <Link
                  href={notification.href}
                  key={notification.notificationId}
                  className={`ops-notification-item${notification.read ? "" : " is-unread"}`}
                  onClick={() => markRead(notification.notificationId)}
                >
                  <div className="ops-notification-item-top">
                    <strong>New add-on · {notification.jobNumber}</strong>
                    <time>{detectedTime(notification.detectedAt)}</time>
                  </div>
                  <div className="ops-notification-customer">{notification.customerName} · {notification.appointmentTime}</div>
                  <div className="ops-notification-nearest">{nearestLabel(notification)}</div>
                  <div className="ops-notification-address">{notification.address}</div>
                </Link>
              )) : (
                <div className="ops-notification-empty">
                  <strong>No add-ons yet</strong>
                  <span>New appointments will appear here with the closest current truck.</span>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {toastNotifications.length ? (
        <div className="ops-notification-toasts" aria-live="assertive">
          {toastNotifications.map((notification) => (
            <Link
              href={notification.href}
              key={notification.notificationId}
              className="ops-add-on-toast"
              onClick={() => {
                markRead(notification.notificationId);
                setVisibleToasts((current) => current.filter((id) => id !== notification.notificationId));
              }}
            >
              <span className="ops-add-on-toast-kicker">New add-on appointment</span>
              <strong>{notification.jobNumber} · {notification.customerName}</strong>
              <span>{notification.appointmentTime}</span>
              <span className="ops-add-on-toast-nearest">{nearestLabel(notification)}</span>
              <small>Open appointment →</small>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
