"use client";

import { useState, useTransition } from "react";
import { setUserRole, setUserActive } from "@/lib/admin/actions";
import type { AppRole } from "@/types/database";

export function ClientRow({
  id,
  email,
  fullName,
  role,
  isActive,
}: {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-raised/30">
      <td className="px-4 py-2 text-text">{fullName ?? "—"}</td>
      <td className="px-4 py-2 text-text-muted">{email}</td>
      <td className="px-4 py-2">
        <select
          defaultValue={role}
          disabled={pending}
          onChange={(e) => {
            const value = e.target.value as AppRole;
            startTransition(async () => {
              const res = await setUserRole(id, value);
              setError(res.ok ? null : res.error);
            });
          }}
          className="rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text"
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <span className={isActive ? "text-up" : "text-down"}>
          {isActive ? "active" : "inactive"}
        </span>
      </td>
      <td className="px-4 py-2">
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await setUserActive(id, !isActive);
              setError(res.ok ? null : res.error);
            })
          }
          className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          {isActive ? "Deactivate" : "Activate"}
        </button>
        {error && <p className="mt-1 text-xs text-down">{error}</p>}
      </td>
    </tr>
  );
}
