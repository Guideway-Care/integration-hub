import { useQuery } from "@tanstack/react-query";
import { fetchNiceData, NICE_ENDPOINTS } from "@/lib/api";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  refreshInterval: number;
  setRefreshInterval: (interval: number) => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      refreshInterval: 10000,
      setRefreshInterval: (interval) => set({ refreshInterval: interval }),
      isPaused: false,
      setIsPaused: (paused) => set({ isPaused: paused }),
    }),
    { name: "nice-monitor-settings" }
  )
);

export function useNiceQuery(key: keyof typeof NICE_ENDPOINTS) {
  const { refreshInterval, isPaused } = useSettingsStore();
  
  return useQuery({
    queryKey: ["nice-data", key],
    queryFn: () => fetchNiceData(NICE_ENDPOINTS[key]),
    refetchInterval: isPaused ? false : refreshInterval,
    refetchIntervalInBackground: true,
    retry: 2,
    staleTime: 2000, // Short stale time for real-time feel
  });
}

export function useAllNiceData() {
  const agents = useNiceQuery("agents");
  const skills = useNiceQuery("skills");
  const teams = useNiceQuery("teams");
  const contacts = useNiceQuery("contacts");

  return { agents, skills, teams, contacts };
}
