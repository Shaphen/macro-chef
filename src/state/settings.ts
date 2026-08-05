import { create } from 'zustand';

import { getSettings, updateSettings } from '../db/queries/app-settings';
import type { Settings } from '../db/schema';

interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Omit<Settings, 'id'>>) => void;
  /**
   * Re-hydrate from SQLite. Needed when the row changes outside `update` —
   * today that's exactly one case: a backup import replacing the whole DB.
   */
  reload: () => void;
}

/**
 * In-memory mirror of the single settings row so targets/units render
 * everywhere without hitting SQLite per component. Hydrated at store
 * creation — root layout runs migrations before anything imports this.
 */
export const useSettings = create<SettingsState>((set) => ({
  settings: getSettings(),
  update: (patch) => set({ settings: updateSettings(patch) }),
  reload: () => set({ settings: getSettings() }),
}));
