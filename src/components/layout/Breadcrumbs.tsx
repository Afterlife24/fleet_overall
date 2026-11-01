import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { findNavItem } from '@/app/navigation';

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  const items: { label: string; path: string }[] = [{ label: 'Home', path: '/' }];
  let acc = '';
  for (const seg of segments) {
    acc += `/${seg}`;
    const nav = findNavItem(acc);
    items.push({ label: nav?.label ?? seg.charAt(0).toUpperCase() + seg.slice(1), path: acc });
  }

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <span key={item.path} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
          {i === 0 && <Home className="h-3.5 w-3.5" />}
          {i === items.length - 1 ? (
            <span className="font-medium text-foreground">{item.label}</span>
          ) : (
            <Link to={item.path} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
