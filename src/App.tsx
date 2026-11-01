import { QueryProvider } from '@/app/QueryProvider';
import { ThemeProvider } from '@/app/ThemeProvider';
import { AppRouter } from '@/app/AppRouter';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Toaster } from 'sonner';

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryProvider>
          <AppRouter />
          <Toaster position="top-right" richColors closeButton />
        </QueryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
