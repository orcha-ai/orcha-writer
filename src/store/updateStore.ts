import { create } from 'zustand';
import { checkForUpdates, type UpdateCheckResult } from '../utils/update';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'failed';

interface UpdateState {
  status: UpdateStatus;
  availableUpdate: UpdateCheckResult | null;
  checking: boolean;
  error: string | null;
  lastCheckedAt: number | null;
  checkLatest: () => Promise<UpdateCheckResult | null>;
  clearAvailableUpdate: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '检查更新失败';
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  availableUpdate: null,
  checking: false,
  error: null,
  lastCheckedAt: null,

  checkLatest: async () => {
    set({ status: 'checking', checking: true, error: null });
    try {
      const result = await checkForUpdates();
      set({
        status: result.available ? 'available' : 'up-to-date',
        availableUpdate: result.available ? result : null,
        checking: false,
        error: null,
        lastCheckedAt: Date.now(),
      });
      return result;
    } catch (error) {
      set((state) => ({
        status: state.availableUpdate ? 'available' : 'failed',
        availableUpdate: state.availableUpdate,
        checking: false,
        error: getErrorMessage(error),
        lastCheckedAt: Date.now(),
      }));
      return null;
    }
  },

  clearAvailableUpdate: () => set((state) => ({
    availableUpdate: null,
    status: state.status === 'available' ? 'idle' : state.status,
  })),
}));
