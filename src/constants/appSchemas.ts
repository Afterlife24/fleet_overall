import type { FieldDef } from '@/types/schema';

/**
 * Default field schemas per app — the starting point a company customizes.
 * These mirror the fields each app ships with today; companies can rename,
 * hide, add or remove (non-system) fields from the customizer.
 */
export const DEFAULT_SCHEMAS: Record<string, FieldDef[]> = {
  fleet: [
    { key: 'assetNumber', label: 'Asset No.', type: 'text', system: true, required: true, order: 0, inTable: true },
    { key: 'make', label: 'Make', type: 'text', system: true, required: true, order: 1, inTable: true, filterable: true },
    { key: 'model', label: 'Model', type: 'text', system: true, required: true, order: 2, inTable: true, filterable: true },
    { key: 'category', label: 'Category', type: 'select', system: true, order: 3, inTable: true, filterable: true,
      options: ['Articulating Boom', 'Telescopic Boom', 'Scissor Lift', 'Telehandler', 'Vertical Mast', 'Trailer Mounted'] },
    { key: 'status', label: 'Status', type: 'select', system: true, order: 4, inTable: true, filterable: true,
      options: ['Available', 'On Hire', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Transport', 'Breakdown', 'Offline'] },
    { key: 'branchName', label: 'Branch', type: 'text', system: true, order: 5, inTable: true, filterable: true },
    { key: 'currentCustomer', label: 'Customer', type: 'text', system: true, order: 6, inTable: true, filterable: true },
    { key: 'powerSource', label: 'Power', type: 'select', system: true, order: 7, inTable: false,
      options: ['Diesel', 'Electric', 'Hybrid', 'Bi-Energy'] },
    { key: 'workingHeight', label: 'Working Height (m)', type: 'number', system: true, order: 8, inTable: false },
    { key: 'capacity', label: 'Capacity (kg)', type: 'number', system: true, order: 9, inTable: false },
    { key: 'year', label: 'Year', type: 'number', system: true, order: 10, inTable: false },
    { key: 'hoursOperated', label: 'Hours', type: 'number', system: true, order: 11, inTable: true },
  ],
  cross_hire: [
    { key: 'reference', label: 'Reference', type: 'text', system: true, order: 0, inTable: true },
    { key: 'make', label: 'Make', type: 'text', system: true, required: true, order: 1, inTable: true },
    { key: 'model', label: 'Model', type: 'text', system: true, required: true, order: 2, inTable: true },
    { key: 'description', label: 'Description', type: 'text', system: true, order: 3, inTable: false },
    { key: 'category', label: 'Category', type: 'select', system: true, order: 4, inTable: false,
      options: ['Articulating Boom', 'Telescopic Boom', 'Scissor Lift', 'Telehandler', 'Vertical Mast', 'Trailer Mounted', 'Other'] },
    { key: 'supplierName', label: 'Supplier (IN)', type: 'text', system: true, required: true, order: 5, inTable: true },
    { key: 'buyRate', label: 'Buy Rate', type: 'currency', system: true, required: true, order: 6, inTable: false },
    { key: 'customerName', label: 'Client (OUT)', type: 'text', system: true, required: true, order: 7, inTable: true },
    { key: 'sellRate', label: 'Sell Rate', type: 'currency', system: true, required: true, order: 8, inTable: false },
    { key: 'siteLocation', label: 'Site', type: 'text', system: true, order: 9, inTable: false },
    { key: 'quantity', label: 'Qty', type: 'number', system: true, order: 10, inTable: false },
    { key: 'status', label: 'Status', type: 'select', system: true, order: 11, inTable: true,
      options: ['Enquiry', 'Confirmed', 'On Hire', 'Off Hire', 'Returned', 'Cancelled'] },
    { key: 'salesRep', label: 'Sales Rep', type: 'text', system: true, order: 12, inTable: false },
  ],
};

export function defaultSchema(appId: string): FieldDef[] {
  return (DEFAULT_SCHEMAS[appId] ?? []).map((f) => ({ ...f }));
}
