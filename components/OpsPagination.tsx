import Link from "next/link";

export default function OpsPagination({
  currentPage,
  totalPages,
  previousHref,
  nextHref,
  label,
}: {
  currentPage: number;
  totalPages: number;
  previousHref?: string;
  nextHref?: string;
  label: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="ops-pagination" aria-label={label}>
      {previousHref ? (
        <Link className="ops-pagination-link" href={previousHref} rel="prev">
          Previous
        </Link>
      ) : (
        <span className="ops-pagination-link is-disabled" aria-disabled="true">Previous</span>
      )}
      <span className="ops-pagination-status" aria-live="polite">
        Page {currentPage} Of {totalPages}
      </span>
      {nextHref ? (
        <Link className="ops-pagination-link" href={nextHref} rel="next">
          Next
        </Link>
      ) : (
        <span className="ops-pagination-link is-disabled" aria-disabled="true">Next</span>
      )}
    </nav>
  );
}
