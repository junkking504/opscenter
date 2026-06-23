import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base text-ink p-8">
      <div className="max-w-md w-full rounded-lg border border-line bg-panel p-6 text-center">
        <h2 className="text-lg font-semibold mb-2">Page not found</h2>
        <p className="text-sm text-muted mb-4">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="px-4 py-2 rounded bg-brand text-white text-sm font-medium hover:opacity-90 transition-opacity inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
