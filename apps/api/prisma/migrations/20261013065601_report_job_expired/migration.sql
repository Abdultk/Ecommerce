-- Security review M6: report files are deleted after the retention period.
-- Hand-edited: Prisma also proposes dropping the raw-SQL search indexes; omitted.

-- AlterEnum
ALTER TYPE "ReportJobStatus" ADD VALUE 'EXPIRED';
