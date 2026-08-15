"use client";

import { useEffect, useState } from "react";

export default function NetworkStatus() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const label = online === null ? "Checking network" : online ? "Device online" : "Device offline";

  return (
    <>
      <div className={`ops-status-pill${online === false ? " is-offline" : ""}`}>
        <span className="ops-pulse" />
        {label}
      </div>
      {online === false ? (
        <div className="ops-offline-banner" role="alert">
          OpsCenter is offline. Live operational data is unavailable until this device reconnects.
        </div>
      ) : null}
    </>
  );
}
