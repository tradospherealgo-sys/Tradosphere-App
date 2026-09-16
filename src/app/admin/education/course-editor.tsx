"use client";

import { useState, useTransition } from "react";
import {
  createCourseModule,
  deleteCourse,
  deleteCourseModule,
  deleteLesson,
  setCoursePublished,
  upsertCourse,
  upsertLesson,
} from "@/lib/education/actions";
import { fromProseBlocks } from "@/lib/education/prose";
import type { Course, CourseModule, Lesson, LessonKind } from "@/types/database";

type CourseTree = Course & {
  course_modules: (CourseModule & { lessons: Lesson[] })[];
};

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const KINDS: LessonKind[] = ["text", "video", "slides", "pdf", "quiz"];

const input =
  "min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-text";
const area =
  "w-full rounded-xl border border-border bg-surface-raised p-3 text-sm text-text";
const labelText = "text-xs text-text-faint";

export function CourseEditor({ courses }: { courses: CourseTree[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [lessonTarget, setLessonTarget] = useState<{
    moduleId: string;
    lesson: Lesson | null;
  } | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
    });
  }

  function submitCourse(form: FormData) {
    const draft = {
      slug: String(form.get("slug") ?? ""),
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      description: String(form.get("description") ?? ""),
      level: String(form.get("level") ?? "beginner") as (typeof LEVELS)[number],
      isFree: form.get("is_free") === "on",
      requiredEntitlement: String(form.get("required_entitlement") ?? ""),
      sortOrder: Number(form.get("sort_order") ?? 0),
    };
    setError(null);
    startTransition(async () => {
      const result = await upsertCourse(editingCourse?.id ?? null, draft);
      if (!result.ok) setError(result.error);
      else setEditingCourse(null);
    });
  }

  function submitLesson(form: FormData) {
    if (!lessonTarget) return;
    const draft = {
      slug: String(form.get("slug") ?? ""),
      title: String(form.get("title") ?? ""),
      blurb: String(form.get("blurb") ?? ""),
      kind: String(form.get("kind") ?? "text") as LessonKind,
      body: String(form.get("body") ?? ""),
      assetUrl: String(form.get("asset_url") ?? ""),
      minutes: Number(form.get("minutes") ?? 5),
      sortOrder: Number(form.get("sort_order") ?? 0),
      isPreview: form.get("is_preview") === "on",
    };
    setError(null);
    startTransition(async () => {
      const result = await upsertLesson(
        lessonTarget.lesson?.id ?? null,
        lessonTarget.moduleId,
        draft
      );
      if (!result.ok) setError(result.error);
      else setLessonTarget(null);
    });
  }

  function submitModule(courseId: string, form: FormData) {
    run(() =>
      createCourseModule(
        courseId,
        String(form.get("title") ?? ""),
        String(form.get("summary") ?? ""),
        Number(form.get("sort_order") ?? 0)
      )
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm text-down">
          {error}
        </p>
      ) : null}

      {courses.map((course) => (
        <section
          key={course.id}
          className="rounded-2xl border border-border bg-surface p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-text">
                {course.title}
                <span className="ml-2 font-mono text-xs text-text-faint">
                  {course.slug}
                </span>
              </h3>
              <p className="mt-1 text-xs text-text-faint">
                <span className="capitalize">{course.level}</span> ·{" "}
                {course.is_free
                  ? "free"
                  : `requires ${course.required_entitlement}`}{" "}
                · {course.is_published ? "published" : "draft"}
              </p>
            </div>
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                onClick={() => setEditingCourse(course)}
                className="inline-flex min-h-11 items-center text-accent"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setCoursePublished(course.id, !course.is_published))}
                className="inline-flex min-h-11 items-center text-text-muted disabled:opacity-50"
              >
                {course.is_published ? "Unpublish" : "Publish"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteCourse(course.id))}
                className="inline-flex min-h-11 items-center text-down disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {course.course_modules.map((module) => (
              <div key={module.id} className="rounded-xl border border-border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm text-text">{module.title}</p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteCourseModule(module.id))}
                    className="inline-flex min-h-11 items-center text-xs text-down disabled:opacity-50"
                  >
                    Delete module
                  </button>
                </div>

                <ul className="mt-2 flex flex-col">
                  {module.lessons.map((lesson) => (
                    <li
                      key={lesson.id}
                      className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm first:border-0"
                    >
                      <span className="flex-1 text-text-muted">
                        {lesson.title}
                        <span className="ml-2 text-xs text-text-faint">
                          {lesson.kind} · {lesson.minutes} min
                          {lesson.is_preview ? " · preview" : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setLessonTarget({ moduleId: module.id, lesson })}
                        className="inline-flex min-h-11 items-center text-xs text-accent"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteLesson(lesson.id))}
                        className="inline-flex min-h-11 items-center text-xs text-down disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                  {module.lessons.length === 0 ? (
                    <li className="py-2 text-xs text-text-faint">No lessons yet.</li>
                  ) : null}
                </ul>

                <button
                  type="button"
                  onClick={() => setLessonTarget({ moduleId: module.id, lesson: null })}
                  className="mt-2 inline-flex min-h-11 items-center text-xs text-accent"
                >
                  + Add lesson
                </button>
              </div>
            ))}

            <form
              action={(form) => submitModule(course.id, form)}
              className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-4"
            >
              <label className="flex min-w-40 flex-1 flex-col gap-1">
                <span className={labelText}>New module title</span>
                <input name="title" required className={input} />
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1">
                <span className={labelText}>Summary</span>
                <input name="summary" className={input} />
              </label>
              <label className="flex w-24 flex-col gap-1">
                <span className={labelText}>Order</span>
                <input
                  name="sort_order"
                  type="number"
                  defaultValue={course.course_modules.length + 1}
                  className={input}
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="min-h-11 rounded-xl border border-border px-4 text-sm text-text disabled:opacity-50"
              >
                Add module
              </button>
            </form>
          </div>
        </section>
      ))}

      {/* Keyed so switching targets remounts the uncontrolled inputs. */}
      <form
        key={editingCourse?.id ?? "new-course"}
        action={submitCourse}
        className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5"
      >
        <p className="text-sm font-medium text-text">
          {editingCourse ? `Edit “${editingCourse.title}”` : "Create a course"}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelText}>Title</span>
            <input name="title" required defaultValue={editingCourse?.title ?? ""} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Slug</span>
            <input name="slug" required defaultValue={editingCourse?.slug ?? ""} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Level</span>
            <select name="level" defaultValue={editingCourse?.level ?? "beginner"} className={input}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Sort order</span>
            <input
              name="sort_order"
              type="number"
              defaultValue={editingCourse?.sort_order ?? 0}
              className={input}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 md:col-span-2">
            <input
              name="is_free"
              type="checkbox"
              defaultChecked={editingCourse?.is_free ?? true}
              className="size-4"
            />
            <span className="text-sm text-text">Free course</span>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelText}>
              Required entitlement (paid courses only — must match a plan&rsquo;s key)
            </span>
            <input
              name="required_entitlement"
              defaultValue={editingCourse?.required_entitlement ?? ""}
              placeholder="courses_premium"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelText}>Summary</span>
            <input name="summary" defaultValue={editingCourse?.summary ?? ""} className={input} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelText}>Description</span>
            <textarea
              name="description"
              rows={3}
              defaultValue={editingCourse?.description ?? ""}
              className={area}
            />
          </label>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl bg-accent px-5 text-sm font-medium text-bg disabled:opacity-50"
          >
            {editingCourse ? "Save course" : "Create course"}
          </button>
          {editingCourse ? (
            <button
              type="button"
              onClick={() => setEditingCourse(null)}
              className="min-h-11 rounded-xl border border-border px-5 text-sm text-text-muted"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {lessonTarget ? (
        <form
          key={lessonTarget.lesson?.id ?? `new-${lessonTarget.moduleId}`}
          action={submitLesson}
          className="flex flex-col gap-3 rounded-2xl border border-accent bg-surface p-5"
        >
          <p className="text-sm font-medium text-text">
            {lessonTarget.lesson ? `Edit “${lessonTarget.lesson.title}”` : "New lesson"}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={labelText}>Title</span>
              <input
                name="title"
                required
                defaultValue={lessonTarget.lesson?.title ?? ""}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Slug</span>
              <input
                name="slug"
                required
                defaultValue={lessonTarget.lesson?.slug ?? ""}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Kind</span>
              <select
                name="kind"
                defaultValue={lessonTarget.lesson?.kind ?? "text"}
                className={input}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Minutes</span>
              <input
                name="minutes"
                type="number"
                defaultValue={lessonTarget.lesson?.minutes ?? 5}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Sort order</span>
              <input
                name="sort_order"
                type="number"
                defaultValue={lessonTarget.lesson?.sort_order ?? 0}
                className={input}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                name="is_preview"
                type="checkbox"
                defaultChecked={lessonTarget.lesson?.is_preview ?? false}
                className="size-4"
              />
              <span className="text-sm text-text">Free preview</span>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelText}>Blurb</span>
              <input
                name="blurb"
                defaultValue={lessonTarget.lesson?.blurb ?? ""}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelText}>
                Asset URL (https — required for video / slides / PDF lessons)
              </span>
              <input
                name="asset_url"
                defaultValue={lessonTarget.lesson?.asset_url ?? ""}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelText}>
                Body — blank line between blocks. A block&rsquo;s first line becomes
                its heading when more lines follow.
              </span>
              <textarea
                name="body"
                rows={10}
                defaultValue={
                  lessonTarget.lesson ? fromProseBlocks(lessonTarget.lesson.body) : ""
                }
                className={area}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-xl bg-accent px-5 text-sm font-medium text-bg disabled:opacity-50"
            >
              Save lesson
            </button>
            <button
              type="button"
              onClick={() => setLessonTarget(null)}
              className="min-h-11 rounded-xl border border-border px-5 text-sm text-text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
