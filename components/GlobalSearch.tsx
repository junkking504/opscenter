"use client";

import {exactSearchDestination} from '@/desktop-ui/lib/search-destination';
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chicagoDateKey } from "@/lib/chicago-date";
import type { GlobalSearchResult, GlobalSearchResultType } from "@/lib/global-search";
import styles from "./GlobalSearch.module.css";
import { usePinnedSearch } from "@/desktop-ui/use-pinned-search";

const typeLabels: Record<GlobalSearchResultType, string> = {
  customer: "Customers",
  job: "Appointments",
  crew: "Krewe",
  truck: "Fleet",
};

export default function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  usePinnedSearch(rootRef, {slotSelector:".ops-topbar-search",contentSelector:".ops-main-frame",fieldSelector:"form"});
  const inputRef = useRef<HTMLInputElement>(null);
  const [customerTotal,setCustomerTotal]=useState(0);
  const [notice,setNotice]=useState("");
  const [resultQuery,setResultQuery]=useState("");
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
        .then((payload: { results?: GlobalSearchResult[];customerTotal?:number }) => {if(!controller.signal.aborted){setResults(payload.results || []);setResultQuery(normalized);setCustomerTotal(payload.customerTotal||0);}})
        .catch((error: Error) => {
          if (!controller.signal.aborted && error.name !== "AbortError") {setResults([]);setNotice("Search unavailable. Try again.");}
        })
        .finally(() => {if(!controller.signal.aborted)setLoading(false);});
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
    if(loading||resultQuery!==query.trim()){setNotice('Searching records…');return;}
    const destination=exactSearchDestination(query,results);
    if(!destination||(destination.type==='customer'&&customerTotal>5)){setNotice(results.length?'Choose the matching record below.':'No exact record found.');return;}
    setOpen(false);
    router.push(destination.href);
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
          aria-label="Search OpsCenter records"
          aria-expanded={open}
          aria-controls="ops-global-search-results"
          aria-autocomplete="list"
          placeholder="Search all of OpsCenter"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);setNotice("");
            setOpen(true);
          }}
        />
        <kbd>/</kbd>
      </form>

      {open && query.trim().length >= 2 ? (
        <div className={styles.results} id="ops-global-search-results" aria-live="polite">
          {notice&&<div className={styles.message}>{notice}</div>}
          {loading ? <div className={styles.message}>Searching current operational records…</div> : null}
          {!loading && grouped.length === 0 ? <div className={styles.message}>No matching appointments, customers, Krewe, or trucks.</div> : null}
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
