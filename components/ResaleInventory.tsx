"use client";

import { useMemo, useState } from "react";
import type { ResaleItem, ResaleStatus } from "@/lib/resale-items";
import { money } from "@/lib/money";

type ResaleDraft = {
  itemId: string;
  itemName: string;
  acquiredDate: string;
  source: string;
  cost: string;
  askingPrice: string;
  soldPrice: string;
  status: ResaleStatus;
  marketplace: string;
  notes: string;
};

const statusLabels: Record<ResaleStatus, string> = {
  to_list: "To list",
  listed: "Listed",
  sold: "Sold",
};

function todayChicago(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function blankDraft(): ResaleDraft {
  return {
    itemId: "",
    itemName: "",
    acquiredDate: todayChicago(),
    source: "",
    cost: "0.00",
    askingPrice: "",
    soldPrice: "",
    status: "to_list",
    marketplace: "",
    notes: "",
  };
}

function draftFromItem(item: ResaleItem): ResaleDraft {
  return {
    itemId: item.itemId,
    itemName: item.itemName,
    acquiredDate: item.acquiredDate,
    source: item.source,
    cost: item.cost.toFixed(2),
    askingPrice: item.askingPrice ? item.askingPrice.toFixed(2) : "",
    soldPrice: item.soldPrice ? item.soldPrice.toFixed(2) : "",
    status: item.status,
    marketplace: item.marketplace,
    notes: item.notes,
  };
}

function numericValue(value: string): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export default function ResaleInventory({ initialItems }: { initialItems: ResaleItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState<ResaleDraft | null>(null);
  const [filter, setFilter] = useState<"active" | "sold" | "all">("active");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const summary = useMemo(() => {
    const active = items.filter((item) => item.status !== "sold");
    const sold = items.filter((item) => item.status === "sold");
    return {
      activeCount: active.length,
      askingValue: active.reduce((sum, item) => sum + item.askingPrice, 0),
      invested: active.reduce((sum, item) => sum + item.cost, 0),
      soldRevenue: sold.reduce((sum, item) => sum + item.soldPrice, 0),
      soldProfit: sold.reduce((sum, item) => sum + item.soldPrice - item.cost, 0),
    };
  }, [items]);

  const visibleItems = useMemo(() => items.filter((item) => {
    if (filter === "active") return item.status !== "sold";
    if (filter === "sold") return item.status === "sold";
    return true;
  }), [filter, items]);

  function updateDraft<Key extends keyof ResaleDraft>(key: Key, value: ResaleDraft[Key]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveDraft() {
    if (!draft?.itemName.trim()) {
      setMessage("Enter an item name before saving.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/resale-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          cost: numericValue(draft.cost),
          askingPrice: numericValue(draft.askingPrice),
          soldPrice: numericValue(draft.soldPrice),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.item) throw new Error(payload?.error || "Save failed");

      const saved = payload.item as ResaleItem;
      setItems((current) => {
        const exists = current.some((item) => item.itemId === saved.itemId);
        return exists
          ? current.map((item) => item.itemId === saved.itemId ? saved : item)
          : [saved, ...current];
      });
      setDraft(null);
      setMessage(`${saved.itemName} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the item.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: ResaleItem) {
    if (!window.confirm(`Remove ${item.itemName} from the resale list?`)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/resale-items?itemId=${encodeURIComponent(item.itemId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Unable to remove the item.");
      setItems((current) => current.filter((entry) => entry.itemId !== item.itemId));
      if (draft?.itemId === item.itemId) setDraft(null);
      setMessage(`${item.itemName} removed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove the item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-resale-section">
      <div className="ops-resale-kpis">
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Active Items</div>
          <div className="ops-kpi-value ops-kpi-accent">{summary.activeCount}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Active Asking Value</div>
          <div className="ops-kpi-value">{money(summary.askingValue)}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Cost in Active Items</div>
          <div className="ops-kpi-value">{money(summary.invested)}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Sold Revenue</div>
          <div className="ops-kpi-value ops-kpi-good">{money(summary.soldRevenue)}</div>
          <div className="ops-kpi-sub">{money(summary.soldProfit)} net after item cost</div>
        </div>
      </div>

      <div className="ops-card ops-resale-card">
        <div className="ops-card-header compact ops-resale-card-header">
          <div>
            <div className="ops-section-title">Resale Inventory</div>
            <div className="ops-muted">Track items from pickup through listing and sale.</div>
          </div>
          <button type="button" className="ops-refresh-button" onClick={() => setDraft(blankDraft())}>
            Add resale item
          </button>
        </div>

        {draft ? (
          <div className="ops-resale-form">
            <div className="ops-resale-form-heading">
              <strong>{draft.itemId ? "Edit resale item" : "New resale item"}</strong>
              <span className="ops-muted">Item name is required. Everything else can be filled in later.</span>
            </div>
            <div className="ops-resale-form-grid">
              <label className="ops-resale-field ops-resale-field-wide">
                <span>Item</span>
                <input value={draft.itemName} onChange={(event) => updateDraft("itemName", event.target.value)} placeholder="Dining table, refrigerator, tool set..." autoFocus />
              </label>
              <label className="ops-resale-field">
                <span>Status</span>
                <select value={draft.status} onChange={(event) => updateDraft("status", event.target.value as ResaleStatus)}>
                  <option value="to_list">To list</option>
                  <option value="listed">Listed</option>
                  <option value="sold">Sold</option>
                </select>
              </label>
              <label className="ops-resale-field">
                <span>Date acquired</span>
                <input type="date" value={draft.acquiredDate} onChange={(event) => updateDraft("acquiredDate", event.target.value)} />
              </label>
              <label className="ops-resale-field ops-resale-field-wide">
                <span>Source / job</span>
                <input value={draft.source} onChange={(event) => updateDraft("source", event.target.value)} placeholder="Customer, job number, or pickup location" />
              </label>
              <label className="ops-resale-field">
                <span>Item cost</span>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.cost} onChange={(event) => updateDraft("cost", event.target.value)} />
              </label>
              <label className="ops-resale-field">
                <span>Asking price</span>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.askingPrice} onChange={(event) => updateDraft("askingPrice", event.target.value)} placeholder="0.00" />
              </label>
              <label className="ops-resale-field">
                <span>Sold price</span>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.soldPrice} onChange={(event) => updateDraft("soldPrice", event.target.value)} placeholder="0.00" />
              </label>
              <label className="ops-resale-field">
                <span>Marketplace</span>
                <input value={draft.marketplace} onChange={(event) => updateDraft("marketplace", event.target.value)} placeholder="Facebook, eBay, local buyer..." />
              </label>
              <label className="ops-resale-field ops-resale-field-full">
                <span>Notes</span>
                <textarea value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} placeholder="Condition, dimensions, listing details, buyer notes..." rows={3} />
              </label>
            </div>
            <div className="ops-resale-form-actions">
              <button type="button" className="ops-refresh-button" disabled={saving} onClick={saveDraft}>{saving ? "Saving..." : "Save item"}</button>
              <button type="button" className="ops-button" disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        ) : null}

        <div className="ops-resale-toolbar">
          <div className="ops-resale-filters" aria-label="Filter resale items">
            {(["active", "sold", "all"] as const).map((value) => (
              <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
                {value === "active" ? "Active" : value === "sold" ? "Sold" : "All"}
              </button>
            ))}
          </div>
          <div className="ops-muted">{visibleItems.length} {visibleItems.length === 1 ? "item" : "items"}</div>
        </div>

        <div className="ops-finance-table-scroll">
          <table className="ops-table ops-resale-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
                <th>Cost</th>
                <th>Asking</th>
                <th>Sold</th>
                <th>Net</th>
                <th><span className="ops-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.itemId}>
                  <td>
                    <strong>{item.itemName}</strong>
                    <small className="ops-table-subline">{[item.source, item.marketplace, item.acquiredDate].filter(Boolean).join(" · ") || "Details not added yet"}</small>
                    {item.notes ? <small className="ops-table-subline ops-resale-note">{item.notes}</small> : null}
                  </td>
                  <td><span className={`ops-resale-status is-${item.status}`}>{statusLabels[item.status]}</span></td>
                  <td className="ops-money">{money(item.cost)}</td>
                  <td className="ops-money">{item.askingPrice ? money(item.askingPrice) : "—"}</td>
                  <td className="ops-money">{item.soldPrice ? money(item.soldPrice) : "—"}</td>
                  <td className="ops-money">{item.status === "sold" ? money(item.soldPrice - item.cost) : "—"}</td>
                  <td className="ops-resale-row-actions">
                    <button type="button" onClick={() => setDraft(draftFromItem(item))}>Edit</button>
                    <button type="button" className="is-remove" disabled={saving} onClick={() => removeItem(item)}>Remove</button>
                  </td>
                </tr>
              ))}
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="ops-resale-empty">
                    <strong>{filter === "sold" ? "No sold items yet" : "No resale items here yet"}</strong>
                    <span>{filter === "active" ? "Add the first item you plan to resell." : "Items will appear here as their status changes."}</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="ops-resale-message" aria-live="polite">{message}</div>
      </div>
    </div>
  );
}
