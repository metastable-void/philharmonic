import { clearToken } from "../store/authSlice";
import { store } from "../store";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type UnixMillis = number;

export interface PaginatedResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export interface VersionResponse {
  version: string;
}

export interface HealthResponse {
  status: string;
}

export interface TemplateSummary {
  template_id: string;
  display_name: string | null;
  latest_revision: number;
  created_at: UnixMillis;
  updated_at: UnixMillis;
  is_retired: boolean;
}

export interface TemplateDetail extends TemplateSummary {
  script_source: string;
  abstract_config: JsonValue;
}

export interface CreateTemplateRequest {
  display_name: string;
  script_source: string;
  abstract_config: JsonValue;
}

export interface CreateTemplateResponse {
  template_id: string;
}

export interface UpdateTemplateRequest {
  display_name?: string;
  script_source?: string;
  abstract_config?: JsonValue;
}

export interface RetireTemplateResponse {
  template_id: string;
  is_retired: boolean;
}

export interface InstanceSummary {
  instance_id: string;
  template_id: string;
  template_revision: number;
  status: string;
  latest_revision: number;
  created_at: UnixMillis;
  updated_at: UnixMillis;
}

export interface InstanceDetail extends InstanceSummary {
  args: JsonValue;
  context: JsonValue;
}

export interface CreateInstanceRequest {
  template_id: string;
  args: JsonValue;
}

export interface CreateInstanceResponse {
  instance_id: string;
}

export interface InstanceRevision {
  revision_seq: number;
  created_at: UnixMillis;
  status: string;
  args: JsonValue;
  context: JsonValue;
}

export interface StepRecord {
  step_record_id: string;
  step_seq: number;
  outcome: string;
  created_at: UnixMillis;
  input: JsonValue;
  output: JsonValue | null;
  error: JsonValue | null;
  subject: JsonValue;
}

export interface ExecuteInstanceRequest {
  input: JsonValue;
}

export interface ExecuteInstanceResponse {
  output: JsonValue;
  context: JsonValue;
  status: string;
  step_seq: number;
}

export interface InstanceStatusResponse {
  instance_id: string;
  status: string;
}

export interface AuditEvent {
  audit_event_id: string;
  event_type: number;
  timestamp: UnixMillis;
  principal_id: string | null;
  event_data: JsonValue;
  created_at: UnixMillis;
}

export interface TenantSettings {
  tenant_id: string;
  display_name: string;
  status: string;
  created_at: UnixMillis;
  updated_at: UnixMillis;
  latest_revision: number;
}

export interface UpdateTenantRequest {
  display_name: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(errorMessage(status, body));
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

export async function apiCall<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiPath(path), {
    ...options,
    headers: requestHeaders(options),
  });

  const body = await responseBody(response);

  if (response.status === 401) {
    store.dispatch(clearToken());
    if (window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
  }

  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }

  return body as T;
}

export function queryString(params: Record<string, string | number | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) {
      search.set(key, String(value));
    }
  }
  const rendered = search.toString();
  return rendered.length === 0 ? "" : `?${rendered}`;
}

function apiPath(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  return normalized.startsWith("v1/") ? `/${normalized}` : `/v1/${normalized}`;
}

function requestHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);
  const token = store.getState().auth.token;

  if (token.length > 0) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const method = options.method?.toUpperCase();
  if ((method === "POST" || method === "PATCH") && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === "string") {
      return `${status}: ${error.message}`;
    }
  }

  if (typeof body === "string" && body.length > 0) {
    return `${status}: ${body}`;
  }

  return `request failed with status ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
