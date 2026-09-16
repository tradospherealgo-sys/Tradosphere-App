"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a progressive enhancement; a failed registration
      // (e.g. unsupported browser) shouldn't affect normal app usage.
    });
  }, []);

  return null;
}
