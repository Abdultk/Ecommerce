"use client";

import Link from "next/link";
import type { ReportFormat } from "@hp/contracts";
import { Can } from "@/components/Can";
import { useCreateReport } from "@/components/reports/use-reports";
import type { ApiRange } from "@/lib/analytics-range";
import { errorMessage } from "@/lib/session";

const FORMATS: readonly { format: ReportFormat; label: string }[] = [
  { format: "csv", label: "Export CSV" },
  { format: "xlsx", label: "Export Excel" },
];

/** Queues a "sales by day" report job for the range on screen (analytics:export). */
export function ExportButtons({ range }: { range: ApiRange | null }) {
  const create = useCreateReport();
  return (
    <Can perm="analytics:export">
      <div className="flex flex-wrap items-center gap-2">
        {FORMATS.map(({ format, label }) => (
          <button
            key={format}
            type="button"
            className="btn btn-secondary"
            disabled={range === null || create.isPending}
            onClick={() => range && create.mutate({ type: "sales-by-day", format, range })}
          >
            {label}
          </button>
        ))}
        <p role="status" className="basis-full text-sm text-muted">
          {create.isSuccess && (
            <>
              Export queued. Track it on{" "}
              <Link href="/reports" className="btn-link">
                Reports
              </Link>
              .
            </>
          )}
        </p>
        {create.isError && (
          <p role="alert" className="error-text basis-full">
            {errorMessage(create.error)}
          </p>
        )}
      </div>
    </Can>
  );
}
