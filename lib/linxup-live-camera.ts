import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseTruckNumberFromLabel, truckCameraLabel } from "@/lib/linxup-truck-label";

const PORTAL_URL = "https://app03.linxup.com/ng/portal/index.html#mappage";
const LOGIN_URL = "https://app.linxup.com/authentication/linxup";
const PROFILE_DIRECTORY = process.env.LINXUP_CAMERA_PROFILE_DIR?.trim()
  || path.join(os.homedir(), "Library", "Application Support", "OpsCenter", "linxup-camera-profile-v2");
const CAMERA_CHANNELS = new Map<number, CameraOrientation>([
  [0, "outside"],
  [1, "inside"],
  [2, "aux"],
]);

export type CameraOrientation = "outside" | "inside" | "aux";

export type LinxupCameraStream = {
  truck: number;
  label: string;
  channels: Partial<Record<CameraOrientation, string>>;
  startedAt: string;
  durationSeconds: number;
};

type PortalTracker = { vehicleName: string; hardwareId: string };
type PortalStreamResponse = {
  channels?: Array<{ channel?: number; urls?: Array<{ url?: string }> }>;
};
type ActiveStream = { hardwareId: string; startedAt: number };
type LinxupCameraState = {
  contextPromise?: Promise<BrowserContext>;
  pagePromise?: Promise<Page>;
  operationQueue: Promise<void>;
  activeStreams: Map<number, ActiveStream>;
};
type CameraGlobal = typeof globalThis & { __opscenterLinxupCameraState?: LinxupCameraState };

export class LinxupCameraError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "NOT_AUTHENTICATED" | "CAMERA_NOT_FOUND" | "STREAM_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "LinxupCameraError";
  }
}

function cameraState(): LinxupCameraState {
  const root = globalThis as CameraGlobal;
  if (!root.__opscenterLinxupCameraState) {
    root.__opscenterLinxupCameraState = { operationQueue: Promise.resolve(), activeStreams: new Map() };
  }
  return root.__opscenterLinxupCameraState;
}

