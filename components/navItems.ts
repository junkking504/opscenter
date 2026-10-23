import { opsRoleCan, type InteractiveOpsRole } from "@/lib/ops-roles";

export const primaryNavItems = [
  { href: "/", label: "Dashboard", mobileLabel: "Dashboard", icon: "01" },
  { href: "/jobs", label: "Command", mobileLabel: "Command", icon: "02" },
  { href: "/crew", label: "Krewe", mobileLabel: "Krewe", icon: "03" },
  { href: "/fleet", label: "Fleet", mobileLabel: "Fleet", icon: "04" },
  { href: "/finance", label: "Finance", mobileLabel: "Finance", icon: "05" },
  { href: "/marketing", label: "Marketing", mobileLabel: "Marketing", icon: "06" },
] as const;

export const inboxNavItem = {
  href: "/inbox",
  label: "Inbox",
  mobileLabel: "Inbox",
  icon: "07",
} as const;

export function opsNavigationItems(role: InteractiveOpsRole, inboxEnabled = false) {
  const items = inboxEnabled ? [...primaryNavItems, inboxNavItem] : [...primaryNavItems];
  return items.filter((item) => item.href !== "/finance" || opsRoleCan(role, "finance.read"));
}
