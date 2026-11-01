import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Operational gating rules (overview §8.3 — legal dispatch gates).
 * These control which checks must pass before a booking can be dispatched.
 * When a rule is enabled, it's enforced; when disabled, that gate is skipped.
 *
 * Persisted so config survives reloads.
 */
export interface GatingRules {
  requireQuote: boolean;        // QT'd — quote issued (or Transfer)
  requireHaSent: boolean;       // HA sent to customer
  requireHaReceived: boolean;   // signed & stamped HA received (Recd)
  requireLpo: boolean;          // LPO logged
  blockCreditHold: boolean;     // block dispatch to credit-hold customers
  requireTpcValid: boolean;     // machine TPC certificate must be valid
  warnOverdueInspection: boolean; // warn if next inspection is overdue
}

export const DEFAULT_RULES: GatingRules = {
  requireQuote: true,
  requireHaSent: true,
  requireHaReceived: true,
  requireLpo: true,
  blockCreditHold: true,
  requireTpcValid: true,
  warnOverdueInspection: false,
};

interface RulesState {
  rules: GatingRules;
  toggle: (key: keyof GatingRules) => void;
  reset: () => void;
}

export const useRulesStore = create<RulesState>()(
  persist(
    (set) => ({
      rules: { ...DEFAULT_RULES },
      toggle: (key) =>
        set((state) => ({ rules: { ...state.rules, [key]: !state.rules[key] } })),
      reset: () => set({ rules: { ...DEFAULT_RULES } }),
    }),
    { name: 'fleet-gating-rules-v1' }
  )
);
