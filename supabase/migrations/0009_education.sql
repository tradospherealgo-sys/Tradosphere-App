-- ============================================================================
-- EDUCATION — COURSES / MODULES / LESSONS
--
-- The V1 schema had a single flat `education_modules` table: good enough for
-- six standalone explainers, insufficient for a course catalogue with paid
-- access. Rather than run both models side by side (two competing sources of
-- truth for "what can this user learn"), this migration introduces the
-- three-level course structure and migrates the existing flat modules into it
-- as lessons of a free foundation course, then drops the old tables.
--
--   courses          catalogue entry; free or entitlement-gated
--     course_modules   ordered sections within a course
--       lessons          the actual content unit
--
-- Access model: a lesson is readable if its course is free, or the lesson is
-- flagged `is_preview`, or the viewer holds the course's required entitlement.
-- That check lives in an RLS policy, not only in the UI, so a client cannot
-- read paid lesson bodies by querying PostgREST directly.
-- ============================================================================

do $$ begin
  create type public.lesson_kind as enum ('text', 'video', 'slides', 'pdf', 'quiz');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- courses
-- ----------------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  description text,
  cover_url text,
  level text not null default 'beginner'
    check (level in ('beginner', 'intermediate', 'advanced')),
  is_free boolean not null default true,
  -- Entitlement key required when is_free = false, e.g. 'courses_premium'.
  required_entitlement text,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_paid_needs_entitlement
    check (is_free or required_entitlement is not null)
);

-- ----------------------------------------------------------------------------
-- course_modules
-- ----------------------------------------------------------------------------
create table if not exists public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  summary text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_modules_course_idx
  on public.course_modules(course_id, sort_order);

-- ----------------------------------------------------------------------------
-- lessons
--
-- `body` holds structured prose blocks ([{h, p}, ...]) for text lessons;
-- `asset_url` points at externally hosted media (PPT/PDF/video) for the other
-- kinds. Nothing is generated here — an empty course renders as empty.
-- ----------------------------------------------------------------------------
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  slug text not null,
  title text not null,
  blurb text,
  kind public.lesson_kind not null default 'text',
  body jsonb not null default '[]'::jsonb,
  asset_url text,
  minutes integer not null default 5 check (minutes >= 0),
  sort_order integer not null default 0,
  -- A free taster inside an otherwise paid course.
  is_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, slug)
);

create index if not exists lessons_module_idx on public.lessons(module_id, sort_order);

-- ----------------------------------------------------------------------------
-- progress
-- ----------------------------------------------------------------------------
create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index if not exists lesson_progress_user_idx on public.lesson_progress(user_id);

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, course_id)
);

do $$
declare t text;
begin
  foreach t in array array['courses', 'course_modules', 'lessons', 'lesson_progress']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                      for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Access helper, reused by RLS and by the app layer.
-- ----------------------------------------------------------------------------
create or replace function public.can_access_course(p_course_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id
      and (
        public.is_admin()
        or (
          c.is_published
          and (c.is_free or public.has_entitlement(c.required_entitlement))
        )
      )
  );
$$;

grant execute on function public.can_access_course(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Migrate the flat V1 modules into a free foundation course, then retire them.
-- ----------------------------------------------------------------------------
do $$
declare
  v_course_id uuid;
  v_module_id uuid;
  v_row record;
begin
  if to_regclass('public.education_modules') is null then
    return;
  end if;

  insert into public.courses(slug, title, summary, level, is_free, is_published, sort_order)
  values ('trading-foundations', 'Trading Foundations',
          'The core ideas every simulated trader should hold before placing a first order.',
          'beginner', true, true, 1)
  on conflict (slug) do nothing;

  select id into v_course_id from public.courses where slug = 'trading-foundations';

  insert into public.course_modules(course_id, title, summary, sort_order)
  values (v_course_id, 'Fundamentals', 'Chain reading, sizing, decay, psychology and risk.', 1)
  on conflict do nothing;

  select id into v_module_id
    from public.course_modules where course_id = v_course_id order by sort_order limit 1;

  for v_row in
    execute 'select slug, title, blurb, minutes, sort_order, content, is_published
               from public.education_modules order by sort_order'
  loop
    insert into public.lessons(module_id, slug, title, blurb, kind, body, minutes, sort_order, is_preview)
    values (v_module_id, v_row.slug, v_row.title, v_row.blurb, 'text',
            v_row.content, v_row.minutes, v_row.sort_order, true)
    on conflict (module_id, slug) do nothing;
  end loop;

  -- Carry forward what learners had already completed.
  if to_regclass('public.education_progress') is not null then
    execute '
      insert into public.lesson_progress(user_id, lesson_id, progress_pct, completed_at)
      select ep.user_id, l.id, ep.progress_pct, ep.completed_at
        from public.education_progress ep
        join public.education_modules em on em.id = ep.module_id
        join public.lessons l on l.slug = em.slug
      on conflict (user_id, lesson_id) do nothing';
  end if;
end $$;

drop table if exists public.education_progress;
drop table if exists public.education_modules;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.courses            enable row level security;
alter table public.course_modules     enable row level security;
alter table public.lessons            enable row level security;
alter table public.lesson_progress    enable row level security;
alter table public.course_enrollments enable row level security;

drop policy if exists courses_read_published on public.courses;
create policy courses_read_published on public.courses
  for select using (is_published or is_admin());

drop policy if exists courses_admin_write on public.courses;
create policy courses_admin_write on public.courses
  for all using (is_admin()) with check (is_admin());

drop policy if exists course_modules_read on public.course_modules;
create policy course_modules_read on public.course_modules
  for select using (
    is_admin()
    or exists (select 1 from public.courses c where c.id = course_id and c.is_published)
  );

drop policy if exists course_modules_admin_write on public.course_modules;
create policy course_modules_admin_write on public.course_modules
  for all using (is_admin()) with check (is_admin());

-- The paywall itself. A lesson body is only selectable when the viewer is
-- entitled to the course, or the lesson is an explicit free preview.
drop policy if exists lessons_read_entitled on public.lessons;
create policy lessons_read_entitled on public.lessons
  for select using (
    is_admin()
    or exists (
      select 1
      from public.course_modules m
      join public.courses c on c.id = m.course_id
      where m.id = module_id
        and c.is_published
        and (is_preview or c.is_free or public.has_entitlement(c.required_entitlement))
    )
  );

drop policy if exists lessons_admin_write on public.lessons;
create policy lessons_admin_write on public.lessons
  for all using (is_admin()) with check (is_admin());

drop policy if exists lesson_progress_owner on public.lesson_progress;
create policy lesson_progress_owner on public.lesson_progress
  for all using (is_self(user_id) or is_admin()) with check (is_self(user_id) or is_admin());

drop policy if exists course_enrollments_owner on public.course_enrollments;
create policy course_enrollments_owner on public.course_enrollments
  for all using (is_self(user_id) or is_admin()) with check (is_self(user_id) or is_admin());
