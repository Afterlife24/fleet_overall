import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { BRAND } from '@/constants/brand';
import { BrandLogo } from '@/components/common/BrandLogo';
import { Lock, Mail, User as UserIcon, Building2, Eye, EyeOff, ArrowRight, AlertCircle, Loader2, Check } from 'lucide-react';

const PERKS = [
  'You become the company admin',
  'Add staff with their own departments',
  "Each company's data is fully isolated",
];

export function SignupPage() {
  const navigate = useNavigate();
  const signupOrg = useOrgStore((s) => s.signupOrg);
  const login = useAuthStore((s) => s.login);

  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(() => {
      const result = signupOrg({ companyName, ownerName, email, password });
      if (!result.success) { setError(result.error || 'Sign up failed'); setLoading(false); return; }
      const loginResult = login(email, password);
      if (loginResult.success) navigate('/');
      else { setError('Account created — please sign in.'); setLoading(false); }
    }, 450);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-4 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${BRAND.colors.primary}33, transparent 70%)` }} />
        <div className="absolute -bottom-40 -right-40 h-[32rem] w-[32rem] rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${BRAND.colors.accent}33, transparent 70%)` }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" subtitle={BRAND.tagline} />
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/80 p-8 shadow-xl shadow-slate-900/5 backdrop-blur">
          <div className="mb-5 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Create your company</h2>
            <p className="mt-1 text-sm text-muted-foreground">Set up your workspace — you'll be the admin.</p>
          </div>

          {/* Perks chips */}
          <div className="mb-5 flex flex-wrap justify-center gap-2">
            {PERKS.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                <Check className="h-3 w-3" /> {p}
              </span>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <Field label="Company name" icon={Building2}>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="BuildCo Equipment LLC" required
                className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </Field>
            <Field label="Your name" icon={UserIcon}>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Ahmed Khan" required
                className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </Field>
            <Field label="Email" icon={Mail}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcompany.com" required
                className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </Field>
            <Field label="Password" icon={Lock}>
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            <button type="submit" disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${BRAND.colors.primary}, ${BRAND.colors.accent})` }}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create company <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground/70">© {BRAND.year} {BRAND.name}. Demo environment.</p>
      </div>
    </div>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {children}
      </div>
    </div>
  );
}
