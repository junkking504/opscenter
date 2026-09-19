type OpsCenterLogoProps = {
  className?: string;
};

/** Approved red-and-gold identity, including the custom OpsCenter wordmark. */
export default function OpsCenterLogo({ className = "" }: OpsCenterLogoProps) {
  return (
    // Public static artwork is also available before login.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src="/opscenter-wordmark.png?v=3" alt="OpsCenter" width={1400} height={321} style={{ display: "block", width: "100%", height: "auto", filter: "none" }} />
  );
}
