"use client";

import { useEffect, useRef } from "react";
import { titleCaseLabel } from "@/lib/title-case";

export type PageSubnavItem = {
  label: string;
  href: string;
  active?: boolean;
  badge?: string | number;
  attention?: boolean;
};

export default function PageSubnav({
  title,
  sections,
}: {
  title: string;
  sections: PageSubnavItem[];
}) {
  const activeLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const link = activeLink.current;
    const nav = link?.parentElement;
    if (!link || !nav || nav.scrollWidth <= nav.clientWidth) return;
    link.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
  }, []);

  return (
    <nav className="ops-page-subnav" aria-label={`${title} sections`}>
      {sections.map((section) => (
        <a
          key={`${section.label}-${section.href}`}
          href={section.href}
          ref={section.active ? activeLink : undefined}
          className={`${section.active ? "active" : ""}${section.attention ? " needs-attention" : ""}`}
          aria-current={section.active ? "page" : undefined}
        >
          <span>{titleCaseLabel(section.label)}</span>
          {section.badge !== undefined ? <small>{section.badge}</small> : null}
        </a>
      ))}
    </nav>
  );
}
