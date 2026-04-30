import { type FormEvent, type JSX, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  apiCall,
  queryString,
  type ExecuteInstanceRequest,
  type ExecuteInstanceResponse,
  type InstanceDetail as InstanceDetailResponse,
  type InstanceRevision,
  type InstanceStatusResponse,
  type JsonValue,
  type PaginatedResponse,
  type StepRecord,
} from "../api/client";
import JsonViewer from "../components/JsonViewer";
import Pagination from "../components/Pagination";

type DetailTab = "history" | "steps";

export default function InstanceDetail(): JSX.Element {
  const { id } = useParams();
  const [instance, setInstance] = useState<InstanceDetailResponse | null>(null);
  const [history, setHistory] = useState<InstanceRevision[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>("history");
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyStack, setHistoryStack] = useState<Array<string | null>>([]);
  const [historyNext, setHistoryNext] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(25);
  const [stepsCursor, setStepsCursor] = useState<string | null>(null);
  const [stepsStack, setStepsStack] = useState<Array<string | null>>([]);
  const [stepsNext, setStepsNext] = useState<string | null>(null);
  const [stepsLimit, setStepsLimit] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionRunning, setIsActionRunning] = useState(false);
  const [showExecute, setShowExecute] = useState(false);
  const [executeInput, setExecuteInput] = useState("{}");
  const [executeResult, setExecuteResult] = useState<ExecuteInstanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [stepsRefreshKey, setStepsRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadInstance(): Promise<void> {
      if (id === undefined) {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiCall<InstanceDetailResponse>(`workflows/instances/${id}`);
        if (isMounted) {
          setInstance(response);
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

    void loadInstance();
    return () => {
      isMounted = false;
    };
  }, [id, refreshKey]);

  useEffect(() => {
    let isMounted = true;

    async function loadHistory(): Promise<void> {
      if (id === undefined) {
        return;
      }
      try {
        const response = await apiCall<PaginatedResponse<InstanceRevision>>(
          `workflows/instances/${id}/history${queryString({ cursor: historyCursor, limit: historyLimit })}`,
        );
        if (isMounted) {
          setHistory(response.items);
          setHistoryNext(response.next_cursor);
        }
      } catch (caught) {
        if (isMounted) {
          setError(messageFrom(caught));
        }
      }
    }

    void loadHistory();
    return () => {
      isMounted = false;
    };
  }, [id, historyCursor, historyLimit, historyRefreshKey]);

  useEffect(() => {
    let isMounted = true;

    async function loadSteps(): Promise<void> {
      if (id === undefined) {
        return;
      }
      try {
        const response = await apiCall<PaginatedResponse<StepRecord>>(
          `workflows/instances/${id}/steps${queryString({ cursor: stepsCursor, limit: stepsLimit })}`,
        );
        if (isMounted) {
          setSteps(response.items);
          setStepsNext(response.next_cursor);
        }
      } catch (caught) {
        if (isMounted) {
          setError(messageFrom(caught));
        }
      }
    }

    void loadSteps();
    return () => {
      isMounted = false;
    };
  }, [id, stepsCursor, stepsLimit, stepsRefreshKey]);

  async function execute(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (id === undefined) {
      return;
    }

    setIsActionRunning(true);
    setError(null);
    setNotice(null);
    try {
      const request: ExecuteInstanceRequest = { input: parseJson(executeInput) };
      const response = await apiCall<ExecuteInstanceResponse>(`workflows/instances/${id}/execute`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      setExecuteResult(response);
      setNotice(`Executed step ${response.step_seq}; instance is ${response.status}.`);
      refreshAll();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setIsActionRunning(false);
    }
  }

  async function postAction(action: "complete" | "cancel"): Promise<void> {
    if (id === undefined) {
      return;
    }

    setIsActionRunning(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiCall<InstanceStatusResponse>(`workflows/instances/${id}/${action}`, {
        method: "POST",
      });
      setNotice(`Instance is ${response.status}.`);
      refreshAll();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setIsActionRunning(false);
    }
  }

  function refreshAll(): void {
    setRefreshKey((key) => key + 1);
    setHistoryRefreshKey((key) => key + 1);
    setStepsRefreshKey((key) => key + 1);
  }

  function changeHistoryLimit(value: number): void {
    setHistoryLimit(value);
    setHistoryCursor(null);
    setHistoryStack([]);
  }

  function changeStepsLimit(value: number): void {
    setStepsLimit(value);
    setStepsCursor(null);
    setStepsStack([]);
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <Link className="back-link" to="/instances">
            Instances
          </Link>
          <h1>Instance Detail</h1>
          <p>{id}</p>
        </div>
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => setShowExecute((open) => !open)}>
            Execute Step
          </button>
          <button
            className="button primary"
            type="button"
            disabled={isActionRunning}
            onClick={() => void postAction("complete")}
          >
            Complete
          </button>
          <button
            className="button danger"
            type="button"
            disabled={isActionRunning}
            onClick={() => void postAction("cancel")}
          >
            Cancel
          </button>
        </div>
      </header>

      {error !== null && <div className="alert error">{error}</div>}
      {notice !== null && <div className="alert success">{notice}</div>}
      {isLoading && <div className="panel">Loading instance.</div>}

      {instance !== null && (
        <>
          <div className="detail-grid">
            <div>
              <span className="detail-label">State</span>
              <strong className={`status-text ${statusClass(instance.status)}`}>{instance.status}</strong>
            </div>
            <div>
              <span className="detail-label">Template</span>
              <Link to={`/templates/${instance.template_id}`} className="mono-link">
                {instance.template_id}
              </Link>
            </div>
            <div>
              <span className="detail-label">Template revision</span>
              <strong>{instance.template_revision}</strong>
            </div>
            <div>
              <span className="detail-label">Updated</span>
              <strong>{formatTimestamp(instance.updated_at)}</strong>
            </div>
          </div>

          {showExecute && (
            <form className="panel stack" onSubmit={execute}>
              <label className="field">
                <span>Input JSON</span>
                <textarea value={executeInput} onChange={(event) => setExecuteInput(event.target.value)} rows={6} />
              </label>
              <div className="actions">
                <button className="button primary" type="submit" disabled={isActionRunning}>
                  {isActionRunning ? "Executing" : "Execute"}
                </button>
              </div>
              {executeResult !== null && <JsonViewer value={executeResult} />}
            </form>
          )}

          <div className="split-grid">
            <section className="panel">
              <h2>Args</h2>
              <JsonViewer value={instance.args} />
            </section>
            <section className="panel">
              <h2>Context</h2>
              <JsonViewer value={instance.context} />
            </section>
          </div>

          <div className="tabs" role="tablist" aria-label="Instance records">
            <button
              className={activeTab === "history" ? "tab active" : "tab"}
              type="button"
              onClick={() => setActiveTab("history")}
            >
              History
            </button>
            <button
              className={activeTab === "steps" ? "tab active" : "tab"}
              type="button"
              onClick={() => setActiveTab("steps")}
            >
              Steps
            </button>
          </div>

          {activeTab === "history" ? (
            <HistoryTable
              items={history}
              cursorStack={historyStack}
              nextCursor={historyNext}
              limit={historyLimit}
              onPrevious={() => {
                const previous = historyStack[historyStack.length - 1] ?? null;
                setHistoryStack((stack) => stack.slice(0, -1));
                setHistoryCursor(previous);
              }}
              onNext={(cursor) => {
                setHistoryStack((stack) => [...stack, historyCursor]);
                setHistoryCursor(cursor);
              }}
              onLimitChange={changeHistoryLimit}
            />
          ) : (
            <StepsTable
              items={steps}
              cursorStack={stepsStack}
              nextCursor={stepsNext}
              limit={stepsLimit}
              onPrevious={() => {
                const previous = stepsStack[stepsStack.length - 1] ?? null;
                setStepsStack((stack) => stack.slice(0, -1));
                setStepsCursor(previous);
              }}
              onNext={(cursor) => {
                setStepsStack((stack) => [...stack, stepsCursor]);
                setStepsCursor(cursor);
              }}
              onLimitChange={changeStepsLimit}
            />
          )}
        </>
      )}
    </section>
  );
}

interface PaginatedTableProps {
  cursorStack: Array<string | null>;
  nextCursor: string | null;
  limit: number;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
  onLimitChange: (limit: number) => void;
}

interface HistoryTableProps extends PaginatedTableProps {
  items: InstanceRevision[];
}

function HistoryTable({
  items,
  cursorStack,
  nextCursor,
  limit,
  onPrevious,
  onNext,
  onLimitChange,
}: HistoryTableProps): JSX.Element {
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Revision</th>
              <th>Status</th>
              <th>Created</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            {items.map((revision) => (
              <tr key={revision.revision_seq}>
                <td>{revision.revision_seq}</td>
                <td>
                  <span className={`badge ${statusClass(revision.status)}`}>{revision.status}</span>
                </td>
                <td>{formatTimestamp(revision.created_at)}</td>
                <td>
                  <JsonViewer value={revision.context} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No history records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        canGoBack={cursorStack.length > 0}
        nextCursor={nextCursor}
        limit={limit}
        onPrevious={onPrevious}
        onNext={onNext}
        onLimitChange={onLimitChange}
      />
    </>
  );
}

interface StepsTableProps extends PaginatedTableProps {
  items: StepRecord[];
}

function StepsTable({
  items,
  cursorStack,
  nextCursor,
  limit,
  onPrevious,
  onNext,
  onLimitChange,
}: StepsTableProps): JSX.Element {
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Outcome</th>
              <th>Created</th>
              <th>Output</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {items.map((step) => (
              <tr key={step.step_record_id}>
                <td>{step.step_seq}</td>
                <td>
                  <span className={`badge ${step.outcome === "success" ? "good" : "bad"}`}>{step.outcome}</span>
                </td>
                <td>{formatTimestamp(step.created_at)}</td>
                <td>
                  <JsonViewer value={step.output} />
                </td>
                <td>
                  <JsonViewer value={step.error} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No step records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        canGoBack={cursorStack.length > 0}
        nextCursor={nextCursor}
        limit={limit}
        onPrevious={onPrevious}
        onNext={onNext}
        onLimitChange={onLimitChange}
      />
    </>
  );
}

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function statusClass(status: string): string {
  if (status === "completed" || status === "running") {
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
