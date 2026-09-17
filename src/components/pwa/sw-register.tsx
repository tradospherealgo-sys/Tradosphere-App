"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      // Installability is a progressive enhancement; a failed registration
      // (e.g. unsupported browser) shouldn't affect normal app usage, but it
      // should be visible for debugging rather than silently disappearing.
      console.warn("Service worker registration failed", error);
    });
  }, []);

  return null;
}
