"use client";

import Link from "next/link";
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
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const activeSection = sections.find((section) => section.active) || sections[0];

  useEffect(() => {
    const link = activeLink.current;
    const nav = link?.parentElement;
    if (!link || !nav || nav.scrollWidth <= nav.clientWidth) return;
    link.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
  }, []);

  return (
    <>
      <nav className="ops-page-subnav" aria-label={`${title} sections`}>
        {sections.map((section) => (
          <Link
            key={`${section.label}-${section.href}`}
            href={section.href}
            prefetch={false}
            ref={section.active ? activeLink : undefined}
            className={`${section.active ? "active" : ""}${section.attention ? " needs-attention" : ""}`}
            aria-current={section.active ? "page" : undefined}
          >
            <span>{titleCaseLabel(section.label)}</span>
            {section.badge !== undefined ? <small>{section.badge}</small> : null}
          </Link>
        ))}
      </nav>
      <details className="ops-page-subnav-mobile" ref={mobileMenu}>
        <summary>
          <span>{titleCaseLabel(activeSection?.label || title)}</span>
          <small>All sections</small>
        </summary>
        <nav aria-label={`${title} mobile sections`}>
          {sections.map((section) => (
            <Link
              key={`mobile-${section.label}-${section.href}`}
              href={section.href}
              prefetch={false}
              className={`${section.active ? "active" : ""}${section.attention ? " needs-attention" : ""}`}
              aria-current={section.active ? "page" : undefined}
              onClick={() => {
                if (mobileMenu.current) mobileMenu.current.open = false;
              }}
            >
              <span>{titleCaseLabel(section.label)}</span>
              {section.badge !== undefined ? <small>{section.badge}</small> : null}
            </Link>
          ))}
        </nav>
      </details>
    </>
  );
}
