import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OpsShell from "@/components/OpsShell";
import { AUTH_SESSION_COOKIE, opsAuthDisplayName, verifyAuthSessionCookie } from "@/lib/auth";
import { resolveKernelDatabaseConfig } from "@/lib/platform/persistence/config";

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
      sessionEmail={session.email}
      sessionLabel={opsAuthDisplayName(session.email)}
      sessionRole={session.role}
      inboxEnabled={inboxEnabled}
    >
      {children}
    </OpsShell>
  );
}
