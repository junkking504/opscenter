"use client";

import { useEffect, useState } from "react";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function manualInstallInstructions(): string {
  const userAgent = navigator.userAgent;
  const isTouchAppleDevice = /iPhone|iPad|iPod/i.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isTouchAppleDevice) {
    return "In Safari, tap Share, then Add to Home Screen.";
  }

  const isMacSafari = /Macintosh/i.test(userAgent)
    && /Safari/i.test(userAgent)
    && !/Chrome|Chromium|CriOS|Edg/i.test(userAgent);
  if (isMacSafari) {
    return "In Safari, choose File, then Add to Dock.";
  }

  const isChromiumDesktop = /Chrome|Chromium|Edg/i.test(userAgent) && !/CriOS|EdgiOS/i.test(userAgent);
  if (isChromiumDesktop) {
    return "Open Chrome’s ⋮ menu, choose Cast, save, and share, then Install page as app.";
  }

  return "Open your browser menu and choose Install page as app or Add to Home Screen.";
}

export default function InstallOpsCenter() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [manualInstructions, setManualInstructions] = useState<string | null>(null);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(isStandalone());
    setManualInstructions(manualInstallInstructions());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstructions(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (installed || (!installPrompt && !manualInstructions)) {
    return null;
  }

  const install = async () => {
    if (!installPrompt) {
      setInstructions(manualInstructions);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "dismissed") {
      setInstructions("Install dismissed. You can try again from your browser menu.");
    }
  };

  return (
    <div className="ops-install-app">
      <button
        type="button"
        className="ops-mini-link ops-install-app-button"
        onClick={() => void install()}
        aria-expanded={Boolean(instructions)}
      >
        Install App
      </button>
      {instructions ? (
        <div className="ops-install-app-help" role="status">
          {instructions}
        </div>
      ) : null}
    </div>
  );
}
