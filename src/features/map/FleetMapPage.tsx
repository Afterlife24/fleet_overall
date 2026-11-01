import { useEffect, useRef, useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useMachines } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { BRANCH_YARDS, DEFAULT_COORD, coordForMachine } from '@/constants/geoCoords';
import { Forklift, X, Warehouse } from 'lucide-react';

// Leaflet loaded globally via CDN (index.html)
declare const L: any;

const STATUS_HEX: Record<string, string> = {
  'Available':    '#10b981',
  'Allocated':    '#6366f1',
  'On Hire':      '#0ea5e9',
  'Under Repair': '#f59e0b',
  'In Workshop':  '#8b5cf6',
  'PDI':          '#14b8a6',
  'PHI':          '#6366f1',
  'Transport':    '#f97316',
  'Breakdown':    '#ef4444',
  'Offline':      '#64748b',
};

interface SelectedMachine {
  title: string;
  subtitle: string;
  status: string;
  position: string;
  category: string;
  branch: string;
  customer: string;
}

export function FleetMapPage() {
  const mapRef       = useRef<HTMLDivElement>(null);
  const mapInstance  = useRef<any>(null);
  const markerLayer  = useRef<any>(null);
  const [selected, setSelected]       = useState<SelectedMachine | null>(null);
  const [leafletReady, setLeafletReady] = useState(typeof L !== 'undefined');

  const { data: allMachines } = useMachines();
  const machines = useBranchFilter(allMachines);

  // Wait for CDN Leaflet to load
  useEffect(() => {
    if (leafletReady) return;
    const t = setInterval(() => {
      if (typeof L !== 'undefined') { setLeafletReady(true); clearInterval(t); }
    }, 100);
    return () => clearInterval(t);
  }, [leafletReady]);

  // Init map once
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, { zoomControl: true })
      .setView([DEFAULT_COORD.lat, DEFAULT_COORD.lng], 8);
    // Mapbox Streets with English labels (token from env — never hardcode)
    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken ?? ''}`, {
      attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 19,
    }).addTo(map);
    mapInstance.current = map;
    markerLayer.current = L.layerGroup().addTo(map);
  }, [leafletReady]);

  // Yard markers (dark square per branch)
  const yards = useMemo(() => {
    const seen = new Map<string, { name: string; lat: number; lng: number; count: number }>();
    machines.forEach((m) => {
      if (!m.branchId || !BRANCH_YARDS[m.branchId]) return;
      const inYard = coordForMachine({ id: m.id, branchId: m.branchId, status: m.status }).atYard;
      const ex = seen.get(m.branchId);
      if (ex) { if (inYard) ex.count++; }
      else seen.set(m.branchId, { name: m.branchName, ...BRANCH_YARDS[m.branchId], count: inYard ? 1 : 0 });
    });
    return [...seen.values()];
  }, [machines]);

  // Machine pins
  const pins = useMemo(() =>
    machines.map((m) => {
      const c = coordForMachine({ id: m.id, branchId: m.branchId, status: m.status });
      return {
        lat: c.lat, lng: c.lng,
        color: STATUS_HEX[m.status] || '#64748b',
        machine: {
          title: m.assetNumber,
          subtitle: `${m.make} ${m.model}`,
          status: m.status,
          position: c.place,
          category: m.category,
          branch: m.branchName,
          customer: m.currentCustomer ?? 'Not on hire',
        } as SelectedMachine,
      };
    }), [machines]);

  // Draw markers whenever pins change
  useEffect(() => {
    if (!mapInstance.current || !markerLayer.current) return;
    markerLayer.current.clearLayers();

    // Yard anchors (drawn under machine pins)
    yards.forEach((y) => {
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:20px;height:20px;border-radius:4px;background:#1f2937;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      L.marker([y.lat, y.lng], { icon, zIndexOffset: -500 })
        .addTo(markerLayer.current)
        .bindTooltip(`${y.name} Yard · ${y.count} in yard`, { direction: 'top' });
    });

    // Machine pins
    pins.forEach(({ lat, lng, color, machine }) => {
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.18)"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([lat, lng], { icon })
        .addTo(markerLayer.current)
        .on('click', () => setSelected(machine));
    });
  }, [pins, yards]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    machines.forEach((m) => { c[m.status] = (c[m.status] || 0) + 1; });
    return c;
  }, [machines]);

  const inYardCount  = useMemo(() =>
    machines.filter((m) => coordForMachine({ id: m.id, branchId: m.branchId, status: m.status }).atYard).length,
    [machines]);
  const onSiteCount = machines.length - inYardCount;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fleet Map"
        description="Machine positions — in yard vs out on customer sites (demo coordinates)"
      />

      {/* Stats strip */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
          <Forklift className="h-4 w-4 text-muted-foreground" />
          <strong>{machines.length}</strong> machines total
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <strong>{inYardCount}</strong> in yard
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-800">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          <strong>{onSiteCount}</strong> out on site
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* Map */}
        <Card className="col-span-1 overflow-hidden p-0 lg:col-span-3">
          <div ref={mapRef} className="h-[580px] w-full" style={{ background: '#e5e7eb' }}>
            {!leafletReady && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading map…
              </div>
            )}
          </div>
        </Card>

        {/* Side panel */}
        <div className="flex flex-col gap-4">
          {/* Status legend */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Status</h3>
            <div className="space-y-1.5">
              {Object.entries(STATUS_HEX).map(([status, hex]) => (
                statusCounts[status] ? (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: hex }} />
                      {status}
                    </span>
                    <span className="font-semibold text-foreground">{statusCounts[status]}</span>
                  </div>
                ) : null
              ))}
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                <span className="h-3 w-3 rounded-sm bg-slate-800" />
                Branch yard
              </div>
            </div>
          </Card>

          {/* Selected machine detail */}
          {selected ? (
            <Card className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Forklift className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selected.title}</p>
                    <p className="text-xs text-muted-foreground">{selected.subtitle}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <StatusBadge status={selected.status} size="sm" />
              <dl className="mt-3 space-y-1.5">
                {[
                  { label: 'Position',  value: selected.position },
                  { label: 'Category',  value: selected.category },
                  { label: 'Branch',    value: selected.branch },
                  { label: 'Customer',  value: selected.customer },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-2 text-xs">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="text-right font-medium text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <Card className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Warehouse className="h-4 w-4 shrink-0" />
              Click a pin to see machine details
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
