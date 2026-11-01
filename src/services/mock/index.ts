// Re-export all mock data from a single index for the service layer
export { branches, getBranchById } from './branches';
export { customers, getCustomerById } from './customers';
export { machines, getMachineById, getMachineByAsset } from './machines';
export { bookings, getBookingById, getBookingsForMachine } from './bookings';
export { workshopJobs, technicians, workshopBays, getWorkshopJobById, getTechnicianById } from './workshop';
export { drivers, trucks, transportJobs, getDriverById, getTruckById, getTransportJobById } from './transport';
export { inspections, getInspectionById, getInspectionsByType, inspectionSections, createInspections } from './inspections';
export { breakdowns, getBreakdownById } from './breakdowns';
export { jobCards, getJobCardById } from './jobcards';
export { users, getUserById } from './users';
export { notifications } from './notifications';
export { gateEntries } from './gate';
export { crossHires, getCrossHireById } from './crosshire';
