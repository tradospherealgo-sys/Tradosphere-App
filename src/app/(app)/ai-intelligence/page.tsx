import { getAiAgentVerdicts } from "@/lib/app-data/reads";
import { EmptyState } from "@/components/empty-state";

const verdictColor: Record<string, string> = {
  BULLISH: "text-up",
  BEARISH: "text-down",
  NEUTRAL: "text-text-muted",
};

export default async function AiIntelligencePage() {
  const verdicts = await getAiAgentVerdicts();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">AI Intelligence</h1>
        <p className="text-sm text-text-muted">
          Per-agent theses and rationale, stored in the database by the
          agents themselves (or an admin) — this page only renders what
          already exists, it never generates a verdict client-side.
        </p>
      </header>

      {verdicts.length === 0 ? (
        <EmptyState
          title="No agent verdicts recorded yet"
          body="Verdicts appear here once an AI agent (or admin) publishes one for a symbol."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {verdicts.map((v) => (
            <div key={v.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium text-text">
                  {v.agent_name}
                  {v.focus ? <span className="text-text-faint"> · {v.focus}</span> : null}
                </p>
                <span className={`text-xs ${verdictColor[v.verdict] ?? "text-text-muted"}`}>
                  {v.verdict}
                  {v.confidence !== null ? ` · ${v.confidence}%` : ""}
                </span>
              </div>
              <p className="text-sm text-text-muted">{v.symbol}</p>
              {v.thesis && <p className="mt-2 text-sm text-text">{v.thesis}</p>}
              {v.rationale && v.rationale.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {v.rationale.map((r, i) => (
                    <li key={i} className="text-xs text-text-muted">
                      <span className="font-medium text-text-faint">{r.h}:</span> {r.p}
                    </li>
                  ))}
                </ul>
              )}
              {v.suggested_action && (
                <p className="mt-3 text-xs text-accent">{v.suggested_action}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
