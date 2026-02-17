import type {
  Booking,
  Building,
  InvoicePreview,
  RegulationBookingResult,
  RegulationRun,
  RegulationUnitSetting,
  RegulationBookingSetting,
  Tenant,
  Unit,
} from './models';

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function daysBetweenInclusive(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay) + 1;
}

function overlapMonths(
  rangeStart: Date,
  rangeEnd: Date,
  bookingStart: Date,
  bookingEnd?: Date,
): number {
  const bEnd = bookingEnd ?? new Date('9999-12-31T00:00:00');
  let months = 0;

  let year = rangeStart.getFullYear();
  let month = rangeStart.getMonth();

  while (true) {
    const monthStart = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthEnd = new Date(year, month, daysInMonth);

    if (monthStart > rangeEnd) break;

    const effectiveStart = monthStart < rangeStart ? rangeStart : monthStart;
    const effectiveEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;

    const overlapStart = effectiveStart > bookingStart ? effectiveStart : bookingStart;
    const overlapEnd = effectiveEnd < bEnd ? effectiveEnd : bEnd;

    if (overlapEnd >= overlapStart) {
      const overlapDays = daysBetweenInclusive(overlapStart, overlapEnd);
      months += overlapDays / daysInMonth;
    }

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return months;
}

export function recomputeTotalsWithExclusions(
  run: RegulationRun,
  units: Unit[],
  unitSettings: RegulationUnitSetting[],
): RegulationRun {
  const includedUnits = units.filter((u) => {
    const setting = unitSettings.find(
      (s) => s.unitId === u.id && s.regulationRunId === run.id,
    );
    return !setting?.excludeFromCalculation;
  });

  const totalArea = includedUnits.reduce((sum, u) => sum + u.areaSqm, 0);
  const totalDelta = run.totalNextExpenses - run.totalPrevExpenses;
  const adjustmentPerSqm = totalArea > 0 ? totalDelta / totalArea : 0;

  return {
    ...run,
    totalRentableAreaSqm: totalArea,
    totalDelta,
    adjustmentPerSqm,
  };
}

export function computeBookingResults(
  run: RegulationRun,
  building: Building,
  allUnits: Unit[],
  allBookings: Booking[],
  unitSettings: RegulationUnitSetting[],
  bookingSettings: RegulationBookingSetting[],
): RegulationBookingResult[] {
  const buildingUnits = allUnits.filter((u) => u.buildingId === building.id);
  const buildingBookings = allBookings.filter((b) =>
    buildingUnits.some((u) => u.id === b.unitId),
  );

  const regulationStart = parseDate(run.adjustmentStartDate);
  const adjYear = regulationStart.getFullYear();
  const regulationEnd = new Date(adjYear, 11, 31);

  return buildingBookings.map((booking) => {
    const unit = buildingUnits.find((u) => u.id === booking.unitId);
    if (!unit) {
      return {
        regulationRunId: run.id,
        bookingId: booking.id,
        monthlyAdjustment: 0,
        adjustmentPeriodTotal: 0,
        retroactiveAmount: 0,
        included: false,
        potentialMonthlyAdjustment: 0,
        potentialPeriodTotal: 0,
        potentialRetroactiveAmount: 0,
      };
    }

    const unitSetting = unitSettings.find(
      (s) => s.unitId === unit.id && s.regulationRunId === run.id,
    );

    const bookingSetting = bookingSettings.find(
      (s) => s.bookingId === booking.id && s.regulationRunId === run.id,
    );

    const unitMonthlyAdjustment = (run.adjustmentPerSqm * unit.areaSqm) / 12;

    const bookingStart = parseDate(booking.startDate);
    const bookingEnd = booking.endDate ? parseDate(booking.endDate) : undefined;

    const adjMonths = overlapMonths(
      regulationStart,
      regulationEnd,
      bookingStart,
      bookingEnd,
    );

    const adjustmentPeriodTotal = unitMonthlyAdjustment * adjMonths;

    let retroactiveAmount = 0;
    if (run.retroactiveEnabled && run.retroFrom && run.retroTo) {
      const retroFrom = parseDate(run.retroFrom);
      const retroTo = parseDate(run.retroTo);
      const retroMonths = overlapMonths(retroFrom, retroTo, bookingStart, bookingEnd);
      retroactiveAmount = unitMonthlyAdjustment * retroMonths;
    }

    const potentialPeriodTotal = adjustmentPeriodTotal;
    const potentialRetroactiveAmount = retroactiveAmount;

    const excludedFromCalculation = unitSetting?.excludeFromCalculation ?? false;
    const excludedFromApplication =
      bookingSetting?.excludeFromApplication ?? false;

    if (excludedFromCalculation) {
      return {
        regulationRunId: run.id,
        bookingId: booking.id,
        monthlyAdjustment: 0,
        adjustmentPeriodTotal: 0,
        retroactiveAmount: 0,
        included: false,
        potentialMonthlyAdjustment: unitMonthlyAdjustment,
        potentialPeriodTotal,
        potentialRetroactiveAmount,
      };
    }

    if (excludedFromApplication) {
      return {
        regulationRunId: run.id,
        bookingId: booking.id,
        monthlyAdjustment: 0,
        adjustmentPeriodTotal: 0,
        retroactiveAmount: 0,
        included: true,
        potentialMonthlyAdjustment: unitMonthlyAdjustment,
        potentialPeriodTotal,
        potentialRetroactiveAmount,
      };
    }

    return {
      regulationRunId: run.id,
      bookingId: booking.id,
      monthlyAdjustment: unitMonthlyAdjustment,
      adjustmentPeriodTotal,
      retroactiveAmount,
      included: true,
      potentialMonthlyAdjustment: unitMonthlyAdjustment,
      potentialPeriodTotal,
      potentialRetroactiveAmount,
    };
  });
}

export interface VacancyRecord {
  unitId: string;
  unitName: string;
  areaSqm: number;
  totalMonthsInYear: number;
  coveredMonths: number;
  vacantMonths: number;
  monthlyAdjustment: number;
  undistributedAmount: number;
}

export function computeVacancies(
  run: RegulationRun,
  building: Building,
  allUnits: Unit[],
  allBookings: Booking[],
  unitSettings: RegulationUnitSetting[],
): VacancyRecord[] {
  const buildingUnits = allUnits.filter((u) => u.buildingId === building.id);
  const adjYear = parseDate(run.adjustmentStartDate).getFullYear();
  const yearStart = new Date(adjYear, 0, 1);
  const yearEnd = new Date(adjYear, 11, 31);

  const results: VacancyRecord[] = [];

  for (const unit of buildingUnits) {
    const unitSetting = unitSettings.find(
      (s) => s.unitId === unit.id && s.regulationRunId === run.id,
    );
    if (unitSetting?.excludeFromCalculation) continue;

    const unitBookings = allBookings.filter((b) => b.unitId === unit.id);

    let coveredMonths = 0;
    for (const booking of unitBookings) {
      const bStart = parseDate(booking.startDate);
      const bEnd = booking.endDate ? parseDate(booking.endDate) : undefined;
      coveredMonths += overlapMonths(yearStart, yearEnd, bStart, bEnd);
    }

    coveredMonths = Math.min(coveredMonths, 12);
    const vacantMonths = 12 - coveredMonths;

    if (vacantMonths > 0.01) {
      const unitMonthlyAdjustment = (run.adjustmentPerSqm * unit.areaSqm) / 12;
      results.push({
        unitId: unit.id,
        unitName: unit.name,
        areaSqm: unit.areaSqm,
        totalMonthsInYear: 12,
        coveredMonths,
        vacantMonths,
        monthlyAdjustment: unitMonthlyAdjustment,
        undistributedAmount: unitMonthlyAdjustment * vacantMonths,
      });
    }
  }

  return results;
}

export function buildInvoicePreviews(
  bookings: Booking[],
  units: Unit[],
  tenants: Tenant[],
  bookingResults: RegulationBookingResult[],
): InvoicePreview[] {
  return bookingResults
    .filter((result) => result.included)
    .map((result) => {
      const booking = bookings.find((b) => b.id === result.bookingId)!;
      const unit = units.find((u) => u.id === booking.unitId)!;
      const tenant = tenants.find((t) => t.id === booking.tenantId)!;

      const oldMonthlyRent = booking.monthlyRent;
      const newMonthlyRent = oldMonthlyRent + result.monthlyAdjustment;

      return {
        bookingId: booking.id,
        tenantName: tenant.name,
        unitName: unit.name,
        oldMonthlyRent,
        newMonthlyRent,
        monthlyAdjustment: result.monthlyAdjustment,
        adjustmentPeriodTotal: result.adjustmentPeriodTotal,
        retroactiveAmount: result.retroactiveAmount,
      };
    });
}
