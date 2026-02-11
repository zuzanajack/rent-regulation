export type PeriodType = 'year';

export interface Building {
  id: string;
  name: string;
  address: string;
  unitIds: string[];
}

export interface Unit {
  id: string;
  buildingId: string;
  name: string;
  areaSqm: number;
  baseMonthlyRent: number;
  unitType: 'apartment' | 'shared' | 'commercial';
}

export interface Tenant {
  id: string;
  name: string;
}

export interface Booking {
  id: string;
  unitId: string;
  tenantId: string;
  startDate: string; // ISO
  endDate?: string; // ISO | undefined for open-ended
  monthlyRent: number;
}

export interface PublicCharge {
  id: string;
  buildingId: string;
  label: string;
  // New fields for richer expense modeling
  sku?: string;
  /** Representative date for this expense (e.g. in the new period) */
  date?: string; // ISO YYYY-MM-DD
  vat?: number;
  periodType: PeriodType;
  includeInCalculation?: boolean;
  prevPeriodFrom: string;
  prevPeriodTo: string;
  prevAmount: number;
  prevDocumentName?: string;
  nextPeriodFrom: string;
  nextPeriodTo: string;
  nextAmount: number;
  nextDocumentName?: string;
}

export type RegulationStatus = 'draft' | 'reviewed' | 'approved';

export interface RegulationRun {
  id: string;
  buildingId: string;
  publicChargeId: string;
  notificationDate: string;
  adjustmentStartDate: string;
  retroactiveEnabled: boolean;
  retroFrom?: string;
  retroTo?: string;
  status: RegulationStatus;
  // Calculated summary
  totalPrevExpenses: number;
  totalNextExpenses: number;
  totalDelta: number;
  totalRentableAreaSqm: number;
  adjustmentPerSqm: number;
}

export interface RegulationUnitSetting {
  regulationRunId: string;
  unitId: string;
  excludeFromCalculation: boolean;
}

export interface RegulationBookingSetting {
  regulationRunId: string;
  bookingId: string;
  excludeFromApplication: boolean;
}

export interface RegulationBookingResult {
  regulationRunId: string;
  bookingId: string;
  monthlyAdjustment: number;
  retroactiveAmount: number;
  included: boolean;
  potentialMonthlyAdjustment: number;
  potentialRetroactiveAmount: number;
}

export interface InvoicePreview {
  bookingId: string;
  tenantName: string;
  unitName: string;
  oldMonthlyRent: number;
  newMonthlyRent: number;
  monthlyAdjustment: number;
  retroactiveAmount: number;
}

// Simpler prototype-focused models from the plan
// These are not yet wired everywhere, but they mirror the conceptual model.

export interface Lease {
  id: string;
  unitId: string;
  tenantId: string;
  startDate: string; // ISO
  endDate?: string; // ISO | undefined for open-ended
  baseMonthlyRentOverride?: number;
  active: boolean;
}

export type InvoiceLineType = 'base_rent' | 'public_charge';

export interface InvoiceLine {
  label: string;
  amount: number;
  type: InvoiceLineType;
}

export interface Invoice {
  id: string;
  buildingId: string;
  unitId: string;
  leaseId?: string;
  bookingId?: string;
  periodMonth: string; // e.g. "2026-09"
  lines: InvoiceLine[];
}

