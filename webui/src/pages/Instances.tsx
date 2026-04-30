import { type FormEvent, type JSX, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  apiCall,
  queryString,
  type CreateInstanceRequest,
  type CreateInstanceResponse,
  type InstanceSummary,
  type JsonValue,
  type PaginatedResponse,
  type TemplateSummary,
} from "../api/client";
import Pagination from "../components/Pagination";

export default function Instances(): JSX.Element {
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
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
        const [instancePage, templatePage] = await Promise.all([
          apiCall<PaginatedResponse<InstanceSummary>>(
            `workflows/instances${queryString({ cursor: currentCursor, limit })}`,
          ),
          apiCall<PaginatedResponse<TemplateSummary>>("workflows/templates?limit=200"),
        ]);
        if (isMounted) {
          setInstances(instancePage.items);
          setNextCursor(instancePage.next_cursor);
          setTemplates(templatePage.items);
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
          <h1>Workflow Instances</h1>
          <p>{isLoading ? "Loading" : `${instances.length} loaded`}</p>
        </div>
        <button className="button primary" type="button" onClick={() => setShowCreate((open) => !open)}>
          {showCreate ? "Close" : "Create"}
        </button>
      </header>

      {error !== null && <div className="alert error">{error}</div>}
      {showCreate && (
        <CreateInstanceForm
          templates={templates.filter((template) => !template.is_retired)}
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
              <th>Template</th>
              <th>State</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((instance) => (
              <tr key={instance.instance_id}>
                <td>
                  <Link to={`/instances/${instance.instance_id}`} className="mono-link">
                    {instance.instance_id}
                  </Link>
                </td>
                <td>
                  <Link to={`/templates/${instance.template_id}`} className="mono-link">
                    {instance.template_id}
                  </Link>
                </td>
                <td>
                  <span className={`badge ${statusClass(instance.status)}`}>{instance.status}</span>
                </td>
                <td>{formatTimestamp(instance.created_at)}</td>
              </tr>
            ))}
            {!isLoading && instances.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No instances found.
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

interface CreateInstanceFormProps {
  templates: TemplateSummary[];
  onCreated: () => void;
}

function CreateInstanceForm({ templates, onCreated }: CreateInstanceFormProps): JSX.Element {
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState(templates[0]?.template_id ?? "");
  const [argsText, setArgsText] = useState("{}");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (templateId.length === 0 && templates[0] !== undefined) {
      setTemplateId(templates[0].template_id);
    }
  }, [templateId, templates]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const request: CreateInstanceRequest = {
        template_id: templateId,
        args: parseJson(argsText),
      };
      const response = await apiCall<CreateInstanceResponse>("workflows/instances", {
        method: "POST",
        body: JSON.stringify(request),
      });
      onCreated();
      navigate(`/instances/${response.instance_id}`);
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
          <span>Template</span>
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
            {templates.map((template) => (
              <option key={template.template_id} value={template.template_id}>
                {template.display_name ?? template.template_id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Args JSON</span>
          <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={6} />
        </label>
      </div>
      {templates.length === 0 && <div className="alert warning">No active templates are available.</div>}
      {error !== null && <div className="alert error">{error}</div>}
      <div className="actions">
        <button className="button primary" type="submit" disabled={isSaving || templates.length === 0}>
          {isSaving ? "Creating" : "Create instance"}
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

function statusClass(status: string): string {
  if (status === "completed") {
    return "good";
  }
  if (status === "failed" || status === "cancelled") {
    return "bad";
  }
  return "info";
}

function messageFrom(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Request failed";
}
