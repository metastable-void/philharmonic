import { type FormEvent, type JSX, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  apiCall,
  queryString,
  type CreateTemplateRequest,
  type CreateTemplateResponse,
  type JsonValue,
  type PaginatedResponse,
  type TemplateSummary,
} from "../api/client";
import Pagination from "../components/Pagination";

export default function Templates(): JSX.Element {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiCall<PaginatedResponse<TemplateSummary>>(
          `workflows/templates${queryString({ cursor: currentCursor, limit })}`,
        );
        if (isMounted) {
          setTemplates(response.items);
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
  }, [currentCursor, limit, refreshKey]);

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
          <h1>Workflow Templates</h1>
          <p>{isLoading ? "Loading" : `${templates.length} loaded`}</p>
        </div>
        <button className="button primary" type="button" onClick={() => setShowCreate((open) => !open)}>
          {showCreate ? "Close" : "Create"}
        </button>
      </header>

      {error !== null && <div className="alert error">{error}</div>}
      {showCreate && (
        <CreateTemplateForm
          onCreated={() => {
            setShowCreate(false);
            setCurrentCursor(null);
            setCursorHistory([]);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Display name</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.template_id}>
                <td>
                  <Link to={`/templates/${template.template_id}`} className="mono-link">
                    {template.template_id}
                  </Link>
                </td>
                <td>{template.display_name ?? "Untitled"}</td>
                <td>
                  <span className={template.is_retired ? "badge muted" : "badge good"}>
                    {template.is_retired ? "retired" : "active"}
                  </span>
                </td>
                <td>{formatTimestamp(template.created_at)}</td>
              </tr>
            ))}
            {!isLoading && templates.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No templates found.
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

interface CreateTemplateFormProps {
  onCreated: () => void;
}

function CreateTemplateForm({ onCreated }: CreateTemplateFormProps): JSX.Element {
  const [displayName, setDisplayName] = useState("");
  const [scriptSource, setScriptSource] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const request: CreateTemplateRequest = {
        display_name: displayName.trim(),
        script_source: scriptSource,
        abstract_config: parseJson(configText),
      };
      await apiCall<CreateTemplateResponse>("workflows/templates", {
        method: "POST",
        body: JSON.stringify(request),
      });
      onCreated();
      setDisplayName("");
      setScriptSource("");
      setConfigText("{}");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">
          <span>Display name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <label className="field">
          <span>Script source</span>
          <textarea
            value={scriptSource}
            onChange={(event) => setScriptSource(event.target.value)}
            rows={6}
            required
          />
        </label>
        <label className="field">
          <span>Abstract config JSON</span>
          <textarea value={configText} onChange={(event) => setConfigText(event.target.value)} rows={6} />
        </label>
      </div>
      {error !== null && <div className="alert error">{error}</div>}
      <div className="actions">
        <button className="button primary" type="submit" disabled={isSaving}>
          {isSaving ? "Creating" : "Create template"}
        </button>
      </div>
    </form>
  );
}

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function messageFrom(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Request failed";
}
