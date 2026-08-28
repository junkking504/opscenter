import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const PROFILE_IMAGE_KEY_PREFIX = "crew-profile-image-v1:";
const MAX_IMAGE_BYTES = 900_000;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

type CrewProfileImageState = { version: 1; images: Record<string, string> };
type CrewProfileImageNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

function employeeKey(employee: string): string { return employee.trim().toLocaleLowerCase(); }
function cloudflareKey(employee: string): string { return `${PROFILE_IMAGE_KEY_PREFIX}${encodeURIComponent(employeeKey(employee))}`; }

async function cloudflareProfileImages(): Promise<CrewProfileImageNamespace | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    // Photos are private, per-employee data in the existing private Crew namespace.
    return (env as unknown as { CREW_CREDENTIALS?: CrewProfileImageNamespace }).CREW_CREDENTIALS || null;
  } catch { return null; }
}

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 0.75) - padding;
}

export function crewProfileImageError(value: unknown): string | null {
  const match = String(value || "").match(DATA_URL);
  if (!match) return "Choose a JPG, PNG, or WebP image.";
  if (decodedByteLength(match[2]) > MAX_IMAGE_BYTES) return "Use a photo smaller than 900 KB.";
  return null;
}

export function crewProfileImageStatePath(): string {
  return String(process.env.OPS_CREW_PROFILE_IMAGES_PATH || "").trim()
    || path.join(os.homedir(), "Library", "Application Support", "OpsCenter", "crew-profile-images.json");
}

async function localImageState(): Promise<CrewProfileImageState> {
  try {
    const parsed = JSON.parse(await fs.readFile(crewProfileImageStatePath(), "utf8")) as CrewProfileImageState;
    if (parsed?.version !== 1 || !parsed.images || typeof parsed.images !== "object" || Array.isArray(parsed.images)) throw new Error("Crew profile image storage has an unsupported format.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, images: {} };
    throw error;
  }
}

async function writeLocalImageState(state: CrewProfileImageState): Promise<void> {
  const target = crewProfileImageStatePath();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(target, 0o600);
}

export async function crewProfileImageForEmployee(employee: string): Promise<string | null> {
  const namespace = await cloudflareProfileImages();
  if (namespace) return namespace.get(cloudflareKey(employee));
  return (await localImageState()).images[employeeKey(employee)] || null;
}

export async function saveCrewProfileImage(employee: string, image: string): Promise<void> {
  const error = crewProfileImageError(image);
  if (error) throw new Error(error);
  const namespace = await cloudflareProfileImages();
  if (namespace) return namespace.put(cloudflareKey(employee), image);
  const state = await localImageState();
  await writeLocalImageState({ version: 1, images: { ...state.images, [employeeKey(employee)]: image } });
}

export async function deleteCrewProfileImage(employee: string): Promise<void> {
  const namespace = await cloudflareProfileImages();
  if (namespace) return namespace.delete(cloudflareKey(employee));
  const state = await localImageState();
  const { [employeeKey(employee)]: _removed, ...images } = state.images;
  await writeLocalImageState({ version: 1, images });
}
