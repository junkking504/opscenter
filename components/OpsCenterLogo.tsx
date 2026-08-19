import styles from "./OpsCenterLogo.module.css";

type OpsCenterLogoProps = {
  variant?: "sidebar" | "login" | "mobile";
};

/** The product mark: route nodes converge on the dispatch point at its center. */
export default function OpsCenterLogo({ variant = "sidebar" }: OpsCenterLogoProps) {
  return (
    <svg
      className={`${styles.logo} ${styles[variant]}`}
      viewBox="0 0 64 64"
      role="img"
      aria-label="OpsCenter"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="opscenter-surface" x1="8" y1="5" x2="56" y2="61" gradientUnits="userSpaceOnUse">
          <stop stopColor="#252a33" />
          <stop offset="1" stopColor="#0a0d12" />
        </linearGradient>
        <linearGradient id="opscenter-signal" x1="24" y1="18" x2="41" y2="47" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff4b51" />
          <stop offset="1" stopColor="#d90d1d" />
        </linearGradient>
        <filter id="opscenter-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#opscenter-surface)" />
      <rect x="3" y="3" width="58" height="58" rx="16" stroke="#f5ca62" strokeOpacity=".42" strokeWidth="1.4" />
      <path d="M14 21.5 27.7 29M14 42.5l13.7-7.5M50 21.5 36.3 29M50 42.5l-13.7-7.5" stroke="#f5ca62" strokeLinecap="round" strokeWidth="2.5" />
      <circle cx="14" cy="21.5" r="3.5" fill="#151a21" stroke="#f5ca62" strokeWidth="2" />
      <circle cx="14" cy="42.5" r="3.5" fill="#151a21" stroke="#f5ca62" strokeWidth="2" />
      <circle cx="50" cy="21.5" r="3.5" fill="#151a21" stroke="#f5ca62" strokeWidth="2" />
      <circle cx="50" cy="42.5" r="3.5" fill="#151a21" stroke="#f5ca62" strokeWidth="2" />
      <path d="m32 14 12 17.5L32 51 20 31.5 32 14Z" fill="url(#opscenter-signal)" stroke="#f8d274" strokeLinejoin="round" strokeWidth="2" />
      <circle cx="32" cy="31.5" r="7" fill="#10141b" stroke="#fff0b1" strokeWidth="1.5" />
      <path d="M32 27.5v8M28 31.5h8" stroke="#f8d274" strokeLinecap="round" strokeWidth="2" />
      <circle cx="32" cy="31.5" r="2.2" fill="#f8d274" filter="url(#opscenter-glow)" />
    </svg>
  );
}
