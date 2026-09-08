import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import type {
  Course,
  CourseModule,
  Lesson,
  LessonProgress,
} from "@/types/database";

/**
 * Course catalogue reads.
 *
 * The paywall is an RLS policy on `lessons`, not a filter here: a locked
 * lesson's row simply does not come back. That means an unentitled viewer can
 * still see a course exists and what it covers (title, blurb, minutes come
 * from the module/course rows) but cannot read the body — which is the honest
 * shape of a paywall, and cannot be bypassed by querying PostgREST directly.
 */

export type CourseWithModules = Course & {
  course_modules: (CourseModule & { lessons: Lesson[] })[];
};

export async function getPublishedCourses(): Promise<Course[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("*")
    .eq("is_published", true)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

export async function getCourseBySlug(
  slug: string
): Promise<CourseWithModules | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("*, course_modules(*, lessons(*))")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;

  const modules = [...(data.course_modules ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((m) => ({
      ...m,
      lessons: [...(m.lessons ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));

  return { ...data, course_modules: modules };
}

export type LessonWithContext = Lesson & {
  course_modules: (CourseModule & { courses: Course | null }) | null;
};

export async function getLesson(
  courseSlug: string,
  lessonSlug: string
): Promise<LessonWithContext | null> {
  const course = await getCourseBySlug(courseSlug);
  if (!course) return null;

  const supabase = await createClient();
  const moduleIds = course.course_modules.map((m) => m.id);
  if (moduleIds.length === 0) return null;

  const { data } = await supabase
    .from("lessons")
    .select("*, course_modules(*, courses(*))")
    .eq("slug", lessonSlug)
    .in("module_id", moduleIds)
    .maybeSingle();
  return data ?? null;
}

export async function getMyLessonProgress(): Promise<LessonProgress[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("lesson_progress")
    .select("*")
    .eq("user_id", user.id);
  return data ?? [];
}

/**
 * True when the viewer may open the course's paid lessons. Delegates to the
 * same SQL function the RLS policy uses, so UI and data never disagree.
 */
export async function canAccessCourse(courseId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("can_access_course", {
    p_course_id: courseId,
  });
  return !error && data === true;
}

export async function getMyCoachMessages() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("coach_messages")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(200);
  return data ?? [];
}

// --- Admin ------------------------------------------------------------------

export async function getAllCourses(): Promise<CourseWithModules[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("*, course_modules(*, lessons(*))")
    .order("sort_order", { ascending: true });

  return (data ?? []).map((c) => ({
    ...c,
    course_modules: [...(c.course_modules ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({
        ...m,
        lessons: [...(m.lessons ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      })),
  }));
}
