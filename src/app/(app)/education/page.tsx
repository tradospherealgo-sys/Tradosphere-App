import Link from "next/link";
import { GraduationCap } from "lucide-react";
import {
  getMyCoachMessages,
  getMyLessonProgress,
  getPublishedCourses,
} from "@/lib/education/reads";
import { EmptyState } from "@/components/empty-state";
import { CoachThread } from "./coach-thread";

export const dynamic = "force-dynamic";

const LEVEL_STYLES: Record<string, string> = {
  beginner: "text-up",
  intermediate: "text-warn",
  advanced: "text-down",
};

export default async function EducationPage() {
  const [courses, progress, messages] = await Promise.all([
    getPublishedCourses(),
    getMyLessonProgress(),
    getMyCoachMessages(),
  ]);

  const completed = progress.filter((p) => p.progress_pct >= 100).length;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <GraduationCap className="size-5 text-accent" aria-hidden />
          Education &amp; Coach
        </h1>
        <p className="text-sm text-text-muted">
          Structured courses plus a private reflection journal.
          {completed > 0
            ? ` You have completed ${completed} lesson${completed === 1 ? "" : "s"}.`
            : ""}
        </p>
      </header>

      {courses.length === 0 ? (
        <EmptyState
          title="No published courses yet"
          body="Courses appear here once an admin publishes them from the Education CMS."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/education/${c.slug}`}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-accent hover:bg-surface-raised/30"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium text-text">{c.title}</p>
                <span
                  className={`shrink-0 text-xs capitalize ${LEVEL_STYLES[c.level] ?? ""}`}
                >
                  {c.level}
                </span>
              </div>
              {c.summary ? (
                <p className="mt-2 flex-1 text-sm text-text-muted">{c.summary}</p>
              ) : null}
              <p className="mt-4 text-xs">
                {c.is_free ? (
                  <span className="text-up">Free</span>
                ) : (
                  <span className="text-accent">
                    Requires {c.required_entitlement?.replace(/_/g, " ")}
                  </span>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}

      <CoachThread messages={messages} />
    </div>
  );
}
