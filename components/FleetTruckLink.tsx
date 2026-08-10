"use client";

import { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

type FleetTruckLinkProps = {
  href: string;
  className?: string;
  children: ReactNode;
};

export default function FleetTruckLink({ href, className, children }: FleetTruckLinkProps) {
  const router = useRouter();
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    router.push(href);
  };

  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  );
}
