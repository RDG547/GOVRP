import React, { useEffect, useSyncExternalStore } from "react";
import {
  supabase,
  supabaseUrl,
  supabasePublishableKey,
} from "@/lib/supabaseClient";
import {
  acceptWorldRuntime,
  getWorldRuntime,
  loadWorldRuntime,
  subscribeWorldRuntime,
} from "@/lib/worldRuntime";

export const useWorldRuntime = () =>
  useSyncExternalStore(subscribeWorldRuntime, getWorldRuntime, getWorldRuntime);
export function WorldRuntimeProvider({ children }) {
  useEffect(() => {
    const refresh = () => {
      void loadWorldRuntime(supabaseUrl, supabasePublishableKey, true).catch(
        () => {},
      );
    };
    refresh();
    const channel = supabase
      .channel("world-runtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "system_settings",
          filter: "key=eq.world_runtime",
        },
        (payload) => acceptWorldRuntime(payload.new?.value),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      void supabase.removeChannel(channel);
    };
  }, []);
  return children;
}
