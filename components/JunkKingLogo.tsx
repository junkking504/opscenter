import Image from "next/image";

export default function JunkKingLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      className={className}
      src="/junk-king-logo.svg"
      alt="Junk King"
      width={218}
      height={48}
      priority
      unoptimized
    />
  );
}
