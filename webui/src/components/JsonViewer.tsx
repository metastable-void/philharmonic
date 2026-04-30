import type { JSX } from "react";

interface JsonViewerProps {
  value: unknown;
}

export default function JsonViewer({ value }: JsonViewerProps): JSX.Element {
  return <pre className="json-viewer">{renderJson(value)}</pre>;
}

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}
