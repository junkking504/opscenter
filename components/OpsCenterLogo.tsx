type OpsCenterLogoProps = {
  className?: string;
};

/** Approved JK crown and circuit artwork shared by the application shells. */
export default function OpsCenterLogo({ className = "" }: OpsCenterLogoProps) {
  return (
    // Static branding is served directly so the same asset works before login.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src="/opscenter-logo.png?v=2" alt="OpsCenter" width={512} height={512} />
  );
}
