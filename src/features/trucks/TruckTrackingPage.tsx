import { useEffect, useRef, useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useTransportJobs } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { DEFAULT_COORD, coordForTransportJob, NAMED_LOCATIONS } from '@/constants/geoCoords';
import { Truck as TruckIcon, X, MapPin, User, Package } from 'lucide-react';
import type { TransportJob } from '@/types/transport';

// Leaflet loaded globally via CDN (index.html)
declare const L: any;

const STATUS_HEX: Record<string, string> = {
  'Scheduled':  '#64748b',
  'Loading':    '#f59e0b',
  'In Transit': '#3b82f6',
  'Delivered':  '#10b981',
  'Returning':  '#8b5cf6',
  'Completed':  '#6b7280',
};

interface SelectedTruck {
  reference: string;
  truck: string;
  driver: string;
  status: string;
  route: string;
  machine: string;
  customer: string;
  position: string;
}

export function TruckTrackingPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markerLayer = useRef<any>(null);
  const [selected, setSelected] = useState<SelectedTruck | null>(null);
  const [leafletReady, setLeafletReady] = useState(typeof L !== 'undefined');

  const { data: allJobs } = useTransportJobs();
  const jobs = useBranchFilter(allJobs);

  // Wait for CDN Leaflet
  useEffect(() => {
    if (leafletReady) return;
    const t = setInterval(() => {
      if (typeof L !== 'undefined') { setLeafletReady(true); clearInterval(t); }
    }, 100);
    return () => clearInterval(t);
  }, [leafletReady]);

  // Init map
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

  // Truck pins + route lines
  const pins = useMemo(() =>
    jobs.map((j) => {
      const c = coordForTransportJob({
        id: j.id, branchId: j.branchId, origin: j.origin, destination: j.destination, status: j.status,
      });
      const from = NAMED_LOCATIONS[j.origin] ?? { lat: c.lat - 0.05, lng: c.lng - 0.05 };
      const to = NAMED_LOCATIONS[j.destination] ?? { lat: c.lat + 0.05, lng: c.lng + 0.05 };
      return {
        lat: c.lat, lng: c.lng,
        from, to,
        color: STATUS_HEX[j.status] || '#f97316',
        truck: {
          reference: j.reference,
          truck: j.truckRegistration,
          driver: j.driverName,
          status: j.status,
          route: `${j.origin} → ${j.destination}`,
          machine: `${j.assetNumber} · ${j.machineModel}`,
          customer: j.customerName ?? 'Internal',
          position: c.place,
        } as SelectedTruck,
      };
    }), [jobs]);

  // Draw truck pins + route lines
  useEffect(() => {
    if (!mapInstance.current || !markerLayer.current) return;
    markerLayer.current.clearLayers();

    pins.forEach(({ lat, lng, from, to, color, truck }) => {
      // Route line
      L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
        color: '#94a3b8',
        weight: 2,
        opacity: 0.4,
        dashArray: '5, 5',
      }).addTo(markerLayer.current);

      // Truck pin
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:16px;height:16px;border-radius:3px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.2)"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([lat, lng], { icon, zIndexOffset: 100 })
        .addTo(markerLayer.current)
        .on('click', () => setSelected(truck));
    });
  }, [pins]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    jobs.forEach((j) => { c[j.status] = (c[j.status] || 0) + 1; });
    return c;
  }, [jobs]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Truck Tracking"
        description="Live transport job positions and routes (demo coordinates)"
      />

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
          <TruckIcon className="h-4 w-4 text-muted-foreground" />
          <strong>{jobs.length}</strong> active jobs
        </span>
        {Object.entries(statusCounts).map(([status, count]) => {
          const hex = STATUS_HEX[status];
          if (!count) return null;
          return (
            <span key={status} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: hex }} />
              <strong>{count}</strong> {status.toLowerCase()}
            </span>
          );
        })}
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
            <h3 className="mb-3 text-sm font-semibold text-foreground">Transport Status</h3>
            <div className="space-y-1.5">
              {Object.entries(STATUS_HEX).map(([status, hex]) => (
                statusCounts[status] ? (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: hex }} />
                      {status}
                    </span>
                    <span className="font-semibold text-foreground">{statusCounts[status]}</span>
                  </div>
                ) : null
              ))}
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                <span className="h-0.5 w-4 bg-slate-400 opacity-50" style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0, currentColor 3px, transparent 3px, transparent 6px)' }} />
                Route path
              </div>
            </div>
          </Card>

          {/* Selected truck detail */}
          {selected ? (
            <Card className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <TruckIcon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selected.truck}</p>
                    <p className="text-xs text-muted-foreground">{selected.reference}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <StatusBadge status={selected.status} size="sm" />
              <dl className="mt-3 space-y-1.5">
                {[
                  { label: 'Driver',   value: selected.driver,   icon: User },
                  { label: 'Route',    value: selected.route,    icon: MapPin },
                  { label: 'Machine',  value: selected.machine,  icon: Package },
                  { label: 'Customer', value: selected.customer, icon: User },
                  { label: 'Position', value: selected.position, icon: MapPin },
                ].map((row) => (
                  <div key={row.label} className="flex items-start gap-2 text-xs">
                    <row.icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-medium text-foreground">{row.value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <Card className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <TruckIcon className="h-4 w-4 shrink-0" />
              Click a truck to see details
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
