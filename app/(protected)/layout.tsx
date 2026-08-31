import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OpsShell from "@/components/OpsShell";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { resolveKernelDatabaseConfig } from "@/lib/platform/persistence/config";
import { opsShellSessionProps } from "@/lib/ops-shell-session";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const session = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!session) {
    redirect("/login");
  }
  const inboxEnabled = resolveKernelDatabaseConfig().status === "ready";

  return (
    <OpsShell
      {...opsShellSessionProps(session)}
      inboxEnabled={inboxEnabled}
    >
      {children}
    </OpsShell>
  );
}
