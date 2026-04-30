import type { JSX } from "react";

interface PaginationProps {
  canGoBack: boolean;
  nextCursor: string | null;
  limit: number;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
  onLimitChange: (limit: number) => void;
}

const pageSizes = [10, 25, 50, 100];

export default function Pagination({
  canGoBack,
  nextCursor,
  limit,
  disabled = false,
  onPrevious,
  onNext,
  onLimitChange,
}: PaginationProps): JSX.Element {
  return (
    <div className="pagination">
      <label className="compact-field">
        <span>Rows</span>
        <select
          value={limit}
          disabled={disabled}
          onChange={(event) => onLimitChange(Number(event.target.value))}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="pagination-buttons">
        <button
          className="button secondary"
          type="button"
          disabled={disabled || !canGoBack}
          onClick={onPrevious}
        >
          Previous
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={disabled || nextCursor === null}
          onClick={() => {
            if (nextCursor !== null) {
              onNext(nextCursor);
            }
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
