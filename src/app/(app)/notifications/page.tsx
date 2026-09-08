import {
  getMyNotifications,
  getUnreadNotificationCount,
} from "@/lib/app-data/reads";
import { EmptyState } from "@/components/empty-state";
import { MarkAllReadButton, MarkReadButton } from "./mark-read-button";

export const dynamic = "force-dynamic";

const kindColor: Record<string, string> = {
  trade: "text-accent",
  signal: "text-up",
  system: "text-warn",
  announcement: "text-warn",
};

export default async function NotificationsPage() {
  const [notifications, unread] = await Promise.all([
    getMyNotifications(),
    getUnreadNotificationCount(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Notifications</h1>
          <p className="text-sm text-text-muted">
            Signal releases and status changes, order fills, and subscription
            events — plus broadcast announcements from admins.
          </p>
        </div>
        <MarkAllReadButton unread={unread} />
      </header>

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                n.is_read || n.user_id === null
                  ? "border-border bg-surface"
                  : "border-accent/50 bg-surface-raised"
              }`}
            >
              <div className="min-w-0">
                <p className={kindColor[n.kind] ?? "text-text"}>{n.title}</p>
                {n.body ? (
                  <p className="break-words text-text-muted">{n.body}</p>
                ) : null}
                <p className="mt-1 text-xs text-text-faint">
                  {new Date(n.created_at).toLocaleString("en-IN")}
                  {n.user_id === null ? " · broadcast" : ""}
                </p>
              </div>
              {!n.is_read && n.user_id !== null ? (
                <MarkReadButton id={n.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
