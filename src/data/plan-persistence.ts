import type { ExperimentPlan } from '../experiment/types';

export interface StoredExperimentPlan {
  id: string;
  plan: ExperimentPlan;
  status: string;
}
export interface PlanStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface PlanServer {
  getActive(userId: string): Promise<StoredExperimentPlan | null>;
  insert(userId: string, plan: ExperimentPlan): Promise<StoredExperimentPlan>;
  setNextCheckDate(userId: string, date: string): Promise<void>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createPlanPersistence(storage: PlanStorage, server: PlanServer) {
  const pendingKey = (userId: string) => `@experiment_pending_plan:${userId}`;
  const activeKey = (userId: string) => `@experiment_active_plan:${userId}`;
  async function confirm(userId: string, stored: StoredExperimentPlan): Promise<StoredExperimentPlan> {
    await storage.setItem(activeKey(userId), JSON.stringify(stored));
    await storage.removeItem(pendingKey(userId));
    return stored;
  }
  return {
    async getPendingPlan(userId: string): Promise<ExperimentPlan | null> {
      const raw = await storage.getItem(pendingKey(userId));
      return raw === null ? null : JSON.parse(raw) as ExperimentPlan;
    },
    async getActivePlan(userId: string): Promise<StoredExperimentPlan | null> {
      // Never turn a failed server read or an unconfirmed local attempt into success.
      const active = await server.getActive(userId);
      if (active) await confirm(userId, active);
      else await storage.removeItem(activeKey(userId));
      return active;
    },
    async savePlan(userId: string, plan: ExperimentPlan): Promise<StoredExperimentPlan> {
      await storage.setItem(pendingKey(userId), JSON.stringify(plan));
      const existing = await server.getActive(userId);
      if (existing) {
        if (canonical(existing.plan) !== canonical(plan)) throw new Error('You already have a non-cancelled experiment plan.');
        return confirm(userId, existing);
      }
      let stored: StoredExperimentPlan;
      try {
        stored = await server.insert(userId, plan);
      } catch (error) {
        // Resolve a lost response or simultaneous retry only after a fresh server read.
        const recovered = await server.getActive(userId);
        if (!recovered || canonical(recovered.plan) !== canonical(plan)) throw error;
        stored = recovered;
      }
      return confirm(userId, stored);
    },
    async saveNextCheckDate(userId: string, date: string): Promise<void> {
      await server.setNextCheckDate(userId, date);
      const key = `@experiment_setup:${userId}`;
      const raw = await storage.getItem(key);
      if (raw !== null) await storage.setItem(key, JSON.stringify({ ...JSON.parse(raw), nextCheckDate: date }));
    },
  };
}
