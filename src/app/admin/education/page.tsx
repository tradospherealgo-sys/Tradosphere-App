import { getAllCourses } from "@/lib/education/reads";
import { CourseEditor } from "./course-editor";

export const dynamic = "force-dynamic";

export default async function AdminEducationPage() {
  const courses = await getAllCourses();

  const lessonCount = courses.reduce(
    (sum, c) => sum + c.course_modules.reduce((n, m) => n + m.lessons.length, 0),
    0
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Education CMS</h1>
        <p className="text-sm text-text-muted">
          {courses.length} courses, {lessonCount} lessons. A paid course needs an
          entitlement key that matches one published by a subscription plan —
          otherwise no client can open it.
        </p>
      </header>

      <CourseEditor courses={courses} />
    </div>
  );
}
