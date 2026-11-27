// Helpers for component tests of the screens that talk to `/api/v1`. The tests mock the api modules with `vi.mock`
// (there is no network in unit tests); these helpers build DTOs, mark the API session ready and render with providers.
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type {
  BranchDto, CustomerDto, CustomerLpoDto, HireAgreementDto, MachineDocumentDto, MachineDto, MachineModelDto, PageDto,
  PhaseHistoryDto, QuotationDto, QuotationPhase,
} from '../../shared/dto/index';
import { ApiClientError } from '@/services/api/http';
import { resetSessionForTests, useSessionStore } from '@/services/api/session';

export const SESSION_ORG = '00000000-0000-4000-8000-000000000001';

/** Marks the API session ready (development fixture identity), as `useApiSession` does after sign-in. */
export function setSessionReady(): void {
  resetSessionForTests();
  useSessionStore.setState({
    status: 'ready',
    error: null,
    authMode: 'development-fixture',
    devFixtureAuth: true,
    session: {
      user: { id: 'user-1', displayName: 'Dev User' },
      role: { code: 'ADMIN' },
      permissions: [],
      organization: { id: SESSION_ORG, name: 'Test Org' },
      branchScope: { allBranches: true, branchId: null },
      authMode: 'development-fixture',
    },
  });
}

export function renderScreen(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export const page = <T,>(items: T[]): PageDto<T> => ({ items, page: 1, pageSize: 100, total: items.length });

const TS = '2026-01-01T00:00:00.000Z';

export const customerDto = (over: Partial<CustomerDto> = {}): CustomerDto => ({
  id: 'c-1', customerCode: 'CUST-000125', fleetLogCode: null, name: 'ABC Company LLC', taxRegistrationNo: '100000000000001',
  attn: 'Mr. A', email: 'a@abc.test', phone: '+971500000000', address: 'Dubai', billingAddress: null, creditLimit: '50000.00',
  creditHold: false, status: 'ACTIVE', branchId: null, aniRavaliActive: false, crmHaReference: null, notes: null,
  customAttributes: {}, createdAt: TS, updatedAt: TS, rowVersion: 3, ...over,
});

export const quotationDto = (id: string, phase: QuotationPhase, over: Partial<QuotationDto> = {}): QuotationDto => ({
  id, branchId: null, customerId: 'c-1', quotationNo: `QT-2026-${id}`, opportunity: `Opp ${id}`, email: null,
  crmHaReference: null, amount: '1000.00', currencyCode: 'AED', phase, salesUserId: null, validUntil: null,
  lostReason: null, lostAt: null, lostBy: null, wonAt: null, notes: null, customAttributes: {}, createdAt: TS, updatedAt: TS,
  rowVersion: 5, ...over,
});

export const historyDto = (id: string, quotationId: string, from: QuotationPhase | null, to: QuotationPhase, reason: string | null = null): PhaseHistoryDto => ({
  id, quotationId, fromPhase: from, toPhase: to, actorUserId: null, reason, source: 'MANUAL', occurredAt: TS,
});

export const agreementDto = (id: string, quotationId: string, over: Partial<HireAgreementDto> = {}): HireAgreementDto => ({
  id, quotationId, customerId: 'c-1', agreementNo: `HA-2026-${id}`, agreementDate: '2026-01-02', status: 'Active',
  issuerSnapshot: { name: 'Lessor LLC' }, customerSnapshot: { name: 'ABC Company LLC' }, equipmentName: 'Boom Lift',
  equipmentModel: '660SJ', serialNumber: 'SN-1', quantity: 1, capacity: '230kg', workingHeight: '20m', deliveryLocation: 'Site A',
  hireStartDate: '2026-02-01', hireEndDate: '2026-03-01', hireDuration: '30 days', monthlyRental: '1000.00',
  transportationCharges: '200.00', subtotal: '1200.00', vatAmount: '60.00', totalAmount: '1260.00', paymentTerms: '30 Days',
  paymentTermDays: 30, securityDeposit: '0.00', paymentMethod: 'Bank Transfer', sentAt: null, receivedAt: null,
  crmHaReference: null, createdAt: TS, updatedAt: TS, rowVersion: 2, ...over,
});

export const lpoDto = (id: string, quotationId: string, over: Partial<CustomerLpoDto> = {}): CustomerLpoDto => ({
  id, quotationId, hireAgreementId: null, customerId: 'c-1', lpoNo: `LPO-${id}`, receivedOn: '2026-01-05', validUntil: null,
  amount: '900.00', currencyCode: 'AED', fileId: null, notes: null, createdAt: TS, updatedAt: TS, rowVersion: 1, ...over,
});

export const branchDto = (id: string, name: string): BranchDto => ({
  id, code: name.slice(0, 3).toUpperCase(), name, countryCode: 'AE', city: 'Dubai', address: 'x', phone: null,
  managerUserId: null, timezone: 'Asia/Dubai', active: true, createdAt: TS, updatedAt: TS, rowVersion: 1,
});

export const modelDto = (id: string, make: string, model: string): MachineModelDto => ({
  id, make, model, category: 'Articulating Boom', powerSource: 'Diesel', platformHeightM: null, workingHeightM: '20.0',
  capacityKg: '230', specifications: {}, createdAt: TS, updatedAt: TS, rowVersion: 1,
});

export const machineDto = (id: string, over: Partial<MachineDto> = {}): MachineDto => ({
  id, branchId: 'b-1', modelId: 'm-1', assetNo: `A-${id}`, fleetNo: `F-${id}`, serialNo: `S-${id}`, manufactureYear: 2022,
  powerSource: 'Diesel', platformHeightM: null, workingHeightM: '20.0', capacityKg: '230', hoursOperated: '100.0',
  operationalStatus: 'Available', readinessStatus: 'READY', currentLocation: 'Yard', lastInspectionOn: null,
  nextInspectionOn: null, nextPhiOn: null, nextMandatoryOn: null, tpcExpiresOn: null, tpcSupplier: null, active: true,
  customAttributes: {}, createdAt: TS, updatedAt: TS, rowVersion: 4, ...over,
});

export const machineDocDto = (id: string, machineId: string): MachineDocumentDto => ({
  id, machineId, fileId: 'f-1', name: `Doc ${id}`, documentType: 'Certificate', uploadedAt: TS, expiresOn: null, active: true,
  createdAt: TS, updatedAt: TS, rowVersion: 1,
});

export const staleError = () =>
  new ApiClientError({ code: 'STALE_VERSION', message: 'Row version mismatch', status: 409, correlationId: 'corr-409' });
export const validationError = () =>
  new ApiClientError({ code: 'VALIDATION_ERROR', message: 'Check the entered values', status: 422, correlationId: 'corr-422', fieldErrors: { lpoNo: 'LPO number is required' } });
export const unavailableError = () =>
  new ApiClientError({ code: 'SERVICE_UNAVAILABLE', message: 'The service is unavailable.', status: 503, correlationId: 'corr-503', retryable: true });
