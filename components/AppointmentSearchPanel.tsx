"use client";

import { useState, type FormEvent } from "react";

type AppointmentSearchResult = {
  appointmentId: string | null;
  date: string;
  time: string;
  jkNumber: string;
  appointmentType: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentType: string;
  total: string;
  status: string;
};

type SearchFields = {
  startDate: string;
  endDate: string;
  appointmentType: string;
  status: string;
  jkNumber: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  checkNumber: string;
  followupStartDate: string;
  followupEndDate: string;
  poNumber: string;
  franchise: string;
};

const EMPTY_FIELDS: SearchFields = {
  startDate: "",
  endDate: "",
  appointmentType: "",
  status: "",
  jkNumber: "",
  firstName: "",
  lastName: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  checkNumber: "",
  followupStartDate: "",
  followupEndDate: "",
  poNumber: "",
  franchise: "",
};

function phoneHref(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 10 ? `tel:${digits}` : null;
}

function appointmentHref(appointmentId: string | null): string | null {
  return appointmentId ? `https://junkware.junk-king.com/franchise/appointment.aspx?id=${appointmentId}` : null;
}

export default function AppointmentSearchPanel() {
  const [fields, setFields] = useState<SearchFields>(EMPTY_FIELDS);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<AppointmentSearchResult[] | null>(null);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [searchedAt, setSearchedAt] = useState("");

  function updateField(key: keyof SearchFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (searching) return;
    if (!Object.values(fields).some((value) => value.trim())) {
      setError("Enter at least one search field.");
      return;
    }
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/appointment-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "The appointment search could not be completed.");
      }
      setResults(payload.results || []);
      setHasMorePages(Boolean(payload.hasMorePages));
      setSearchedAt(String(payload.searchedAt || ""));
    } catch (searchError) {
      setResults(null);
      setError(searchError instanceof Error ? searchError.message : "The appointment search could not be completed.");
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setFields(EMPTY_FIELDS);
    setResults(null);
    setError("");
    setHasMorePages(false);
  }

  return (
    <section className="ops-card ops-appointment-search">
      <form className="ops-appointment-search-form" onSubmit={runSearch}>
        <div className="ops-appointment-search-grid">
          <label>
            <span>JK #</span>
            <input type="text" value={fields.jkNumber} onChange={(event) => updateField("jkNumber", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>PO Number</span>
            <input type="text" value={fields.poNumber} onChange={(event) => updateField("poNumber", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Check #</span>
            <input type="text" value={fields.checkNumber} onChange={(event) => updateField("checkNumber", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Start date (appt)</span>
            <input type="text" value={fields.startDate} onChange={(event) => updateField("startDate", event.target.value)} placeholder="M/D/YYYY" disabled={searching} />
          </label>
          <label>
            <span>End date (appt)</span>
            <input type="text" value={fields.endDate} onChange={(event) => updateField("endDate", event.target.value)} placeholder="M/D/YYYY" disabled={searching} />
          </label>
          <label>
            <span>Appt type</span>
            <select value={fields.appointmentType} onChange={(event) => updateField("appointmentType", event.target.value)} disabled={searching}>
              <option value="">Any</option>
              <option value="1">Estimate</option>
              <option value="2">Job</option>
            </select>
          </label>
          <label>
            <span>Appt status</span>
            <select value={fields.status} onChange={(event) => updateField("status", event.target.value)} disabled={searching}>
              <option value="">Any</option>
              <option value="1,4">Awaiting Confirmation/Confirmed</option>
              <option value="8">Completed</option>
              <option value="9">Cancelled</option>
            </select>
          </label>
          <label>
            <span>Franchise</span>
            <select value={fields.franchise} onChange={(event) => updateField("franchise", event.target.value)} disabled={searching}>
              <option value="">Any</option>
              <option value="399">Baton Rouge</option>
              <option value="484">Jefferson Parish</option>
              <option value="352">New Orleans</option>
              <option value="477">Northshore</option>
            </select>
          </label>
          <label>
            <span>First name</span>
            <input type="text" value={fields.firstName} onChange={(event) => updateField("firstName", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Last name</span>
            <input type="text" value={fields.lastName} onChange={(event) => updateField("lastName", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Company</span>
            <input type="text" value={fields.company} onChange={(event) => updateField("company", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Email</span>
            <input type="text" value={fields.email} onChange={(event) => updateField("email", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Phone</span>
            <input type="text" value={fields.phone} onChange={(event) => updateField("phone", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Address</span>
            <input type="text" value={fields.address} onChange={(event) => updateField("address", event.target.value)} disabled={searching} />
          </label>
          <label>
            <span>Followup start</span>
            <input type="text" value={fields.followupStartDate} onChange={(event) => updateField("followupStartDate", event.target.value)} placeholder="M/D/YYYY" disabled={searching} />
          </label>
          <label>
            <span>Followup end</span>
            <input type="text" value={fields.followupEndDate} onChange={(event) => updateField("followupEndDate", event.target.value)} placeholder="M/D/YYYY" disabled={searching} />
          </label>
        </div>
        <div className="ops-appointment-search-actions">
          <button type="submit" disabled={searching}>{searching ? "Searching JunkWare…" : "Search"}</button>
          <button type="button" onClick={clearSearch} disabled={searching}>Clear</button>
        </div>
      </form>

      {error ? <div className="ops-appointment-search-error" role="alert">{error}</div> : null}

      {results ? (
        <div className="ops-appointment-search-results">
          <div className="ops-table-note">
            {results.length === 0
              ? "No JunkWare appointments matched that search."
              : `${results.length} appointment${results.length === 1 ? "" : "s"} found${hasMorePages ? " (more results exist in JunkWare — narrow your search to see them all)" : ""}.`}
            {searchedAt ? <span className="ops-appointment-search-timestamp"> Searched live just now.</span> : null}
          </div>
          {results.length > 0 ? (
            <div className="ops-table-scroll">
              <table className="ops-table">
                <thead>
                  <tr><th>Date</th><th>Time</th><th>JK #</th><th>Type</th><th>Customer</th><th>Payment</th><th>Total</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {results.map((result, index) => {
                    const tel = phoneHref(result.customerPhone);
                    const href = appointmentHref(result.appointmentId);
                    return (
                      <tr key={`${result.jkNumber}-${index}`}>
                        <td>{result.date || "—"}</td>
                        <td>{result.time || "—"}</td>
                        <td>
                          {href ? (
                            <a className="ops-mini-link" href={href} target="_blank" rel="noreferrer"><strong>{result.jkNumber}</strong></a>
                          ) : (
                            <strong>{result.jkNumber || "—"}</strong>
                          )}
                        </td>
                        <td>{result.appointmentType || "—"}</td>
                        <td>
                          {result.customerName || "—"}
                          {result.customerAddress ? <div className="ops-appointment-search-address">{result.customerAddress}</div> : null}
                          {tel ? <a className="ops-mini-link" href={tel}>{result.customerPhone}</a> : null}
                        </td>
                        <td>{result.paymentType || "—"}</td>
                        <td>{result.total || "—"}</td>
                        <td>{result.status || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ops-appointment-search-empty">
          Search JunkWare appointments by JK #, PO number, check number, date range, customer info, or status. Results are fetched live and are not stored in OpsCenter.
        </div>
      )}
    </section>
  );
}
