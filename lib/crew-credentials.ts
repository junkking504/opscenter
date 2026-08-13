import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { crewMemberForUsername, normalizeCrewUsername, type CrewRosterEntry } from "./crew-auth";
import { createPasswordHash, verifyPasswordHash } from "./password-hash";

type StoredCrewCredential = {
  employee: string;
  passwordHash: string;
  updatedAt: string;
};

type CrewCredentialState = {
  version: 1;
  users: Record<string, StoredCrewCredential>;
};

export type CrewAuthentication = {
  member: CrewRosterEntry;
  passwordChangeRequired: boolean;
};

const EMPTY_STATE: CrewCredentialState = { version: 1, users: {} };

export function crewCredentialStatePath(): string {
  return String(process.env.OPS_CREW_CREDENTIALS_PATH || "").trim()
    || path.join(os.homedir(), "Library", "Application Support", "OpsCenter", "crew-credentials.json");
}

async function readState(): Promise<CrewCredentialState> {
  try {
    const payload = JSON.parse(await fs.readFile(crewCredentialStatePath(), "utf8")) as CrewCredentialState;
    if (payload?.version !== 1 || !payload.users || typeof payload.users !== "object" || Array.isArray(payload.users)) {
      throw new Error("Crew credential storage has an unsupported format.");
    }
    return payload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
    throw error;
  }
}

async function withStateLock<T>(work: () => Promise<T>): Promise<T> {
  const statePath = crewCredentialStatePath();
  const directory = path.dirname(statePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const lockPath = `${statePath}.lock`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) throw new Error("Crew credential storage is busy. Try again.");

  try {
    return await work();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

async function writeState(state: CrewCredentialState): Promise<void> {
  const statePath = crewCredentialStatePath();
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(temporaryPath, 0o600);
  await fs.rename(temporaryPath, statePath);
  await fs.chmod(statePath, 0o600);
}

export async function authenticateCrewCredentials(usernameValue: unknown, passwordValue: unknown): Promise<CrewAuthentication | null> {
  const member = crewMemberForUsername(usernameValue);
  const password = String(passwordValue || "");
  if (!member || !password) return null;

  const state = await readState();
  const stored = state.users[member.username];
  if (stored?.passwordHash) {
    return await verifyPasswordHash(password, stored.passwordHash)
      ? { member, passwordChangeRequired: false }
      : null;
  }

  const temporaryHash = String(process.env.OPS_CREW_TEMP_PASSWORD_HASH || "").trim();
  return await verifyPasswordHash(password, temporaryHash)
    ? { member, passwordChangeRequired: true }
    : null;
}

export function crewPasswordPolicyError(value: unknown): string {
  const password = String(value || "");
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use no more than 128 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Include at least one letter and one number.";
  return "";
}

export async function setInitialCrewPassword(
  usernameValue: unknown,
  employeeValue: unknown,
  passwordValue: unknown,
): Promise<{ ok: true } | { ok: false; reason: "already-set" | "invalid-user" | "temporary-password" }> {
  const username = normalizeCrewUsername(usernameValue);
  const employee = String(employeeValue || "").trim();
  const member = crewMemberForUsername(username);
  if (!member || member.employee !== employee) return { ok: false, reason: "invalid-user" };
  const password = String(passwordValue || "");
  if (await verifyPasswordHash(password, process.env.OPS_CREW_TEMP_PASSWORD_HASH)) {
    return { ok: false, reason: "temporary-password" };
  }
  const passwordHash = await createPasswordHash(password);

  return withStateLock(async () => {
    const state = await readState();
    if (state.users[username]?.passwordHash) return { ok: false, reason: "already-set" } as const;
    await writeState({
      version: 1,
      users: {
        ...state.users,
        [username]: { employee: member.employee, passwordHash, updatedAt: new Date().toISOString() },
      },
    });
    return { ok: true } as const;
  });
}
