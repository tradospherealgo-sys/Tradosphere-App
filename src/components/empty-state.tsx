/**
 * Standard "no real data available" state. Used everywhere the app has
 * nothing genuine to show (provider not configured, upstream error, no
 * rows yet) instead of ever rendering a placeholder/fabricated value.
 */
export function EmptyState({
  title,
  body,
}: {
  title: string;
  body?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-bg/40 px-5 py-8 text-center">
      <p className="text-sm font-medium text-text-muted">{title}</p>
      {body ? <p className="mt-1 text-xs text-text-faint">{body}</p> : null}
    </div>
  );
}