function keychainSecret(service: string): string {
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password",
      "-w",
      "-a",
      "opscenter",
      "-s",
      service,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function portalCredentials(): { username: string; password: string } | null {
  const username = process.env.LINXUP_PORTAL_USERNAME?.trim()
    || keychainSecret("com.opscenter.linxup-portal-username");
  const password = process.env.LINXUP_PORTAL_PASSWORD
    || keychainSecret("com.opscenter.linxup-portal-password");
  return username && password ? { username, password } : null;
}

async function browserContext(): Promise<BrowserContext> {
  const state = cameraState();
  if (state.contextPromise) return state.contextPromise;

  state.contextPromise = (async () => {
    await mkdir(PROFILE_DIRECTORY, { recursive: true, mode: 0o700 });
    const executablePath = process.env.LINXUP_CHROME_EXECUTABLE?.trim() || chromium.executablePath();
    return chromium.launchPersistentContext(PROFILE_DIRECTORY, {
      executablePath,
      headless: process.env.LINXUP_CAMERA_HEADED !== "1",
      viewport: { width: 1440, height: 1000 },
      args: ["--disable-gpu", "--disable-background-networking", "--start-minimized"],
    });
  })().catch((error) => {
    state.contextPromise = undefined;
    throw error;
  });
  return state.contextPromise;
}

async function portalReady(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(() => {
      const ext = (globalThis as unknown as { Ext?: { StoreManager?: { lookup?: (name: string) => unknown } } }).Ext;
      return Boolean(ext?.StoreManager?.lookup?.("mapVehicleLocationStore"));
    }, undefined, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function authenticatePortal(page: Page): Promise<void> {
  const credentials = portalCredentials();
  if (!credentials) {
    throw new LinxupCameraError("NOT_CONFIGURED", "LinxUp portal credentials have not been stored in Mission Control Keychain yet.");
  }
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator("#username").fill(credentials.username);
  await page.locator("#password").fill(credentials.password);
  await page.locator("button[type='submit']").click();
  try {
    await page.waitForURL(/https:\/\/app\d+\.linxup\.com\/ng\/portal\/index\.html/i, { timeout: 45_000 });
  } catch {
    throw new LinxupCameraError("NOT_AUTHENTICATED", "OpsCenter could not sign in to the LinxUp portal. Update the Keychain credentials and try again.");
  }
  if (!(await portalReady(page, 45_000))) {
    throw new LinxupCameraError("NOT_AUTHENTICATED", "OpsCenter could not sign in to the LinxUp portal. Update the Keychain credentials and try again.");
  }
}

async function portalPage(): Promise<Page> {
  const state = cameraState();
  if (state.pagePromise) return state.pagePromise;

  state.pagePromise = (async () => {
    const context = await browserContext();
    const existing = context.pages().find((candidate) => candidate.url().includes("linxup.com"));
    const page = existing || await context.newPage();
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!(await portalReady(page, 12_000))) await authenticatePortal(page);
    return page;
  })().catch((error) => {
    state.pagePromise = undefined;
    throw error;
  });
  return state.pagePromise;
}

async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const state = cameraState();
  const previous = state.operationQueue;
  let release = () => {};
  state.operationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

async function portalTrackers(page: Page): Promise<PortalTracker[]> {
  return page.evaluate(async () => {
    type ExtRecord = { data?: Record<string, unknown> };
    type ExtStore = {
      isLoaded?: () => boolean;
      load?: (options: { callback: () => void }) => void;
      getData?: () => { items?: ExtRecord[]; getSource?: () => { items?: ExtRecord[] } };
    };
    type ExtApi = { StoreManager?: { lookup?: (name: string) => ExtStore | undefined } };
    const ext = (globalThis as unknown as { Ext?: ExtApi }).Ext;
    const store = ext?.StoreManager?.lookup?.("mapVehicleLocationStore");
    if (!store) return [];
    if (store.isLoaded && !store.isLoaded() && store.load) {
      await new Promise<void>((resolve) => store.load?.({ callback: resolve }));
    }
    const data = store.getData?.();
    const records = data?.getSource?.().items || data?.items || [];
    return records.map((record) => ({
      vehicleName: String(record.data?.vehicleName || ""),
      hardwareId: String(record.data?.dashCamVendorDeviceId || ""),
    })).filter((record) => record.vehicleName && record.hardwareId);
  });
}

function trackerForTruck(trackers: PortalTracker[], truck: number): PortalTracker | null {
  return trackers.find((tracker) => parseTruckNumberFromLabel(tracker.vehicleName) === truck) || null;
}

async function extAjax<T>(page: Page, options: { url: string; method: "POST"; jsonData?: unknown; params?: unknown }): Promise<T> {
  return page.evaluate(async (request) => {
    type AjaxResponse = { status?: number; responseText?: string };
    type ExtApi = { Ajax?: { request?: (config: Record<string, unknown>) => void } };
    const ext = (globalThis as unknown as { Ext?: ExtApi }).Ext;
    if (!ext?.Ajax?.request) throw new Error("LinxUp portal request service is unavailable.");
    return new Promise<T>((resolve, reject) => {
      ext.Ajax?.request?.({
        url: request.url,
        method: request.method,
        jsonData: request.jsonData,
        params: request.params,
        timeout: 30_000,
        success: (response: AjaxResponse) => {
          try {
            resolve(JSON.parse(String(response.responseText || "{}")) as T);
          } catch {
            resolve({} as T);
          }
        },
        failure: (response: AjaxResponse) => reject(new Error(`LinxUp request failed (${response.status || "unknown"}).`)),
      });
    });
  }, options);
}

function validateStreamUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function startLinxupCameraStream(truck: number): Promise<LinxupCameraStream> {
  return serialized(async () => {
    const page = await portalPage();
    const tracker = trackerForTruck(await portalTrackers(page), truck);
    if (!tracker) {
      throw new LinxupCameraError("CAMERA_NOT_FOUND", `${truckCameraLabel(truck)} does not currently have a LinxUp camera assigned.`);
    }

    let response: PortalStreamResponse;
    try {
      response = await extAjax<PortalStreamResponse>(page, {
        url: "/ibis/rest/accessory/visiontrack/startStream",
        method: "POST",
        jsonData: { hardwareId: tracker.hardwareId, quality: 2 },
      });
    } catch {
      throw new LinxupCameraError("STREAM_UNAVAILABLE", `${truckCameraLabel(truck)} camera is offline or could not start live video.`);
    }

    const channels: LinxupCameraStream["channels"] = {};
    for (const channel of response.channels || []) {
      const orientation = CAMERA_CHANNELS.get(Number(channel.channel));
      const streamUrl = validateStreamUrl(channel.urls?.[0]?.url);
      if (orientation && streamUrl) channels[orientation] = streamUrl;
    }
    if (Object.keys(channels).length === 0) {
      throw new LinxupCameraError("STREAM_UNAVAILABLE", `${truckCameraLabel(truck)} camera did not return a playable live feed.`);
    }

    const startedAt = Date.now();
    cameraState().activeStreams.set(truck, { hardwareId: tracker.hardwareId, startedAt });
    return {
      truck,
      label: truckCameraLabel(truck),
      channels,
      startedAt: new Date(startedAt).toISOString(),
      durationSeconds: 60,
    };
  });
}

export async function stopLinxupCameraStream(truck: number, channel: CameraOrientation = "outside"): Promise<void> {
  return serialized(async () => {
    const active = cameraState().activeStreams.get(truck);
    if (!active) return;
    const page = await portalPage();
    cameraState().activeStreams.delete(truck);
    await extAjax<Record<string, never>>(page, {
      url: "/ibis/rest/accessory/visiontrack/stopStream",
      method: "POST",
      params: { hardwareId: active.hardwareId },
    }).catch(() => undefined);

    const streamSeconds = Math.max(0, Math.min(60, Math.round((Date.now() - active.startedAt) / 1000)));
    await extAjax<Record<string, never>>(page, {
      url: "/ibis/rest/accessory/visiontrack/saveLiveStreamUsage",
      method: "POST",
      jsonData: {
        hardwareId: active.hardwareId,
        channel,
        streamSeconds,
        bufferPauseCount: 0,
        totalBufferSeconds: 0,
        streamEndReason: "Player Closed",
      },
    }).catch(() => undefined);
  });
}

export async function closeLinxupCameraBrowser(): Promise<void> {
  const state = cameraState();
  const context = await state.contextPromise?.catch(() => undefined);
  state.pagePromise = undefined;
  state.contextPromise = undefined;
  state.activeStreams.clear();
  await context?.close().catch(() => undefined);
}
