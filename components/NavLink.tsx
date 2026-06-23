"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkProps = {
  href: string;
  label: string;
  selectedDate?: string;
};

export function NavLink({ href, label, selectedDate }: NavLinkProps) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  const query = selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : "";

  return (
    <Link
      href={`${href}${query}`}
      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-line text-muted hover:border-brand hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
