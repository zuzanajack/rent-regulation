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

function overlapDays(
  rangeStart: Date,
  rangeEnd: Date,
  bookingStart: Date,
  bookingEnd?: Date,
): number {
  const end = bookingEnd ?? new Date('9999-12-31T00:00:00');
  const startMax = rangeStart > bookingStart ? rangeStart : bookingStart;
  const endMin = rangeEnd < end ? rangeEnd : end;
  if (endMin < startMax) return 0;
  return daysBetweenInclusive(startMax, endMin);
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
  const regulationEnd = parseDate(run.adjustmentStartDate); // for prototype, single month focus

  return buildingBookings.map((booking) => {
    const unit = buildingUnits.find((u) => u.id === booking.unitId);
    if (!unit) {
      return {
        regulationRunId: run.id,
        bookingId: booking.id,
        monthlyAdjustment: 0,
        retroactiveAmount: 0,
        included: false,
        potentialMonthlyAdjustment: 0,
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

    const daysInRegPeriod = daysBetweenInclusive(regulationStart, regulationEnd);
    const bookingDays = overlapDays(
      regulationStart,
      regulationEnd,
      bookingStart,
      bookingEnd,
    );

    const proRatedMonthlyAdjustment =
      run.adjustmentPerSqm === 0 || daysInRegPeriod <= 0
        ? 0
        : (unitMonthlyAdjustment * bookingDays) / daysInRegPeriod;

    const excludedFromCalculation = unitSetting?.excludeFromCalculation ?? false;
    const excludedFromApplication =
      bookingSetting?.excludeFromApplication ?? false;

    // If a unit is excluded from calculation, leases should not appear in
    // the invoices breakdown, but we still track the potential adjustment
    // as part of the overall "loss".
    let retroactiveAmount = 0;
    if (run.retroactiveEnabled && run.retroFrom && run.retroTo) {
      const retroFrom = parseDate(run.retroFrom);
      const retroTo = parseDate(run.retroTo);
      const retroDays = overlapDays(retroFrom, retroTo, bookingStart, bookingEnd);
      retroactiveAmount = (unitMonthlyAdjustment / 30) * retroDays;
    }

    const potentialRetroactiveAmount = retroactiveAmount;

    if (excludedFromCalculation) {
      // Lease and its potential are completely excluded from distribution,
      // but we still track the potential adjustment as loss.
      return {
        regulationRunId: run.id,
        bookingId: booking.id,
        monthlyAdjustment: 0,
        retroactiveAmount: 0,
        included: false,
        potentialMonthlyAdjustment: proRatedMonthlyAdjustment,
        potentialRetroactiveAmount,
      };
    }

    if (excludedFromApplication) {
      // Lease stays visible in invoices, but with zero adjustment and
      // zero retroactive amount; the potential is counted as loss.
      return {
        regulationRunId: run.id,
        bookingId: booking.id,
        monthlyAdjustment: 0,
        retroactiveAmount: 0,
        included: true,
        potentialMonthlyAdjustment: proRatedMonthlyAdjustment,
        potentialRetroactiveAmount,
      };
    }

    // Normal case: adjustment applied.
    return {
      regulationRunId: run.id,
      bookingId: booking.id,
      monthlyAdjustment: proRatedMonthlyAdjustment,
      retroactiveAmount,
      included: true,
      potentialMonthlyAdjustment: proRatedMonthlyAdjustment,
      potentialRetroactiveAmount,
    };
  });
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
        retroactiveAmount: result.retroactiveAmount,
      };
    });
}

