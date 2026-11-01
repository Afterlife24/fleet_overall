import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, TrendingUp, Building2, MapPin } from 'lucide-react';

const VENTURES_URL = 'https://www.venturesonsite.com';

export function SalesPortalPage() {
  const [iframeBlocked, setIframeBlocked] = useState(false);

  useEffect(() => {
    // Detect if iframe is blocked after 3 seconds
    const timer = setTimeout(() => {
      const iframe = document.querySelector('iframe[title="Ventures OnSite"]') as HTMLIFrameElement;
      if (iframe) {
        try {
          // Try to access iframe content - will throw if blocked
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) {
            setIframeBlocked(true);
          }
        } catch (e) {
          setIframeBlocked(true);
        }
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Portal"
        description="Construction project intelligence powered by Ventures OnSite"
      />

      {/* Info cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Active Projects</p>
              <p className="text-xs text-muted-foreground">Track construction opportunities across GCC</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Location Intel</p>
              <p className="text-xs text-muted-foreground">Find projects near your fleet yards</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Market Insights</p>
              <p className="text-xs text-muted-foreground">Identify rental demand trends</p>
            </div>
          </div>
        </Card>
      </div>

      {/* iframe blocked alert */}
      {iframeBlocked && (
        <Alert>
          <ExternalLink className="h-4 w-4" />
          <AlertDescription>
            Ventures OnSite cannot be embedded directly. Use the button below to open in a new tab.
          </AlertDescription>
        </Alert>
      )}

      {/* Ventures embed or fallback */}
      {!iframeBlocked ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img 
                  src="https://www.venturesonsite.com/favicon.ico" 
                  alt="Ventures OnSite" 
                  className="h-4 w-4"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <span className="text-sm font-medium text-foreground">Ventures OnSite</span>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <a href={VENTURES_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open in New Tab
                </a>
              </Button>
            </div>
          </div>
          <iframe
            src={VENTURES_URL}
            title="Ventures OnSite"
            className="h-[750px] w-full border-0"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold text-foreground">Access Ventures OnSite</h3>
          <p className="mb-6 text-sm text-muted-foreground">
            Log in with your Ventures credentials to view construction projects and market intelligence
          </p>
          <Button size="lg" asChild>
            <a href={VENTURES_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Ventures OnSite
            </a>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Opens in a new browser tab
          </p>
        </Card>
      )}

      {/* Instructions */}
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">How to Use</h3>
        <ol className="space-y-1 text-xs text-muted-foreground">
          <li>1. Log in with your personal Ventures OnSite credentials</li>
          <li>2. Search for active construction projects in your target regions</li>
          <li>3. Identify equipment rental opportunities and contact decision makers</li>
          <li>4. Use Fleet Map to position machines near high-demand project sites</li>
        </ol>
      </Card>
    </div>
  );
}
