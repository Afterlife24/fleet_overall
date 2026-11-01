import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore, demoAccounts, type UserRole } from '@/store/authStore';
import { BRAND } from '@/constants/brand';
import { BrandLogo } from '@/components/common/BrandLogo';
import { Lock, Mail, Eye, EyeOff, ArrowRight, AlertCircle, Loader2, ChevronDown, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  'Managing Director': 'Managing Director',
  'Executive Manager': 'Executive Manager',
  'Operations Manager': 'Operations Manager',
  'Ops Executive': 'Ops Executive',
  'Workshop Manager': 'Workshop Manager',
  'Workshop Coordinator': 'Workshop Coordinator',
  'Procurement': 'Procurement',
  'Security': 'Security (Gate)',
  'PHI/PDI Checker': 'PHI/PDI Checker',
  'Sales Executive': 'Sales Executive',
  'Driver': 'Driver',
  'Finance': 'Finance',
};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (demoRef.current && !demoRef.current.contains(e.target as Node)) setDemoOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(() => {
      const result = login(email, password);
      if (result.success) navigate('/');
      else { setError(result.error || 'Login failed'); setLoading(false); }
    }, 450);
  };

  const quickLogin = (acct: typeof demoAccounts[0]) => {
    setEmail(acct.email);
    setPassword(acct.password);
    setDemoOpen(false);
    setError('');
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-4 dark:bg-slate-950">
      {/* Soft ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${BRAND.colors.primary}33, transparent 70%)` }} />
        <div className="absolute -bottom-40 -right-40 h-[32rem] w-[32rem] rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${BRAND.colors.accent}33, transparent 70%)` }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo above card */}
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" subtitle={BRAND.tagline} />
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/60 bg-card/80 p-8 shadow-xl shadow-slate-900/5 backdrop-blur">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your {BRAND.name} workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required
                  className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
                <span className="text-xs text-muted-foreground">Demo — any saved account</span>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                  className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${BRAND.colors.primary}, ${BRAND.colors.accent})` }}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          {/* Demo account picker (collapsed) */}
          <div className="mt-5 border-t border-border pt-5">
            <div ref={demoRef} className="relative">
              <button
                type="button"
                onClick={() => setDemoOpen((v) => !v)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <PlayCircle className="h-4 w-4 text-primary" />
                Try a demo account
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', demoOpen && 'rotate-180')} />
              </button>
              {demoOpen && (
                <div className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                  <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Johnson Arabia · demo company</p>
                  {demoAccounts.map((acct) => (
                    <button
                      key={acct.email}
                      onClick={() => quickLogin(acct)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: acct.avatarColor }} />
                      <span className="truncate font-medium text-foreground">{ROLE_LABELS[acct.role] ?? acct.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New company?{' '}
          <Link to="/signup" className="font-semibold text-primary hover:underline">Create an account</Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground/70">© {BRAND.year} {BRAND.name}. All rights reserved.</p>
      </div>
    </div>
  );
}
