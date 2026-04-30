import { type JSX, useEffect, useState } from "react";

import { apiCall, type HealthResponse, type VersionResponse } from "../api/client";

interface DashboardState {
  version: VersionResponse | null;
  health: HealthResponse | null;
}

export default function Dashboard(): JSX.Element {
  const [data, setData] = useState<DashboardState>({ version: null, health: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const [version, health] = await Promise.all([
          apiCall<VersionResponse>("_meta/version"),
          apiCall<HealthResponse>("_meta/health"),
        ]);
        if (isMounted) {
          setData({ version, health });
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

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>API status</p>
        </div>
      </header>

      {error !== null && <div className="alert error">{error}</div>}

      <div className="metrics-grid">
        <article className="metric">
          <span className="metric-label">Version</span>
          <strong>{isLoading ? "Loading" : data.version?.version ?? "Unavailable"}</strong>
        </article>
        <article className="metric">
          <span className="metric-label">Health</span>
          <strong className={data.health?.status === "ok" ? "status-ok" : ""}>
            {isLoading ? "Loading" : data.health?.status ?? "Unavailable"}
          </strong>
        </article>
      </div>
    </section>
  );
}

function messageFrom(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Request failed";
}
