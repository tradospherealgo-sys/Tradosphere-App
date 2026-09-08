"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/admin/audit";
import type { LessonKind } from "@/types/database";
import { toProseBlocks } from "@/lib/education/prose";

/**
 * Education mutations.
 *
 * Learner writes are limited to their own progress rows, which RLS already
 * scopes to `auth.uid()`. Everything that changes course content re-checks
 * admin status, because a Server Action is reachable over the network
 * independently of the page that imports it.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

// --- Learner ----------------------------------------------------------------

export async function updateLessonProgress(
  lessonId: string,
  progressPct: number
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const clamped = Math.max(0, Math.min(100, Math.round(progressPct)));
  const { error } = await supabase.from("lesson_progress").upsert(
    {
      user_id: user.id,
      lesson_id: lessonId,
      progress_pct: clamped,
      completed_at: clamped >= 100 ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,lesson_id" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/education", "layout");
  return { ok: true };
}

export async function enrollInCourse(courseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Enrolment is a bookmark, not an entitlement — it does not unlock a paid
  // course. The lessons RLS policy still decides what is readable.
  const { error } = await supabase
    .from("course_enrollments")
    .upsert({ user_id: user.id, course_id: courseId }, { onConflict: "user_id,course_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/education", "layout");
  return { ok: true };
}

/**
 * Appends a learner reflection to their coach thread. There is deliberately
 * no assistant reply: no LLM is wired in, and inventing one would be a
 * fabricated response presented as coaching.
 */
export async function postCoachMessage(content: string): Promise<ActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: "Message cannot be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("coach_messages")
    .insert({ user_id: user.id, role: "user", content: trimmed });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/education");
  return { ok: true };
}

// --- Admin CMS --------------------------------------------------------------

function revalidateEducation() {
  revalidatePath("/education", "layout");
  revalidatePath("/admin/education");
}

export type CourseDraft = {
  slug: string;
  title: string;
  summary: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  isFree: boolean;
  requiredEntitlement: string;
  sortOrder: number;
};

export async function upsertCourse(
  id: string | null,
  draft: CourseDraft
): Promise<ActionResult> {
  const { user } = await requireAdmin();

  const slug = draft.slug.trim().toLowerCase();
  const title = draft.title.trim();
  if (!slug || !title) return { ok: false, error: "Slug and title are required." };
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, error: "Slug may contain only lowercase letters, digits and hyphens." };
  }

  const entitlement = draft.requiredEntitlement.trim().toLowerCase();
  // Mirrors the courses_paid_needs_entitlement check constraint, so the admin
  // gets a readable message instead of a raw Postgres violation.
  if (!draft.isFree && !entitlement) {
    return {
      ok: false,
      error: "A paid course needs an entitlement key, otherwise nobody can open it.",
    };
  }

  const row = {
    slug,
    title,
    summary: draft.summary.trim() || null,
    description: draft.description.trim() || null,
    level: draft.level,
    is_free: draft.isFree,
    required_entitlement: draft.isFree ? null : entitlement,
    sort_order: draft.sortOrder,
  };

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("courses").update(row).eq("id", id).select("id").single()
    : await supabase.from("courses").insert(row).select("id").single();
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, id ? "course.update" : "course.create", "courses", data?.id);
  revalidateEducation();
  return { ok: true };
}

export async function setCoursePublished(
  id: string,
  isPublished: boolean
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("courses")
    .update({ is_published: isPublished })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(
    user.id,
    isPublished ? "course.publish" : "course.unpublish",
    "courses",
    id
  );
  revalidateEducation();
  return { ok: true };
}

export async function deleteCourse(id: string): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "course.delete", "courses", id);
  revalidateEducation();
  return { ok: true };
}

export async function createCourseModule(
  courseId: string,
  title: string,
  summary: string,
  sortOrder: number
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  if (!title.trim()) return { ok: false, error: "Title is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_modules")
    .insert({
      course_id: courseId,
      title: title.trim(),
      summary: summary.trim() || null,
      sort_order: sortOrder,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "course_module.create", "course_modules", data?.id);
  revalidateEducation();
  return { ok: true };
}

export async function deleteCourseModule(id: string): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("course_modules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "course_module.delete", "course_modules", id);
  revalidateEducation();
  return { ok: true };
}

export type LessonDraft = {
  slug: string;
  title: string;
  blurb: string;
  kind: LessonKind;
  /** Blank-line-separated prose. First line of each block becomes its heading. */
  body: string;
  assetUrl: string;
  minutes: number;
  sortOrder: number;
  isPreview: boolean;
};

export async function upsertLesson(
  id: string | null,
  moduleId: string,
  draft: LessonDraft
): Promise<ActionResult> {
  const { user } = await requireAdmin();

  const slug = draft.slug.trim().toLowerCase();
  const title = draft.title.trim();
  if (!slug || !title) return { ok: false, error: "Slug and title are required." };
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, error: "Slug may contain only lowercase letters, digits and hyphens." };
  }

  const assetUrl = draft.assetUrl.trim();
  if (assetUrl && !/^https:\/\//i.test(assetUrl)) {
    return { ok: false, error: "Asset URL must be an https:// link." };
  }
  // A slides/pdf/video lesson with no asset renders as an empty player, which
  // looks broken rather than unfinished. Require the link up front.
  if (draft.kind !== "text" && draft.kind !== "quiz" && !assetUrl) {
    return { ok: false, error: `A ${draft.kind} lesson needs an asset URL.` };
  }

  const row = {
    module_id: moduleId,
    slug,
    title,
    blurb: draft.blurb.trim() || null,
    kind: draft.kind,
    body: toProseBlocks(draft.body),
    asset_url: assetUrl || null,
    minutes: Math.max(0, Math.round(draft.minutes)),
    sort_order: draft.sortOrder,
    is_preview: draft.isPreview,
  };

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("lessons").update(row).eq("id", id).select("id").single()
    : await supabase.from("lessons").insert(row).select("id").single();
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, id ? "lesson.update" : "lesson.create", "lessons", data?.id);
  revalidateEducation();
  return { ok: true };
}

export async function deleteLesson(id: string): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("lessons").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "lesson.delete", "lessons", id);
  revalidateEducation();
  return { ok: true };
}
