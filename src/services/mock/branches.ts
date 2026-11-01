import { Branch } from '@/types/branch';
import { BaseEntity } from '@/types/common';

const NOW = new Date().toISOString();

// overview.md §1 — 6 exact JA branches
export const branches: Branch[] = [
  {
    id: 'br-dxb',
    name: 'Dubai',
    code: 'DXB',
    country: 'UAE',
    city: 'Dubai',
    address: 'DIC — Dubai Investment Park 2, Dubai, UAE',
    phone: '+971 4 123 4567',
    manager: 'Virat Kohli',
    machineCount: 280,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'br-auh',
    name: 'Abu Dhabi',
    code: 'AUH',
    country: 'UAE',
    city: 'Abu Dhabi',
    address: 'Mussafah Industrial Area, Abu Dhabi, UAE',
    phone: '+971 2 555 7890',
    manager: 'Steve Smith',
    machineCount: 210,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'br-taw',
    name: 'Taweelah',
    code: 'TAW',
    country: 'UAE',
    city: 'Taweelah',
    address: 'Mafraq Yard, Taweelah, Abu Dhabi, UAE',
    phone: '+971 2 666 1234',
    manager: 'Kane Williamson',
    machineCount: 95,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'br-oil',
    name: 'Oilfields',
    code: 'OIL',
    country: 'UAE',
    city: 'Abu Dhabi Oilfields',
    address: 'Oil & Gas Region, Abu Dhabi, UAE',
    phone: '+971 2 777 5678',
    manager: 'Joe Root',
    machineCount: 120,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'br-fuj',
    name: 'Fujairah',
    code: 'FUJ',
    country: 'UAE',
    city: 'Fujairah',
    address: 'Industrial Area, Fujairah, UAE',
    phone: '+971 9 888 4321',
    manager: 'Ben Stokes',
    machineCount: 75,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'br-ksa',
    name: 'KSA',
    code: 'KSA',
    country: 'KSA',
    city: 'Riyadh',
    address: 'Industrial City 2, Riyadh, KSA',
    phone: '+966 11 444 5566',
    manager: 'Babar Azam',
    machineCount: 190,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export function getBranchById(id: string): Branch | undefined {
  return branches.find((b) => b.id === id);
}

export function makeEntity(id: string): BaseEntity {
  return { id, createdAt: NOW, updatedAt: NOW };
}
