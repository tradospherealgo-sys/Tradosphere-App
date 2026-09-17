import { Bell, PenSquare } from "lucide-react";
import { getAllNotifications } from "@/lib/admin/reads";
import { EmptyState } from "@/components/empty-state";
import { ComposeForm } from "./compose-form";

export default async function AdminNotificationsPage() {
  const notifications = await getAllNotifications();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Bell className="size-5 text-accent" aria-hidden />
          Notifications
        </h1>
        <p className="text-sm text-text-muted">
          Broadcasts go to every user (user_id is null); per-user notifications
          are written by backend flows (e.g. trade fills).
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-text">
          <PenSquare className="size-4 text-accent" aria-hidden />
          Compose broadcast
        </h2>
        <ComposeForm />
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
          <Bell className="size-4 text-accent" aria-hidden />
          Recent notifications
        </h2>
        {notifications.length === 0 ? (
          <EmptyState title="None sent yet" />
        ) : (
          <ul className="space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <p className="text-text">
                  {n.title} <span className="text-text-faint">· {n.kind}</span>
                  {n.user_id === null && <span className="text-accent"> · broadcast</span>}
                </p>
                {n.body && <p className="text-text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-text-faint">
                  {new Date(n.created_at).toLocaleString("en-IN")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
