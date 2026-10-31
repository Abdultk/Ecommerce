"use client";

import { useCallback, useState } from "react";
import type { ReportJob } from "@hp/contracts";
import { DEFAULT_POLL_BASE_MS } from "@/lib/report-polling";
import { CreateReportForm } from "./CreateReportForm";
import { reportName, finishedMessage } from "./report-labels";
import { ReportJobsTable } from "./ReportJobsTable";

type ReportsManagerProps = {
  /** First poll delay; tests pass a few milliseconds. */
  pollBaseMs?: number;
};

/** Create export jobs and follow them; status changes are announced in one live region. */
export function ReportsManager({ pollBaseMs = DEFAULT_POLL_BASE_MS }: ReportsManagerProps) {
  const [announcement, setAnnouncement] = useState("");
  const announceFinished = useCallback(
    (job: ReportJob) => setAnnouncement(finishedMessage(job)),
    [],
  );
  const announceCreated = useCallback(
    (job: ReportJob) => setAnnouncement(`${reportName(job)} queued.`),
    [],
  );

  return (
    <div className="space-y-6">
      <CreateReportForm onCreated={announceCreated} />
      <p role="status" aria-live="polite" className="text-sm text-ink-800">
        {announcement}
      </p>
      <section aria-labelledby="recent-reports-title" className="space-y-2">
        <h2 id="recent-reports-title" className="eyebrow text-muted">
          Recent reports
        </h2>
        <ReportJobsTable pollBaseMs={pollBaseMs} onFinished={announceFinished} />
      </section>
    </div>
  );
}
