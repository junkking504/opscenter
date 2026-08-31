import { opsAuthDisplayName, type AuthSession } from "@/lib/auth";

export function opsShellSessionProps(session: AuthSession) {
  return {
    sessionEmail: session.email,
    sessionLabel: opsAuthDisplayName(session.email),
    sessionRole: session.role,
  };
}
