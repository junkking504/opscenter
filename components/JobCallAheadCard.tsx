"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { JobCallAheadStatus } from "@/lib/job-call-ahead";

type MenuPosition = { left: number; top: number };
const APPOINTMENT_SELECTION_EVENT = "ops:select-appointment";
const APPOINTMENT_ON_SITE_EVENT = "ops:appointment-on-site";
const NO_TRUCKS_ON_SITE: string[] = [];

export default function JobCallAheadCard({
  children,
  date,
  jobKey,
  initialStatus,
  articleId,
  isCanceled = false,
  isCompleted = false,
  trucksOnSite = NO_TRUCKS_ON_SITE,
}: {
  children: ReactNode;
  date: string;
  jobKey: string;
  initialStatus?: JobCallAheadStatus;
  articleId: string;
  isCanceled?: boolean;
  isCompleted?: boolean;
  trucksOnSite?: string[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<JobCallAheadStatus | undefined>(initialStatus);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [promoted, setPromoted] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<HTMLElement | null>(null);
  const [canceledDetailsOpen, setCanceledDetailsOpen] = useState(false);
  const [onSiteTrucks, setOnSiteTrucks] = useState(trucksOnSite);
  const onSite = onSiteTrucks.length > 0;

  useEffect(() => setOnSiteTrucks(trucksOnSite), [trucksOnSite]);

  useEffect(() => {
    setSelectedSlot(document.getElementById("jobs-selected-appointment-slot"));
    const handleSelection = (event: Event) => {
      const selectedId = (event as CustomEvent<{ articleId?: string }>).detail?.articleId || "";
      setPromoted(selectedId === articleId);
    };
    window.addEventListener(APPOINTMENT_SELECTION_EVENT, handleSelection);
    return () => window.removeEventListener(APPOINTMENT_SELECTION_EVENT, handleSelection);
  }, [articleId]);

  useEffect(() => {
    const handleOnSiteStatus = (event: Event) => {
      const statuses = (event as CustomEvent<{ statuses?: Record<string, string[]> }>).detail?.statuses;
      if (statuses && articleId in statuses) setOnSiteTrucks(statuses[articleId] || NO_TRUCKS_ON_SITE);
    };
    window.addEventListener(APPOINTMENT_ON_SITE_EVENT, handleOnSiteStatus);
    return () => window.removeEventListener(APPOINTMENT_ON_SITE_EVENT, handleOnSiteStatus);
  }, [articleId]);

  useEffect(() => {
    if (!promoted) return;
    if (isCanceled) setCanceledDetailsOpen(true);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(articleId)?.querySelectorAll<HTMLDetailsElement>("details").forEach((details) => {
        details.open = true;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [articleId, isCanceled, promoted]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  async function save(nextStatus: JobCallAheadStatus) {
    if (saving || nextStatus === status) {
      setMenu(null);
      return;
    }
    const previousStatus = status;
    setStatus(nextStatus);
    setSaving(true);
    setError("");
    setMenu(null);
    try {
      const response = await fetch("/api/job-call-ahead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, jobKey, status: nextStatus }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "The call-ahead status could not be saved.");
      }
      router.refresh();
    } catch (saveError) {
      setStatus(previousStatus);
      setError(saveError instanceof Error ? saveError.message : "The call-ahead status could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const label = status === "called"
    ? "Office called"
    : status === "not_called"
      ? "Not called yet"
      : "Call-ahead not set";

  const canceledCollapsed = isCanceled && !canceledDetailsOpen;

  const card = (
    <article
      className={`ops-appointment-card${onSite ? " is-on-site" : ""}${promoted ? " is-map-selected" : ""}${isCanceled ? " is-canceled" : ""}${isCompleted ? " is-completed" : ""}${canceledCollapsed ? " is-canceled-collapsed" : ""}`}
      id={articleId}
      tabIndex={-1}
      title={isCanceled
        ? "Canceled appointment — right-click to update the office call-ahead"
        : isCompleted
          ? "Closed-out appointment — right-click to update the office call-ahead"
          : "Right-click to update the office call-ahead"}
      onContextMenu={(event) => {
        event.preventDefault();
        setError("");
        setMenu({
          left: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)),
          top: Math.max(8, Math.min(event.clientY, window.innerHeight - 132)),
        });
      }}
    >
      <div className="ops-call-ahead-row">
        {onSite ? (
          <span
            className="ops-appointment-on-site"
            title={`GPS confirms ${onSiteTrucks.join(", ")} ${onSiteTrucks.length === 1 ? "is" : "are"} currently at this appointment`}
          >
            <i aria-hidden="true" />
            {onSiteTrucks.join(", ")} on site
          </span>
        ) : null}
        <span className={`ops-call-ahead-badge ${status || "unset"}${saving ? " saving" : ""}`}>
          {saving ? "Saving…" : label}
        </span>
        {error ? <span className="ops-call-ahead-error" role="alert">{error}</span> : null}
      </div>
      {children}
      {isCanceled ? (
        <button
          type="button"
          className="ops-canceled-card-toggle"
          aria-expanded={canceledDetailsOpen}
          onClick={() => setCanceledDetailsOpen((open) => !open)}
        >
          <span>{canceledDetailsOpen ? "Hide details" : "View details"}</span>
          <i aria-hidden="true">{canceledDetailsOpen ? "−" : "+"}</i>
        </button>
      ) : null}
      {menu ? (
        <div
          className="ops-call-ahead-menu"
          role="menu"
          aria-label="Office call-ahead status"
          style={{ left: menu.left, top: menu.top }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ops-call-ahead-menu-title">Office call-ahead</div>
          <button type="button" role="menuitemradio" aria-checked={status === "called"} onClick={() => void save("called")}>
            <span className="ops-call-ahead-menu-check">{status === "called" ? "✓" : ""}</span>
            Office called
          </button>
          <button type="button" role="menuitemradio" aria-checked={status === "not_called"} onClick={() => void save("not_called")}>
            <span className="ops-call-ahead-menu-check">{status === "not_called" ? "✓" : ""}</span>
            Not called yet
          </button>
        </div>
      ) : null}
    </article>
  );

  return promoted && selectedSlot ? createPortal(card, selectedSlot) : card;
}
