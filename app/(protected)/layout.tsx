import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OpsShell from "@/components/OpsShell";
import { AUTH_SESSION_COOKIE, opsAuthDisplayName, verifyAuthSessionCookie } from "@/lib/auth";

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

  return (
    <OpsShell sessionEmail={session.email} sessionLabel={opsAuthDisplayName(session.email)}>
      {children}
    </OpsShell>
  );
}
