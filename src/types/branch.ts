import { BaseEntity } from './common';

export type BranchCountry = 'UAE' | 'KSA';

export interface Branch extends BaseEntity {
  name: string;
  code: string;
  country: BranchCountry;
  city: string;
  address: string;
  phone: string;
  manager: string;
  machineCount: number;
  active: boolean;
}
