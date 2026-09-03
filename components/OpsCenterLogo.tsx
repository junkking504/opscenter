type OpsCenterLogoProps = {
  className?: string;
};

/** A compact dispatch-location mark shared by the desktop and mobile shells. */
export default function OpsCenterLogo({ className = "" }: OpsCenterLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      role="img"
      aria-label="OpsCenter"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#17191d" stroke="#6d4a23" />
      <path
        d="M20 8.5a8 8 0 0 0-8 8c0 6.1 8 14.9 8 14.9s8-8.8 8-14.9a8 8 0 0 0-8-8Z"
        fill="none"
        stroke="#f0b338"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="16.5" r="3.2" fill="#e8323e" stroke="#f0b338" strokeWidth="1.2" />
    </svg>
  );
}
