import Link from "next/link";
import { notFound } from "next/navigation";
import {
  canAccessCourse,
  getCourseBySlug,
  getMyLessonProgress,
} from "@/lib/education/reads";
import { EmptyState } from "@/components/empty-state";
import { EntitlementGate } from "@/components/entitlement-gate";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  const [progress, entitled] = await Promise.all([
    getMyLessonProgress(),
    canAccessCourse(course.id),
  ]);
  const pctByLesson = new Map(progress.map((p) => [p.lesson_id, p.progress_pct]));

  const lessons = course.course_modules.flatMap((m) => m.lessons);
  const done = lessons.filter((l) => (pctByLesson.get(l.id) ?? 0) >= 100).length;
  const totalMinutes = lessons.reduce((sum, l) => sum + l.minutes, 0);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <Link href="/education" className="text-xs text-accent">
          ← All courses
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text">{course.title}</h1>
        {course.summary ? (
          <p className="mt-1 text-sm text-text-muted">{course.summary}</p>
        ) : null}
        <p className="mt-2 text-xs text-text-faint">
          <span className="capitalize">{course.level}</span> · {lessons.length} lessons
          · {totalMinutes} min
          {lessons.length > 0 ? ` · ${done}/${lessons.length} complete` : ""}
        </p>
      </header>

      {course.description ? (
        <p className="max-w-2xl text-sm text-text-muted">{course.description}</p>
      ) : null}

      {!entitled && course.required_entitlement ? (
        <EntitlementGate
          entitlement={course.required_entitlement}
          feature={course.title}
        >
          {null}
        </EntitlementGate>
      ) : null}

      {course.course_modules.length === 0 ? (
        <EmptyState
          title="This course has no content yet"
          body="Its modules and lessons have not been published."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {course.course_modules.map((module) => (
            <section
              key={module.id}
              className="rounded-2xl border border-border bg-surface p-5"
            >
              <h2 className="text-sm font-medium text-text">{module.title}</h2>
              {module.summary ? (
                <p className="mt-1 text-xs text-text-faint">{module.summary}</p>
              ) : null}

              {module.lessons.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">No lessons yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col">
                  {module.lessons.map((lesson) => {
                    const pct = pctByLesson.get(lesson.id) ?? 0;
                    // A lesson row only exists here if RLS let it through, so
                    // anything listed is genuinely readable.
                    return (
                      <li key={lesson.id} className="border-t border-border first:border-0">
                        <Link
                          href={`/education/${course.slug}/${lesson.slug}`}
                          className="flex min-h-12 items-center justify-between gap-3 py-3"
                        >
                          <span className="flex-1 text-sm text-text">
                            {lesson.title}
                            {lesson.is_preview && !course.is_free ? (
                              <span className="ml-2 text-xs text-accent">preview</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-xs text-text-faint">
                            {lesson.minutes} min
                          </span>
                          <span
                            className={`shrink-0 text-xs ${
                              pct >= 100 ? "text-up" : "text-text-faint"
                            }`}
                          >
                            {pct >= 100 ? "done" : pct > 0 ? `${pct}%` : "—"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
