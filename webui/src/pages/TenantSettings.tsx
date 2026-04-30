import { type FormEvent, type JSX, useEffect, useState } from "react";

import { apiCall, type TenantSettings, type UpdateTenantRequest } from "../api/client";

export default function TenantSettings(): JSX.Element {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiCall<TenantSettings>("tenant");
        if (isMounted) {
          setSettings(response);
          setDisplayName(response.display_name);
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
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const request: UpdateTenantRequest = { display_name: displayName };
      const response = await apiCall<TenantSettings>("tenant", {
        method: "PATCH",
        body: JSON.stringify(request),
      });
      setSettings(response);
      setDisplayName(response.display_name);
      setNotice("Tenant settings updated.");
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
          <h1>Tenant Settings</h1>
          <p>{isLoading ? "Loading" : settings?.tenant_id ?? "Unavailable"}</p>
        </div>
      </header>

      {error !== null && <div className="alert error">{error}</div>}
      {notice !== null && <div className="alert success">{notice}</div>}

      {settings !== null && (
        <>
          <div className="detail-grid">
            <div>
              <span className="detail-label">Status</span>
              <strong className={settings.status === "active" ? "status-ok" : "status-muted"}>
                {settings.status}
              </strong>
            </div>
            <div>
              <span className="detail-label">Latest revision</span>
              <strong>{settings.latest_revision}</strong>
            </div>
            <div>
              <span className="detail-label">Created</span>
              <strong>{formatTimestamp(settings.created_at)}</strong>
            </div>
            <div>
              <span className="detail-label">Updated</span>
              <strong>{formatTimestamp(settings.updated_at)}</strong>
            </div>
          </div>

          <form className="panel stack" onSubmit={submit}>
            <label className="field">
              <span>Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <div className="actions">
              <button className="button primary" type="submit" disabled={isSaving}>
                {isSaving ? "Saving" : "Update settings"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function messageFrom(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Request failed";
}
