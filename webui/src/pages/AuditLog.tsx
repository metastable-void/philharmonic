import { type FormEvent, type JSX, useEffect, useState } from "react";

import { apiCall, queryString, type AuditEvent, type PaginatedResponse } from "../api/client";
import JsonViewer from "../components/JsonViewer";
import Pagination from "../components/Pagination";

export default function AuditLog(): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [appliedSince, setAppliedSince] = useState<string | null>(null);
  const [appliedUntil, setAppliedUntil] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiCall<PaginatedResponse<AuditEvent>>(
          `audit${queryString({
            cursor: currentCursor,
            limit,
            since: appliedSince === null ? null : startOfDate(appliedSince),
            until: appliedUntil === null ? null : endOfDate(appliedUntil),
          })}`,
        );
        if (isMounted) {
          setEvents(response.items);
          setNextCursor(response.next_cursor);
        }
      } catch (caught) {
        if (isMounted) {
          setError(messageFrom(caught));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, [appliedSince, appliedUntil, currentCursor, limit]);

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedSince(since.length === 0 ? null : since);
    setAppliedUntil(until.length === 0 ? null : until);
    setCurrentCursor(null);
    setCursorHistory([]);
  }

  function resetFilters(): void {
    setSince("");
    setUntil("");
    setAppliedSince(null);
    setAppliedUntil(null);
    setCurrentCursor(null);
    setCursorHistory([]);
  }

  function goNext(cursor: string): void {
    setCursorHistory((history) => [...history, currentCursor]);
    setCurrentCursor(cursor);
  }

  function goPrevious(): void {
    const previous = cursorHistory[cursorHistory.length - 1] ?? null;
    setCursorHistory((history) => history.slice(0, -1));
    setCurrentCursor(previous);
  }

  function changeLimit(value: number): void {
    setLimit(value);
    setCurrentCursor(null);
    setCursorHistory([]);
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>{isLoading ? "Loading" : `${events.length} loaded`}</p>
        </div>
      </header>

      <form className="filter-bar" onSubmit={applyFilters}>
        <label className="compact-field">
          <span>Since</span>
          <input type="date" value={since} onChange={(event) => setSince(event.target.value)} />
        </label>
        <label className="compact-field">
          <span>Until</span>
          <input type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
        </label>
        <button className="button primary" type="submit">
          Apply
        </button>
        <button className="button secondary" type="button" onClick={resetFilters}>
          Reset
        </button>
      </form>

      {error !== null && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Event type</th>
              <th>Principal</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.audit_event_id}>
                <td>{formatTimestamp(event.timestamp)}</td>
                <td>{event.event_type}</td>
                <td className="mono">{event.principal_id ?? "none"}</td>
                <td>
                  <JsonViewer value={event.event_data} />
                </td>
              </tr>
            ))}
            {!isLoading && events.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No audit events found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        canGoBack={cursorHistory.length > 0}
        nextCursor={nextCursor}
        limit={limit}
        disabled={isLoading}
        onPrevious={goPrevious}
        onNext={goNext}
        onLimitChange={changeLimit}
      />
    </section>
  );
}

function startOfDate(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

function endOfDate(value: string): number {
  return new Date(`${value}T23:59:59.999`).getTime();
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function messageFrom(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Request failed";
}
