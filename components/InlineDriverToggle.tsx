"use client";

import { useState } from "react";

export default function InlineDriverToggle({ name, targetId }: { name: string; targetId: string }) {
  const [open, setOpen] = useState(false);

  function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    const detailRow = document.getElementById(targetId);
    if (detailRow) detailRow.hidden = !nextOpen;
  }

  return (
    <button type="button" className="ops-driver-inline-toggle" onClick={toggle} aria-expanded={open} aria-controls={targetId}>
      <strong>{name}</strong>
      <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
  );
}
