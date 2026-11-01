import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-sky-600 text-white">
        <Building2 className="h-7 w-7" />
      </div>
      <p className="text-5xl font-bold text-foreground">404</p>
      <p className="mt-3 text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Link
        to="/"
        className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
