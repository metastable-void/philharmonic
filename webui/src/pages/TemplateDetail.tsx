import { type FormEvent, type JSX, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  apiCall,
  type JsonValue,
  type RetireTemplateResponse,
  type TemplateDetail as TemplateDetailResponse,
  type UpdateTemplateRequest,
} from "../api/client";
import JsonViewer from "../components/JsonViewer";

export default function TemplateDetail(): JSX.Element {
  const { id } = useParams();
  const [template, setTemplate] = useState<TemplateDetailResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [scriptSource, setScriptSource] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      if (id === undefined) {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiCall<TemplateDetailResponse>(`workflows/templates/${id}`);
        if (isMounted) {
          setTemplate(response);
          setDisplayName(response.display_name ?? "");
          setScriptSource(response.script_source);
          setConfigText(JSON.stringify(response.abstract_config, null, 2));
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
  }, [id, refreshKey]);

  async function update(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (id === undefined) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const request: UpdateTemplateRequest = {
        display_name: displayName,
        script_source: scriptSource,
        abstract_config: parseJson(configText),
      };
      const response = await apiCall<TemplateDetailResponse>(`workflows/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(request),
      });
      setTemplate(response);
      setNotice("Template updated.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function retire(): Promise<void> {
    if (id === undefined || !window.confirm("Retire this template?")) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiCall<RetireTemplateResponse>(`workflows/templates/${id}/retire`, {
        method: "POST",
      });
      setNotice("Template retired.");
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <Link className="back-link" to="/templates">
            Templates
          </Link>
          <h1>Template Detail</h1>
          <p>{id}</p>
        </div>
        <button
          className="button danger"
          type="button"
          disabled={isSaving || template?.is_retired === true}
          onClick={() => void retire()}
        >
          Retire
        </button>
      </header>

      {error !== null && <div className="alert error">{error}</div>}
      {notice !== null && <div className="alert success">{notice}</div>}
      {isLoading && <div className="panel">Loading template.</div>}

      {template !== null && (
        <>
          <div className="detail-grid">
            <div>
              <span className="detail-label">Status</span>
              <strong className={template.is_retired ? "status-muted" : "status-ok"}>
                {template.is_retired ? "retired" : "active"}
              </strong>
            </div>
            <div>
              <span className="detail-label">Latest revision</span>
              <strong>{template.latest_revision}</strong>
            </div>
            <div>
              <span className="detail-label">Created</span>
              <strong>{formatTimestamp(template.created_at)}</strong>
            </div>
            <div>
              <span className="detail-label">Updated</span>
              <strong>{formatTimestamp(template.updated_at)}</strong>
            </div>
          </div>

          <form className="panel stack" onSubmit={update}>
            <div className="form-grid">
              <label className="field">
                <span>Display name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label className="field">
                <span>Script source</span>
                <textarea
                  value={scriptSource}
                  onChange={(event) => setScriptSource(event.target.value)}
                  rows={8}
                />
              </label>
              <label className="field">
                <span>Abstract config JSON</span>
                <textarea value={configText} onChange={(event) => setConfigText(event.target.value)} rows={8} />
              </label>
            </div>
            <div className="actions">
              <button className="button primary" type="submit" disabled={isSaving}>
                {isSaving ? "Saving" : "Update"}
              </button>
            </div>
          </form>

          <section className="panel">
            <h2>Stored fields</h2>
            <JsonViewer value={template} />
          </section>
        </>
      )}
    </section>
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
