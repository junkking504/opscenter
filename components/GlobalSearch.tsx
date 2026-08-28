"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chicagoDateKey } from "@/lib/chicago-date";
import type { GlobalSearchResult, GlobalSearchResultType } from "@/lib/global-search";
import styles from "./GlobalSearch.module.css";

const typeLabels: Record<GlobalSearchResultType, string> = {
  job: "Appointments",
  crew: "Krewe",
  truck: "Fleet",
};

export default function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const date = chicagoDateKey();

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/global-search?q=${encodeURIComponent(normalized)}&date=${encodeURIComponent(date)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Search unavailable")))
        .then((payload: { results?: GlobalSearchResult[] }) => setResults(payload.results || []))
        .catch((error: Error) => {
          if (error.name !== "AbortError") setResults([]);
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [date, query]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", shortcut);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", shortcut);
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const destination = results[0]?.href || `/jobs?date=${encodeURIComponent(date)}&q=${encodeURIComponent(query.trim())}`;
    setOpen(false);
    router.push(destination);
  }

  const rankedTypes = Array.from(new Set(results.map((result) => result.type)));
  const grouped = rankedTypes
    .map((type) => ({ type, results: results.filter((result) => result.type === type) }))
    .filter((group) => group.results.length > 0);

  return (
    <div className={`${styles.root}${open ? ` ${styles.open}` : ""}`} ref={rootRef}>
      <form className={styles.form} role="search" onSubmit={submit}>
        <span className={styles.icon} aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          value={query}
          aria-label="Search appointments, Krewe, and trucks"
          aria-expanded={open}
          aria-controls="ops-global-search-results"
          aria-autocomplete="list"
          placeholder="Search jobs, Krewe, trucks"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        <kbd>/</kbd>
      </form>

      {open && query.trim().length >= 2 ? (
        <div className={styles.results} id="ops-global-search-results" aria-live="polite">
          {loading ? <div className={styles.message}>Searching current operational records…</div> : null}
          {!loading && grouped.length === 0 ? <div className={styles.message}>No matching appointments, Krewe, or trucks.</div> : null}
          {!loading ? grouped.map((group) => (
            <section className={styles.group} key={group.type} aria-label={typeLabels[group.type]}>
              <div className={styles.groupLabel}>{typeLabels[group.type]}</div>
              {group.results.map((result) => (
                <Link className={styles.result} href={result.href} key={result.id} onClick={() => setOpen(false)}>
                  <span className={styles.resultCopy}><strong>{result.title}</strong><small>{result.subtitle}</small></span>
                  <span className={styles.source}>{result.source}</span>
                </Link>
              ))}
            </section>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
