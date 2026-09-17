import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { getCourseBySlug, getLesson, getMyLessonProgress } from "@/lib/education/reads";
import { EmptyState } from "@/components/empty-state";
import { LessonProgressButton } from "./lesson-progress";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  text: "Reading",
  video: "Video",
  slides: "Slides",
  pdf: "PDF",
  quiz: "Quiz",
};

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; lesson: string }>;
}) {
  const { slug, lesson: lessonSlug } = await params;

  // A locked lesson is filtered out by RLS, so "not found" and "not entitled"
  // are the same response here on purpose — the paywall does not leak which
  // lessons exist behind it.
  const [lesson, course] = await Promise.all([
    getLesson(slug, lessonSlug),
    getCourseBySlug(slug),
  ]);
  if (!lesson || !course) notFound();

  const progress = await getMyLessonProgress();
  const pct = progress.find((p) => p.lesson_id === lesson.id)?.progress_pct ?? 0;

  const ordered = course.course_modules.flatMap((m) => m.lessons);
  const index = ordered.findIndex((l) => l.id === lesson.id);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <Link
          href={`/education/${course.slug}`}
          className="inline-flex items-center gap-1 text-xs text-accent"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text">{lesson.title}</h1>
        <p className="mt-1 text-xs text-text-faint">
          {KIND_LABELS[lesson.kind] ?? lesson.kind} · {lesson.minutes} min
        </p>
        {lesson.blurb ? (
          <p className="mt-2 max-w-2xl text-sm text-text-muted">{lesson.blurb}</p>
        ) : null}
      </header>

      <article className="max-w-2xl">
        {lesson.body.length === 0 && !lesson.asset_url ? (
          <EmptyState
            title="This lesson has no content yet"
            body="Its author has not added the material."
          />
        ) : null}

        {lesson.body.length > 0 ? (
          <div className="flex flex-col gap-5">
            {lesson.body.map((block, i) => (
              <section key={i}>
                {block.h ? (
                  <h2 className="text-sm font-medium text-text">{block.h}</h2>
                ) : null}
                <p className="mt-1 text-sm leading-relaxed text-text-muted">
                  {block.p}
                </p>
              </section>
            ))}
          </div>
        ) : null}

        {lesson.asset_url ? (
          <a
            href={lesson.asset_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-5 text-sm text-accent hover:border-accent"
          >
            Open {KIND_LABELS[lesson.kind]?.toLowerCase() ?? "material"}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </article>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <LessonProgressButton lessonId={lesson.id} progressPct={pct} />
        <div className="ml-auto flex gap-3">
          {prev ? (
            <Link
              href={`/education/${course.slug}/${prev.slug}`}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Previous
            </Link>
          ) : null}
          {next ? (
            <Link
              href={`/education/${course.slug}/${next.slug}`}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
            >
              Next
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
