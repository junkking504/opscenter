"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ManualBonusEntry } from "@/lib/manual-bonuses";
import { money } from "@/lib/money";

type BonusDraft = {
  clientId: string;
  entryId: string;
  amount: string;
  note: string;
  createdAt?: string;
  updatedAt?: string;
};

function normalizeAmount(value: string): string {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return "";
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return cleaned;
  return parsed.toFixed(2);
}

function createDraft(entry?: ManualBonusEntry): BonusDraft {
  return {
    clientId: crypto.randomUUID(),
    entryId: entry?.entryId || "",
    amount: entry ? entry.amount.toFixed(2) : "",
    note: entry?.note || "",
    createdAt: entry?.createdAt,
    updatedAt: entry?.updatedAt,
  };
}

export default function ManualBonusEditor({
  date,
  employeeName,
  entries,
  totalAmount,
}: {
  date: string;
  employeeName: string;
  entries: ManualBonusEntry[];
  totalAmount: number;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<BonusDraft[]>(() => (entries.length ? entries.map((entry) => createDraft(entry)) : [createDraft()]));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    setDrafts(entries.length ? entries.map((entry) => createDraft(entry)) : [createDraft()]);
  }, [date, employeeName, entries]);

  const visibleCount = useMemo(() => drafts.filter((draft) => Number(draft.amount) > 0 || draft.note || draft.entryId).length, [drafts]);

  async function persistDraft(draft: BonusDraft) {
    const amount = Number(String(draft.amount || "").trim());
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Enter a valid non-negative amount.");
      return;
    }

    if (!draft.entryId && amount <= 0) {
      setDrafts((current) => current.filter((row) => row.clientId !== draft.clientId));
      setMessage("Manual bonus removed.");
      return;
    }

    if (amount <= 0) {
      await removeDraft(draft);
      return;
    }

    setSavingId(draft.clientId);
    setMessage("");

    try {
      const response = await fetch("/api/manual-bonuses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId: draft.entryId || undefined,
          employeeName,
          workDate: date,
          amount,
          note: String(draft.note || "").trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
      }

      const payload = await response.json();
      const saved: ManualBonusEntry | null = payload?.entry || null;

      if (saved) {
        setDrafts((current) =>
          current.map((row) =>
            row.clientId === draft.clientId
              ? {
                  clientId: row.clientId,
                  entryId: saved.entryId,
                  amount: saved.amount.toFixed(2),
                  note: saved.note || "",
                  createdAt: saved.createdAt,
                  updatedAt: saved.updatedAt,
                }
              : row,
          ),
        );
      }

      setMessage("Manual bonus saved.");
      router.refresh();
    } catch {
      setMessage("Unable to save manual bonus.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeDraft(draft: BonusDraft) {
    if (!draft.entryId) {
      setDrafts((current) => current.filter((row) => row.clientId !== draft.clientId));
      setMessage("Manual bonus removed.");
      return;
    }

    setSavingId(draft.clientId);
    setMessage("");

    try {
      const response = await fetch(`/api/manual-bonuses?entryId=${encodeURIComponent(draft.entryId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed (${response.status})`);
      }

      setDrafts((current) => current.filter((row) => row.clientId !== draft.clientId));
      setMessage("Manual bonus removed.");
      router.refresh();
    } catch {
      setMessage("Unable to remove manual bonus.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="ops-manual-bonus-editor">
      <div className="ops-manual-bonus-editor-header">
        <div className="ops-manual-bonus-editor-total">{money(totalAmount)}</div>
        <div className="ops-manual-bonus-editor-meta">
          {visibleCount === 1 ? "1 entry" : `${visibleCount} entries`}
        </div>
      </div>

      <div className="ops-manual-bonus-entry-list">
        {drafts.map((draft, index) => {
          const amountValue = String(draft.amount || "").trim();
          const isDirty = Boolean(draft.entryId) || amountValue !== "" || draft.note.trim() !== "";
          return (
            <div key={draft.clientId} className="ops-manual-bonus-entry">
              <div className="ops-manual-bonus-entry-grid">
                <label className="ops-manual-bonus-field">
                  <span>Amount</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={draft.amount}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDrafts((current) =>
                        current.map((row) =>
                          row.clientId === draft.clientId ? { ...row, amount: next } : row,
                        ),
                      );
                    }}
                    onBlur={() => {
                      setDrafts((current) =>
                        current.map((row) =>
                          row.clientId === draft.clientId ? { ...row, amount: normalizeAmount(row.amount) } : row,
                        ),
                      );
                    }}
                    placeholder="$0.00"
                  />
                </label>

                <label className="ops-manual-bonus-field ops-manual-bonus-field-note">
                  <span>Bonus Note</span>
                  <input
                    type="text"
                    value={draft.note}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDrafts((current) =>
                        current.map((row) =>
                          row.clientId === draft.clientId ? { ...row, note: next } : row,
                        ),
                      );
                    }}
                    placeholder="Customer compliment, extra effort, referral..."
                  />
                </label>

                <div className="ops-manual-bonus-entry-actions">
                  <button
                    type="button"
                    className="ops-refresh-button ops-manual-bonus-save"
                    disabled={savingId === draft.clientId}
                    onClick={() => persistDraft(draft)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="ops-button ops-manual-bonus-remove"
                    disabled={savingId === draft.clientId || (!isDirty && !draft.entryId)}
                    onClick={() => removeDraft(draft)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {draft.createdAt || draft.updatedAt ? (
                <div className="ops-manual-bonus-entry-meta">
                  {draft.createdAt ? `Entered ${draft.createdAt}` : null}
                  {draft.createdAt && draft.updatedAt ? " · " : null}
                  {draft.updatedAt ? `Edited ${draft.updatedAt}` : null}
                </div>
              ) : null}
              {index === drafts.length - 1 ? (
                <button
                  type="button"
                  className="ops-manual-bonus-add"
                  onClick={() => setDrafts((current) => [...current, createDraft()])}
                >
                  Add another bonus
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="ops-manual-bonus-editor-message" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
