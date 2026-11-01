import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRulesStore, type GatingRules } from '@/store/rulesStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  RotateCcw, ShieldCheck, FileCheck, FileSignature,
  FileText, CreditCard, BadgeCheck, CalendarClock,
} from 'lucide-react';

interface RuleMeta {
  key: keyof GatingRules;
  label: string;
  desc: string;
  group: 'Dispatch Gates' | 'Compliance';
  icon: typeof ShieldCheck;
}

const RULES: RuleMeta[] = [
  { key: 'requireQuote',          label: "Require Quote (QT'd)",          desc: 'A quote must be issued before dispatch.',                               group: 'Dispatch Gates', icon: FileCheck },
  { key: 'requireHaSent',         label: 'HA Sent',                        desc: 'Hire agreement must be sent to the customer.',                          group: 'Dispatch Gates', icon: FileSignature },
  { key: 'requireHaReceived',     label: 'Signed HA Received',             desc: 'Signed & stamped HA must be received back.',                            group: 'Dispatch Gates', icon: FileSignature },
  { key: 'requireLpo',            label: 'LPO Logged',                     desc: 'A valid LPO must be on file before dispatch.',                          group: 'Dispatch Gates', icon: FileText },
  { key: 'blockCreditHold',       label: 'Block Credit-Hold Customers',    desc: 'No new dispatches to credit-hold clients. Collections always allowed.', group: 'Dispatch Gates', icon: CreditCard },
  { key: 'requireTpcValid',       label: 'Require Valid TPC',              desc: 'Machine TPC certificate must be current.',                              group: 'Compliance',     icon: BadgeCheck },
  { key: 'warnOverdueInspection', label: 'Warn Overdue Inspection',        desc: 'Flag machines past their next inspection date.',                        group: 'Compliance',     icon: CalendarClock },
];

const GROUPS: RuleMeta['group'][] = ['Dispatch Gates', 'Compliance'];

export function RulesPage() {
  const rules  = useRulesStore((s) => s.rules);
  const toggle = useRulesStore((s) => s.toggle);
  const reset  = useRulesStore((s) => s.reset);

  const activeCount = Object.values(rules).filter(Boolean).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Rules & Configuration"
        description="Manage gating rules enforced across bookings and dispatch"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => { reset(); toast.success('Rules reset to defaults'); }}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reset defaults
          </Button>
        }
      />

      {/* Summary strip */}
      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
        <p className="text-sm text-emerald-800">
          <span className="font-semibold">{activeCount} of {RULES.length}</span> rules active — changes save automatically to this browser.
        </p>
      </div>

      {GROUPS.map((group) => {
        const groupRules = RULES.filter((r) => r.group === group);
        return (
          <div key={group} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </h3>
            {/* Card grid — 1 col on mobile, 2 cols on lg */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {groupRules.map((rule) => {
                const enabled = rules[rule.key];
                return (
                  <Card
                    key={rule.key}
                    className={cn(
                      'flex items-start gap-4 p-4 transition-colors',
                      enabled ? 'border-primary/30 bg-primary/5' : 'bg-background'
                    )}
                  >
                    {/* Icon */}
                    <span className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                      <rule.icon className="h-4 w-4" />
                    </span>

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground leading-snug">{rule.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{rule.desc}</p>
                    </div>

                    {/* Toggle — sits in its own column, never wraps */}
                    <button
                      onClick={() => toggle(rule.key)}
                      role="switch"
                      aria-checked={enabled}
                      aria-label={rule.label}
                      className={cn(
                        'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        enabled ? 'bg-primary' : 'bg-input'
                      )}
                    >
                      <span className={cn(
                        'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                        enabled ? 'translate-x-5' : 'translate-x-0'
                      )} />
                    </button>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
