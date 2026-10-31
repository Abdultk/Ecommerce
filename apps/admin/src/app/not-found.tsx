import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm opacity-80">
        That page doesn&apos;t exist, or it has moved.
      </p>
      <Link href="/" className="btn btn-primary mt-6 inline-flex">
        Back to dashboard
      </Link>
    </div>
  );
}
