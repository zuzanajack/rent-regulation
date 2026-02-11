import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  bookings,
  buildings,
  initialRegulationRun,
  initialRegulationUnitSettings,
  initialRegulationBookingSettings,
  regulationRuns,
  tenants,
  units,
  publicCharges,
} from './data';
import {
  buildInvoicePreviews,
  computeBookingResults,
  recomputeTotalsWithExclusions,
} from './rentRegulationService';
import type {
  PublicCharge,
  RegulationRun,
  RegulationUnitSetting,
  RegulationBookingSetting,
  Unit as UnitModel,
} from './models';

type Tab = 'buildings' | 'regulation' | 'invoices' | 'notifications' | 'templates';

type DistributionRow = {
  id: string;
  bookingId: string;
  tenantName: string;
  unitName: string;
  areaSqm: number | string;
  leaseStart?: string;
  leaseEnd?: string;
  currentAmount: number;
  adjustmentAmount: number;
  newAmount: number;
  description: string;
  recurring: boolean;
};

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('buildings');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(
    buildings[0]?.id,
  );
  const [run, setRun] = useState<RegulationRun>(initialRegulationRun);
  const [unitSettings, setUnitSettings] = useState<RegulationUnitSetting[]>(
    initialRegulationUnitSettings,
  );
  const [bookingSettings, setBookingSettings] = useState<
    RegulationBookingSetting[]
  >(initialRegulationBookingSettings);
  const [charges, setCharges] = useState(publicCharges);
  const [autoApproveInvoices, setAutoApproveInvoices] = useState(false);
  const [templateOverrides, setTemplateOverrides] = useState<
    Record<string, number | undefined>
  >({});
  const [chargeYearSort, setChargeYearSort] = useState<'asc' | 'desc'>('asc');
  const [periodSort, setPeriodSort] = useState<'asc' | 'desc'>('desc');

  const skuOptions = [
    { id: '2001', label: '2001 – Base rent' },
    { id: '2002', label: '2002 – Utilities' },
    { id: '2003', label: '2003 – Deposit' },
    { id: '2004', label: '2004 – Prepaid rent' },
    { id: '2005', label: '2005 – Parking' },
    { id: '2006', label: '2006 – Storage' },
    { id: '2007', label: '2007 – Service charges' },
  ];
  const expenseSkuOptions = [
    { id: '1001', label: '1001 – Property taxes' },
    { id: '1002', label: '1002 – Garbage collection' },
    { id: '1003', label: '1003 – Water & sewage' },
    { id: '1004', label: '1004 – Heating & energy' },
    { id: '1005', label: '1005 – Building insurance' },
    { id: '1006', label: '1006 – Common area maintenance' },
    { id: '1007', label: '1007 – Other building expenses' },
  ];
  const [selectedSku, setSelectedSku] = useState<string>(skuOptions[0].id);

  // Modal state for creating/editing public expenses
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseForm, setExpenseForm] = useState<{
    id?: string;
    label: string;
    sku: string;
    date: string;
    amount: number | '';
    vat: number | '';
  }>({
    label: '',
    sku: expenseSkuOptions[0].id,
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    vat: '',
  });

  const openNewExpenseModal = () => {
    if (regulationLocked) return;
    setEditingExpenseId(null);
    setExpenseForm({
      label: '',
      sku: expenseSkuOptions[0].id,
      date: new Date().toISOString().slice(0, 10),
      amount: '',
      vat: '',
    });
    setShowExpenseModal(true);
  };

  const openEditExpenseModal = (id: string) => {
    if (regulationLocked) return;
    const charge = charges.find((c) => c.id === id);
    if (!charge) return;
    // Derive representative date from nextPeriodFrom if available, else prevPeriodFrom, else today
    const derivedDate =
      charge.date ||
      charge.nextPeriodFrom ||
      charge.prevPeriodFrom ||
      new Date().toISOString().slice(0, 10);
    setEditingExpenseId(id);
    setExpenseForm({
      id: charge.id,
      label: charge.label,
      sku: charge.sku ?? expenseSkuOptions[0].id,
      date: derivedDate.slice(0, 10),
      amount: charge.nextAmount || charge.prevAmount || '',
      vat: charge.vat ?? '',
    });
    setShowExpenseModal(true);
  };

  const closeExpenseModal = () => {
    setShowExpenseModal(false);
    setEditingExpenseId(null);
  };

  const handleExpenseFormChange = <K extends keyof typeof expenseForm>(
    field: K,
    value: (typeof expenseForm)[K],
  ) => {
    setExpenseForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveExpense = () => {
    if (regulationLocked) return;
    const { label, sku, date, amount, vat } = expenseForm;
    if (!label || !sku || !date || amount === '' || Number.isNaN(Number(amount))) {
      // Basic inline validation – could be improved with messages
      return;
    }
    const numericAmount = Number(amount);
    const numericVat =
      vat === '' || Number.isNaN(Number(vat)) ? undefined : Number(vat);

    const year = new Date(date).getFullYear();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    if (editingExpenseId == null) {
      const newId = `pc-${Date.now()}`;
      const newCharge: PublicCharge = {
        id: newId,
        buildingId: building.id,
        label,
        sku,
        date,
        vat: numericVat,
        periodType: 'year',
        prevPeriodFrom: from,
        prevPeriodTo: to,
        prevAmount: 0,
        nextPeriodFrom: from,
        nextPeriodTo: to,
        nextAmount: numericAmount,
      };
      setCharges((prev) => [...prev, newCharge]);
    } else {
      setCharges((prev) =>
        prev.map((c) =>
          c.id === editingExpenseId
            ? {
                ...c,
                label,
                sku,
                date,
                vat: numericVat,
                nextPeriodFrom: from,
                nextPeriodTo: to,
                nextAmount: numericAmount,
              }
            : c,
        ),
      );
    }
    closeExpenseModal();
  };

  const handleDeleteExpense = (id: string) => {
    if (regulationLocked) return;
    setCharges((prev) => prev.filter((c) => c.id !== id));
    if (editingExpenseId === id) {
      closeExpenseModal();
    }
  };

  const invoicingEntities = [
    'Nordic Homes A/S',
    'CityRent Partners ApS',
    'Urban Living Group A/S',
    'Copenhagen Rentals ApS',
    'Harborview Properties A/S',
  ];
  const [selectedInvoicingEntity, setSelectedInvoicingEntity] = useState<string>(
    invoicingEntities[0],
  );

  const unitTypes: UnitModel['unitType'][] = ['apartment', 'shared', 'commercial'];
  const [includedTypes, setIncludedTypes] = useState<
    Record<UnitModel['unitType'], boolean>
  >({
    apartment: true,
    shared: true,
    commercial: true,
  });

  const building = useMemo(
    () =>
      buildings.find((b) => b.id === selectedBuildingId) ?? buildings[0],
    [selectedBuildingId],
  );

  const recomputedRun = useMemo(
    () => recomputeTotalsWithExclusions(run, units, unitSettings),
    [run, unitSettings],
  );

  const buildingChargeRows = useMemo(
    () => {
      const rows: {
        id: string;
        chargeId: string;
        which: 'prev' | 'next';
        label: string;
        year: number;
        amount: number;
      }[] = [];

      charges
        .filter((c) => c.buildingId === building.id)
        .forEach((charge) => {
          const baseYearFromDate = charge.date
            ? new Date(charge.date).getFullYear()
            : undefined;

          const yearPrev =
            baseYearFromDate !== undefined
              ? baseYearFromDate - 1
              : charge.prevPeriodFrom &&
                charge.prevPeriodFrom.length >= 4
              ? Number(charge.prevPeriodFrom.slice(0, 4))
              : NaN;
          if (
            Number.isFinite(yearPrev) &&
            yearPrev > 0 &&
            (charge.prevAmount ?? 0) !== 0
          ) {
            rows.push({
              id: `${charge.id}-prev`,
              chargeId: charge.id,
              which: 'prev',
              label: charge.label,
              year: yearPrev,
              amount: charge.prevAmount,
            });
          }

          const yearNext =
            baseYearFromDate !== undefined
              ? baseYearFromDate
              : charge.nextPeriodFrom &&
                charge.nextPeriodFrom.length >= 4
              ? Number(charge.nextPeriodFrom.slice(0, 4))
              : NaN;
          if (Number.isFinite(yearNext) && yearNext > 0) {
            rows.push({
              id: `${charge.id}-next`,
              chargeId: charge.id,
              which: 'next',
              label: charge.label,
              year: yearNext,
              amount: charge.nextAmount,
            });
          }
        });

      const years = Array.from(new Set(rows.map((r) => r.year)));
      years.sort((a, b) => a - b);
      const globalMaxYear =
        years.length > 0 ? years[years.length - 1] : undefined;
      const secondLargestYear =
        years.length > 1 ? years[years.length - 2] : undefined;

      return { rows, globalMaxYear, secondLargestYear };
    },
    [charges, building.id],
  );

  const sortedChargeRows = useMemo(() => {
    const { rows, globalMaxYear } = buildingChargeRows;
    if (globalMaxYear === undefined) return [];
    const visible = rows.filter((r) => r.year === globalMaxYear);
    return visible.sort((a, b) =>
      chargeYearSort === 'asc' ? a.year - b.year : b.year - a.year,
    );
  }, [buildingChargeRows, chargeYearSort]);

  type SkuYearSummary = {
    sku: string;
    labels: string[];
    prevYearAmount: number;
    nextYearAmount: number;
    diff: number;
  };

  const skuSummaries: {
    rows: SkuYearSummary[];
    totalPrev: number;
    totalNext: number;
    totalDiff: number;
  } = useMemo(() => {
    const { rows, globalMaxYear, secondLargestYear } = buildingChargeRows;
    if (globalMaxYear === undefined) {
      return { rows: [], totalPrev: 0, totalNext: 0, totalDiff: 0 };
    }

    const summaries = new Map<
      string,
      { prev: number; next: number; labels: Set<string> }
    >();

    for (const r of rows) {
      const charge = charges.find((c) => c.id === r.chargeId);
      const sku = charge?.sku ?? 'N/A';
      const label = charge?.label ?? '';
      if (!summaries.has(sku)) {
        summaries.set(sku, { prev: 0, next: 0, labels: new Set<string>() });
      }
      const entry = summaries.get(sku)!;
      if (label) {
        entry.labels.add(label);
      }
      if (r.year === globalMaxYear) {
        entry.next += r.amount;
      } else if (secondLargestYear !== undefined && r.year === secondLargestYear) {
        entry.prev += r.amount;
      }
    }

    const rowsOut: SkuYearSummary[] = [];
    let totalPrev = 0;
    let totalNext = 0;

    summaries.forEach((v, sku) => {
      const diff = v.next - v.prev;
      rowsOut.push({
        sku,
        labels: Array.from(v.labels),
        prevYearAmount: v.prev,
        nextYearAmount: v.next,
        diff,
      });
      totalPrev += v.prev;
      totalNext += v.next;
    });

    const totalDiff = totalNext - totalPrev;
    return { rows: rowsOut, totalPrev, totalNext, totalDiff };
  }, [buildingChargeRows, charges]);

  // Keep regulation run expense totals in sync with edited public charges.
  // Logic:
  // - Let largestYear = max(all years in rows)
  // - Let secondLargestYear = second largest year, if any
  // - Next expenses = sum(amount for rows with year === largestYear)
  // - Previous expenses = sum(amount for rows with year === secondLargestYear)
  useEffect(() => {
    let totalPrev = 0;
    let totalNext = 0;

    const { rows, globalMaxYear, secondLargestYear } = buildingChargeRows;

    if (globalMaxYear !== undefined) {
      for (const r of rows) {
        if (r.year === globalMaxYear) {
          totalNext += r.amount;
        } else if (secondLargestYear !== undefined && r.year === secondLargestYear) {
          totalPrev += r.amount;
        }
      }
    }

    setRun((prev) => ({
      ...prev,
      totalPrevExpenses: totalPrev,
      totalNextExpenses: totalNext,
      totalDelta: totalNext - totalPrev,
    }));
  }, [buildingChargeRows]);

  // Keep unit-level exclusion in sync with type-level selection
  useEffect(() => {
    setUnitSettings((prev) =>
      prev.map((s) => {
        const unit = units.find((u) => u.id === s.unitId);
        if (!unit) return s;
        const includeType = includedTypes[unit.unitType] ?? true;
        return { ...s, excludeFromCalculation: !includeType };
      }),
    );
  }, [includedTypes, units]);

  const bookingResults = useMemo(
    () =>
      computeBookingResults(
        recomputedRun,
        building,
        units,
        bookings,
        unitSettings,
        bookingSettings,
      ),
    [recomputedRun, building, bookingSettings],
  );

  // Bookings explicitly excluded from application (but still part of calculation).
  const excludedApplicationResults = useMemo(
    () =>
      bookingResults.filter((r) => {
        const setting = bookingSettings.find(
          (s) => s.bookingId === r.bookingId && s.regulationRunId === run.id,
        );
        return setting?.excludeFromApplication === true;
      }),
    [bookingResults, bookingSettings, run.id],
  );

  // Total undistributed taxes & fees (per year) – i.e. the part of the
  // public charges that is NOT allocated to tenants because specific
  // leases were excluded from application.
  const totalUndistributedTaxesPerYear = useMemo(
    () =>
      excludedApplicationResults.reduce((sum, r) => {
        // r.potentialMonthlyAdjustment is monthly ⇒ convert to yearly
        const yearlyRecurring = (r.potentialMonthlyAdjustment ?? 0) * 12;
        const retro = r.potentialRetroactiveAmount ?? 0;
        return sum + yearlyRecurring + retro;
      }, 0),
    [excludedApplicationResults],
  );

  const excludedUnitsNames = useMemo(
    () =>
      units
        .filter((u) => u.buildingId === building.id)
        .filter((u) =>
          unitSettings.some(
            (s) =>
              s.unitId === u.id &&
              s.regulationRunId === run.id &&
              s.excludeFromCalculation,
          ),
        )
        .map((u) => u.name),
    [units, building.id, unitSettings, run.id],
  );

  const invoicePreviews = useMemo(
    () => buildInvoicePreviews(bookings, units, tenants, bookingResults),
    [bookingResults],
  );

  const distributionRows = useMemo<DistributionRow[]>(
    () =>
      invoicePreviews.flatMap((inv) => {
        const unit = units.find(
          (u) => u.name === inv.unitName && u.buildingId === building.id,
        );
        const booking = bookings.find((b) => b.id === inv.bookingId);

        const baseRow = {
          bookingId: inv.bookingId,
          tenantName: inv.tenantName,
          unitName: inv.unitName,
          areaSqm: unit?.areaSqm ?? '–',
          leaseStart: booking?.startDate,
          leaseEnd: booking?.endDate,
        };

        const rentRow: DistributionRow = {
          id: `${inv.bookingId}-rent`,
          ...baseRow,
          description: 'Rent',
          currentAmount: inv.oldMonthlyRent,
          adjustmentAmount: inv.monthlyAdjustment,
          newAmount: inv.newMonthlyRent,
          recurring: true,
        };

        const depositRow: DistributionRow = {
          id: `${inv.bookingId}-deposit`,
          ...baseRow,
          description: 'Deposit',
          currentAmount: inv.oldMonthlyRent * 3,
          adjustmentAmount: inv.monthlyAdjustment * 3,
          newAmount: inv.newMonthlyRent * 3,
          recurring: false,
        };

        const prepaidRow: DistributionRow = {
          id: `${inv.bookingId}-prepaid`,
          ...baseRow,
          description: 'Prepaid rent',
          currentAmount: inv.oldMonthlyRent,
          adjustmentAmount: inv.monthlyAdjustment,
          newAmount: inv.newMonthlyRent,
          recurring: false,
        };

        return [rentRow, depositRow, prepaidRow];
      }),
    [invoicePreviews, units, building.id],
  );

  const [isRunningRegulation, setIsRunningRegulation] = useState(false);
  const [regulationCompleted, setRegulationCompleted] = useState(false);
  const [regulationLocked, setRegulationLocked] = useState(false);
  const [costLocked, setCostLocked] = useState(false);
  const [showRunSuccess, setShowRunSuccess] = useState(false);
  const [showDistributionSuccess, setShowDistributionSuccess] = useState(false);
  const [isApplyingCostChanges, setIsApplyingCostChanges] = useState(false);
  const [showCostSuccess, setShowCostSuccess] = useState(false);

  const handleRunRegulationFromInvoices = () => {
    if (isRunningRegulation || regulationCompleted) {
      return;
    }
    setIsRunningRegulation(true);
    // Simulate async processing for the prototype so the progress state is visible
    setTimeout(() => {
      setIsRunningRegulation(false);
      setRegulationCompleted(true);
      setRegulationLocked(true);
      setShowRunSuccess(true);
      setShowDistributionSuccess(true);

      setTimeout(() => {
        setShowRunSuccess(false);
        setShowDistributionSuccess(false);
      }, 2000);
    }, 800);
  };

  const handleApplyCostChanges = () => {
    if (isApplyingCostChanges || costLocked) {
      return;
    }
    setIsApplyingCostChanges(true);
    setTimeout(() => {
      setIsApplyingCostChanges(false);
      setShowCostSuccess(true);
      setCostLocked(true);

      setTimeout(() => {
        setShowCostSuccess(false);
      }, 2000);
    }, 800);
  };

  const deriveRetroPeriod = (adjustmentDateIso: string) => {
    if (!adjustmentDateIso) return { retroFrom: '', retroTo: '' };

    const [year, month, day] = adjustmentDateIso.split('-');
    if (!year || !month || !day) return { retroFrom: '', retroTo: '' };

    const adjDate = new Date(`${adjustmentDateIso}T00:00:00`);
    if (Number.isNaN(adjDate.getTime())) return { retroFrom: '', retroTo: '' };

    const retroFrom = `${year}-01-01`;

    const prevDay = new Date(adjDate);
    prevDay.setDate(prevDay.getDate() - 1);
    const prevY = prevDay.getFullYear();
    const prevM = String(prevDay.getMonth() + 1).padStart(2, '0');
    const prevD = String(prevDay.getDate()).padStart(2, '0');
    const retroTo = `${prevY}-${prevM}-${prevD}`;

    return { retroFrom, retroTo };
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '–';
    const [year, month, day] = iso.split('-');
    if (!year || !month || !day) return iso;
    return `${day}-${month}-${year}`;
  };

  const formatUnitTypeLabel = (type: UnitModel['unitType']) => {
    if (type === 'apartment') return 'Apartments';
    if (type === 'shared') return 'Shared apartments';
    if (type === 'commercial') return 'Commercial units';
    return type;
  };

  const handleStartRegulation = () => {
    setActiveTab('regulation');
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="page-title">Buildings / {building.name}</h1>
          <div className="nav-rows">
            <nav className="nav nav-row-1">
              <button className="nav-btn">General</button>
              <button className="nav-btn">Listing</button>
              <button className="nav-btn">Contacts</button>
              <button className="nav-btn">Tasks</button>
              <button className="nav-btn">Specifications</button>
              <button className="nav-btn active" onClick={() => setActiveTab('buildings')}>
                Public taxes & fees
              </button>
              <button className="nav-btn">Costs</button>
              <button className="nav-btn">Feed</button>
            </nav>
          </div>
        </div>
      </header>
      <main className="main">
        {activeTab !== 'buildings' && (
          <div className="wizard-steps-container">
            <div className="wizard-steps-title">Run rent regulation:</div>
            <nav className="nav nav-row-2">
              {(() => {
                const stepTabs = [
                  { id: 'regulation' as const, label: 'Setup', step: 1 },
                  { id: 'invoices' as const, label: 'Distribution', step: 2 },
                  { id: 'notifications' as const, label: 'Notification letters', step: 3 },
                  { id: 'templates' as const, label: 'Cost adjustments', step: 4 },
                ];
                const currentStepIndex = stepTabs.findIndex((s) => s.id === activeTab);
                return stepTabs.flatMap((stepConfig, index) => {
                  const isActive = activeTab === stepConfig.id;
                  const isCompleted =
                    currentStepIndex !== -1 && currentStepIndex > index;
                  const stepClass = [
                    'nav-btn',
                    'wizard-step',
                    isActive ? 'wizard-step-active' : '',
                    isCompleted ? 'wizard-step-completed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const stepButton = (
                    <button
                      key={stepConfig.id}
                      className={stepClass}
                      onClick={() => setActiveTab(stepConfig.id)}
                    >
                      <span className="step-index">{stepConfig.step}</span>
                      <span>{stepConfig.label}</span>
                    </button>
                  );
                  
                  // Add separator after each step except the last
                  if (index < stepTabs.length - 1) {
                    return [
                      stepButton,
                      <span
                        key={`separator-${index}`}
                        className="wizard-step-separator"
                      >
                        &gt;
                      </span>,
                    ];
                  }
                  return stepButton;
                });
              })()}
            </nav>
          </div>
        )}
        {activeTab === 'buildings' && (
          <section>
            {buildings.length > 1 && (
              <div className="field" style={{ marginBottom: '1rem' }}>
                <label>Building</label>
                <select
                  value={selectedBuildingId}
                  onChange={(e) => setSelectedBuildingId(e.target.value)}
                >
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="table-sort"
                      onClick={() =>
                        setPeriodSort((prev) =>
                          prev === 'asc' ? 'desc' : 'asc',
                        )
                      }
                    >
                      Period {periodSort === 'asc' ? '↑' : '↓'}
                    </button>
                  </th>
                  <th>Total adjustment amount</th>
                  <th>Total adjustment per sqm</th>
                  <th>Notification date</th>
                  <th>Adjustment date</th>
                  <th>Included unit types</th>
                </tr>
              </thead>
              <tbody>
                {regulationRuns
                  .filter((r) => r.buildingId === building.id)
                  .sort((a, b) => {
                    const yearA = Number(a.adjustmentStartDate?.slice(0, 4)) || 0;
                    const yearB = Number(b.adjustmentStartDate?.slice(0, 4)) || 0;
                    return periodSort === 'asc' ? yearA - yearB : yearB - yearA;
                  })
                  .map((r) => {
                    const includedUnitIds = unitSettings
                      .filter(
                        (s) =>
                          s.regulationRunId === r.id &&
                          !s.excludeFromCalculation,
                      )
                      .map((s) => s.unitId);
                    const includedTypesList = Array.from(
                      new Set(
                        units
                          .filter((u) => includedUnitIds.includes(u.id))
                          .map((u) => u.unitType),
                      ),
                    )
                      .map(formatUnitTypeLabel)
                      .join(', ');
                    const periodYear =
                      r.adjustmentStartDate?.slice(0, 4) ?? '–';
                    return (
                      <tr key={r.id}>
                        <td>{periodYear}</td>
                        <td>
                          {(r.totalNextExpenses - r.totalPrevExpenses).toLocaleString(
                            'da-DK',
                          )}{' '}
                          kr
                        </td>
                        <td>
                          {r.adjustmentPerSqm.toFixed(2)} kr / sqm
                        </td>
                        <td>{formatDate(r.notificationDate)}</td>
                        <td>{formatDate(r.adjustmentStartDate)}</td>
                        <td>{includedTypesList || '–'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div style={{ marginTop: '1rem' }}>
              <button className="primary-btn" onClick={handleStartRegulation}>
                Run rent regulation
              </button>
            </div>
          </section>
        )}

        {activeTab === 'regulation' && (
          <section>
            <div className="grid-2">
              <div className="panel">
                <h3>Summary</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Expense name</th>
                      <th>SKU</th>
                      <th>
                        Previous year{' '}
                        {buildingChargeRows.secondLargestYear ?? '–'}
                      </th>
                      <th>
                        New year {buildingChargeRows.globalMaxYear ?? '–'}
                      </th>
                      <th>Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuSummaries.rows.map((row) => (
                      <tr key={row.sku}>
                        <td>{row.labels.join(', ') || '–'}</td>
                        <td>{row.sku}</td>
                        <td>
                          {row.prevYearAmount.toLocaleString('da-DK')} kr / year
                        </td>
                        <td>
                          {row.nextYearAmount.toLocaleString('da-DK')} kr / year
                        </td>
                        <td>
                          {row.diff >= 0 ? '+' : ''}
                          {row.diff.toLocaleString('da-DK')} kr / year
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td />
                      <td>
                        <strong>
                          {skuSummaries.totalPrev.toLocaleString('da-DK')} kr / year
                        </strong>
                      </td>
                      <td>
                        <strong>
                          {skuSummaries.totalNext.toLocaleString('da-DK')} kr / year
                        </strong>
                      </td>
                      <td>
                        <strong>
                          {skuSummaries.totalDiff >= 0 ? '+' : ''}
                          {skuSummaries.totalDiff.toLocaleString('da-DK')} kr / year
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  Rentable area (included units):{' '}
                  <strong>
                    {recomputedRun.totalRentableAreaSqm.toFixed(1)} sqm
                  </strong>
                </p>
                <p>
                  Adjustment per sqm (year):{' '}
                  <strong>
                    {recomputedRun.adjustmentPerSqm.toFixed(2)} kr / sqm / year
                  </strong>
                </p>
                <p className="hint">
                  Monthly surcharge per unit is calculated as (Δ per sqm × unit
                  area) / 12. This is the share of the changed public taxes and
                  fees that is allocated to that unit.
                </p>
              </div>
            </div>
            <div className="grid-2">
              <div className="panel">
                <h3>Public taxes &amp; fees for this building</h3>
                <p className="hint">
                  The system automatically detects which expenses belong to this
                  regulation run. Rows with the{' '}
                  <strong>latest year</strong> are treated as the{' '}
                  <strong>next expense period</strong>, and rows with the{' '}
                  <strong>second-latest year</strong> are treated as the{' '}
                  <strong>previous expense period</strong>. Older years are shown
                  for reference only and are not included in this run.
                </p>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Expense name</th>
                      <th>SKU</th>
                      <th>Date</th>
                      <th>Amount / year</th>
                      <th>VAT</th>
                      <th>Documentation</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedChargeRows.map((row) => {
                      const charge = charges.find(
                        (c) => c.id === row.chargeId,
                      );
                      const docName =
                        row.which === 'prev'
                          ? charge?.prevDocumentName
                          : charge?.nextDocumentName;
                      const isHistorical =
                        buildingChargeRows.secondLargestYear !== undefined &&
                        row.year < buildingChargeRows.secondLargestYear!;

                      return (
                        <tr
                          key={row.id}
                          className={isHistorical ? 'table-row-historical' : undefined}
                          onClick={() => {
                            if (!isHistorical && charge && !regulationLocked) {
                              openEditExpenseModal(charge.id);
                            }
                          }}
                        >
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">
                                {charge?.label ?? row.label}
                              </span>
                            ) : (
                              <span>{charge?.label ?? row.label}</span>
                            )}
                          </td>
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">
                                {charge?.sku ?? '–'}
                              </span>
                            ) : (
                              <span>{charge?.sku ?? '–'}</span>
                            )}
                          </td>
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">
                                {charge?.date ? formatDate(charge.date) : '–'}
                              </span>
                            ) : (
                              <span>
                                {charge?.date ? formatDate(charge.date) : '–'}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={isHistorical ? 'historical-text' : undefined}>
                              {row.amount.toLocaleString('da-DK')} kr
                            </span>
                          </td>
                          <td>
                            <span className={isHistorical ? 'historical-text' : undefined}>
                              {charge?.vat !== undefined && charge.vat !== null
                                ? `${charge.vat.toLocaleString('da-DK')}`
                                : '–'}
                            </span>
                          </td>
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">
                                {docName ?? '—'}
                              </span>
                            ) : docName ? (
                              <span>
                                {docName}{' '}
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() =>
                                    setCharges((prev) =>
                                      prev.map((c) =>
                                        c.id === row.chargeId
                                          ? row.which === 'prev'
                                            ? {
                                                ...c,
                                                prevDocumentName: undefined,
                                              }
                                            : {
                                                ...c,
                                                nextDocumentName: undefined,
                                              }
                                          : c,
                                      ),
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              </span>
                            ) : (
                              <input
                                type="file"
                                disabled={regulationLocked}
                                onChange={(e) => {
                                  if (regulationLocked) return;
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  setCharges((prev) =>
                                    prev.map((c) =>
                                      c.id === row.chargeId
                                        ? row.which === 'prev'
                                          ? {
                                              ...c,
                                              prevDocumentName: file.name,
                                            }
                                          : {
                                              ...c,
                                              nextDocumentName: file.name,
                                            }
                                        : c,
                                    ),
                                  );
                                }}
                              />
                            )}
                          </td>
                          <td>
                          {!isHistorical && charge && (
                            <button
                              className="text-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteExpense(charge.id);
                              }}
                              disabled={regulationLocked}
                            >
                              Delete
                            </button>
                          )}
                          </td>
                        </tr>
                      );
                    })}
</tbody>
                </table>
                <button
                  className="outline-btn"
                  onClick={openNewExpenseModal}
                  style={{ marginTop: '1rem' }}
                  disabled={regulationLocked}
                >
                  Add expense
                </button>
                <p className="hint">
                  Adjust the current annual amounts to run simple what-if
                  scenarios. The per-unit surcharge and invoices will update
                  instantly.
                </p>
              </div>
              <div className="panel">
                <h3>Key dates</h3>
                <div className="field">
                  <label>Notification date</label>
                  <input
                    type="date"
                    value={run.notificationDate}
                    onChange={(e) =>
                      setRun({ ...run, notificationDate: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Adjustment start date</label>
                  <input
                    type="date"
                    value={run.adjustmentStartDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      let nextRun: RegulationRun = {
                        ...run,
                        adjustmentStartDate: nextDate,
                      };

                      if (run.retroactiveEnabled && nextDate) {
                        const { retroFrom, retroTo } =
                          deriveRetroPeriod(nextDate);
                        nextRun = { ...nextRun, retroFrom, retroTo };
                      }

                      setRun(nextRun);
                    }}
                  />
                </div>
                <div className="field checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={run.retroactiveEnabled}
                      disabled={regulationLocked}
                      onChange={(e) => {
                        if (regulationLocked) return;
                        const enabled = e.target.checked;
                        let nextRun: RegulationRun = {
                          ...run,
                          retroactiveEnabled: enabled,
                        };

                        if (enabled && run.adjustmentStartDate) {
                          const { retroFrom, retroTo } = deriveRetroPeriod(
                            run.adjustmentStartDate,
                          );
                          nextRun = { ...nextRun, retroFrom, retroTo };
                        }

                        if (!enabled) {
                          nextRun = {
                            ...nextRun,
                            retroFrom: undefined,
                            retroTo: undefined,
                          };
                        }

                        setRun(nextRun);
                      }}
                    />
                    Enable retroactive one-time charge
                  </label>
                </div>
                {run.retroactiveEnabled && (
                  <>
                    <div className="field">
                      <label>Retroactive from</label>
                      <input
                        type="date"
                        value={run.retroFrom ?? ''}
                        disabled={regulationLocked}
                        onChange={(e) =>
                          setRun({ ...run, retroFrom: e.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Retroactive to</label>
                      <input
                        type="date"
                        value={run.retroTo ?? ''}
                        disabled={regulationLocked}
                        onChange={(e) =>
                          setRun({ ...run, retroTo: e.target.value })
                        }
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="panel" style={{ marginBottom: '0.75rem' }}>
                <h3>Which charges do you want to regulate?</h3>
                <p className="hint">
                  Identify invoicing lines that should be regulated by selecting
                  SKUs.
                </p>
                <div className="field">
                  <label>Select SKU</label>
                  <select
                    className="inline-input"
                    value={selectedSku}
                    disabled={regulationLocked}
                    onChange={(e) => setSelectedSku(e.target.value)}
                  >
                    {skuOptions.map((sku) => (
                      <option key={sku.id} value={sku.id}>
                        {sku.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                  <h4 style={{ margin: 0, marginBottom: '0.25rem' }}>
                    Included unit types
                  </h4>
                  {unitTypes.map((type) => (
                    <div key={type} className="field checkbox">
                      <label>
                        <input
                          type="checkbox"
                          checked={includedTypes[type] ?? true}
                          disabled={regulationLocked}
                          onChange={(e) => {
                            if (regulationLocked) return;
                            setIncludedTypes((prev) => ({
                              ...prev,
                              [type]: e.target.checked,
                            }));
                          }}
                        />
                        {formatUnitTypeLabel(type)}
                      </label>
                    </div>
                  ))}
                  <p className="hint">
                    Excluded unit types will not be used to distribute expenses and
                    will not receive adjustments, invoices, or notifications.
                  </p>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: '0.75rem' }}>
                <h3>New invoicing lines setup</h3>
                <div className="field">
                  <label>Invoicing entity</label>
                  <select
                    className="inline-input"
                    value={selectedInvoicingEntity}
                    disabled={regulationLocked}
                    onChange={(e) => setSelectedInvoicingEntity(e.target.value)}
                  >
                    {invoicingEntities.map((entity) => (
                      <option key={entity} value={entity}>
                        {entity}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ marginTop: '1rem', textAlign: 'left' }}>
              <div
                style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                <button
                  className={`primary-btn${
                    showDistributionSuccess ? ' success' : ''
                  }`}
                  onClick={() => setActiveTab('invoices')}
                  disabled={regulationLocked && !showDistributionSuccess}
                >
                  {regulationLocked
                    ? '✓ Distribution calculated'
                    : 'Calculate distribution per booking'}
                </button>
                {regulationLocked && (
                  <button
                    className="primary-btn"
                    onClick={() => {
                      setRegulationLocked(false);
                      setRegulationCompleted(false);
                      setIsRunningRegulation(false);
                      setShowRunSuccess(false);
                      setShowDistributionSuccess(false);
                      setIsApplyingCostChanges(false);
                      setShowCostSuccess(false);
                      setCostLocked(false);
                    }}
                  >
                    Reopen setup and re-run regulation
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'invoices' && (
          <section>
            <div className="grid-2">
              <div className="panel">
                <h3>Summary</h3>
                <p>
                  Δ expenses:{' '}
                  <strong>
                    {recomputedRun.totalDelta.toLocaleString('da-DK')} kr / year
                  </strong>
                </p>
                <p>
                  Adjustment per sqm (year):{' '}
                  <strong>
                    {recomputedRun.adjustmentPerSqm.toFixed(2)} kr / sqm / year
                  </strong>
                </p>
                <p>
                  Adjustment date:{' '}
                  <strong>{formatDate(run.adjustmentStartDate)}</strong>
                </p>
                <p>
                  Undistributed taxes &amp; fees (landlord&apos;s annual
                  expense):{' '}
                  <strong>
                    {totalUndistributedTaxesPerYear.toFixed(0)} kr / year
                  </strong>
                </p>
                <p>
                  Units excluded from calculation:{' '}
                  <strong>
                    {excludedUnitsNames.length > 0
                      ? excludedUnitsNames.join(', ')
                      : 'None'}
                  </strong>
                </p>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Unit</th>
                  <th>Unit size (sqm)</th>
                  <th>Lease start</th>
                  <th>Lease end</th>
                  <th>Description</th>
                  <th>Recurring</th>
                  <th>Current amount</th>
                  <th>Adjustment amount</th>
                  <th>New amount</th>
                  <th>Exclude from application</th>
                  <th>Retroactive amount</th>
                </tr>
              </thead>
              <tbody>
                {distributionRows.map((row) => {
                  const isRentRow = row.description === 'Rent';
                  const invoice = invoicePreviews.find(
                    (inv) => inv.bookingId === row.bookingId,
                  );

                  const setting = bookingSettings.find(
                    (s) =>
                      s.bookingId === row.bookingId &&
                      s.regulationRunId === run.id,
                  );

                  return (
                    <tr key={row.id}>
                      <td>{row.tenantName}</td>
                      <td>{row.unitName}</td>
                      <td>{row.areaSqm}</td>
                      <td>{formatDate(row.leaseStart)}</td>
                      <td>{formatDate(row.leaseEnd)}</td>
                      <td>{row.description}</td>
                      <td>
                        <span aria-hidden="true">
                          {row.recurring ? '✓' : '✕'}
                        </span>
                      </td>
                      <td>
                        {row.currentAmount.toLocaleString('da-DK', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        kr
                      </td>
                      <td>
                        {row.adjustmentAmount.toLocaleString('da-DK', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        kr
                      </td>
                      <td>
                        {row.newAmount.toLocaleString('da-DK', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        kr
                      </td>
                      <td>
                        {isRentRow && (
                          <input
                            type="checkbox"
                            checked={setting?.excludeFromApplication ?? false}
                            disabled={regulationLocked}
                            onChange={(e) => {
                              if (regulationLocked) return;
                              setBookingSettings((prev) =>
                                prev.map((s) =>
                                  s.bookingId === row.bookingId &&
                                  s.regulationRunId === run.id
                                    ? {
                                        ...s,
                                        excludeFromApplication: e.target
                                          .checked,
                                      }
                                    : s,
                                ),
                              );
                            }}
                          />
                        )}
                      </td>
                      <td>
                        {isRentRow && invoice && invoice.retroactiveAmount > 0
                          ? `${invoice.retroactiveAmount.toFixed(0)} kr`
                          : isRentRow
                          ? '0 kr'
                          : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="panel" style={{ marginTop: '1rem' }}>
              <div className="field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={autoApproveInvoices}
                    onChange={(e) => setAutoApproveInvoices(e.target.checked)}
                    disabled={isRunningRegulation || regulationLocked}
                  />
                  Automatically approve new invoicing lines
                </label>
              </div>
              <button
                className={`primary-btn${showRunSuccess ? ' success' : ''}`}
                onClick={handleRunRegulationFromInvoices}
                disabled={
                  isRunningRegulation ||
                  (regulationCompleted && !showRunSuccess)
                }
              >
                {isRunningRegulation
                  ? 'Running rent regulation…'
                  : regulationCompleted
                  ? '✓ Rent regulation completed'
                  : 'Run rent regulation'}
              </button>
            </div>
          </section>
        )}

        {activeTab === 'notifications' && (
          <section>
            <p className="hint">
              You are previewing a single example of the tenant notification
              letter. Each tenant will receive their individual notification on{' '}
              {formatDate(run.notificationDate)}. Tenants excluded from application
              will not receive any notification letter.
            </p>
            {(() => {
              const exampleInvoice = invoicePreviews.find((inv) =>
                bookingSettings.every(
                  (s) =>
                    s.bookingId !== inv.bookingId ||
                    !s.excludeFromApplication ||
                    s.regulationRunId !== run.id,
                ),
              );
              return exampleInvoice ? (
                <article className="letter">
                  <div className="letter-from">
                    <div>From</div>
                    <div style={{ marginTop: '1rem' }}>
                      <div>{building.name}</div>
                      <div>{building.address}</div>
                    </div>
                  </div>
                  <div className="letter-to">
                    <div>To</div>
                    <div style={{ marginTop: '1rem' }}>
                      <div>{exampleInvoice.tenantName}</div>
                      <div>{exampleInvoice.unitName}</div>
                      <div>{building.address}</div>
                    </div>
                  </div>
                  <div className="letter-date">Date: {formatDate(run.notificationDate)}</div>
                  <div className="letter-subject">RE: Notice of Rent Increase</div>
                  <div className="letter-salutation">Dear {exampleInvoice.tenantName},</div>
                  <div className="letter-body">
                    <p>
                      We hope this letter finds you well. As per the terms of your current lease agreement, we are providing you with a formal notice of a rent increase for your rental property located at: {exampleInvoice.unitName}, {building.address}.
                    </p>
                    <p>
                      Effective {formatDate(run.adjustmentStartDate)}, your monthly rent will increase from{' '}
                      <strong>
                        {exampleInvoice.oldMonthlyRent.toLocaleString('da-DK')} kr
                      </strong>{' '}
                      to{' '}
                      <strong>
                        {exampleInvoice.newMonthlyRent.toLocaleString('da-DK')} kr
                      </strong>
                      . This adjustment is in line with the current market rates and the provisions outlined in your lease agreement.
                    </p>
                    {run.retroactiveEnabled && exampleInvoice.retroactiveAmount > 0 && (
                      <p>
                        In addition, there will be a one-time adjustment for the period{' '}
                        <strong>{formatDate(run.retroFrom)}</strong> to{' '}
                        <strong>{formatDate(run.retroTo)}</strong> in the amount of{' '}
                        <strong>{exampleInvoice.retroactiveAmount.toFixed(0)} kr</strong>.
                      </p>
                    )}
                    <p>
                      Please ensure that your future rent payments reflect this change. If you have any questions or concerns regarding this rent increase, please feel free to contact us. We are open to discussing any issues you may have and working together to find a mutually agreeable solution.
                    </p>
                    <p>
                      We value you as a tenant and appreciate your understanding in this matter. Thank you for your continued residency and for being a part of our rental community.
                    </p>
                  </div>
                  <div className="letter-closing">Sincerely,</div>
                  <div className="letter-signature">
                    <div style={{ marginTop: '2rem', marginBottom: '0.5rem' }}></div>
                    <div>(Landlord Signature)</div>
                  </div>
                  {charges.filter((c) => c.buildingId === building.id).some((c) => {
                    const yearPrev =
                      c.prevPeriodFrom &&
                      c.prevPeriodFrom.length >= 4
                        ? Number(c.prevPeriodFrom.slice(0, 4))
                        : NaN;
                    const yearNext =
                      c.nextPeriodFrom &&
                      c.nextPeriodFrom.length >= 4
                        ? Number(c.nextPeriodFrom.slice(0, 4))
                        : NaN;
                    const maxYear = Math.max(
                      Number.isFinite(yearPrev) ? yearPrev : -Infinity,
                      Number.isFinite(yearNext) ? yearNext : -Infinity,
                    );
                    return (
                      (Number.isFinite(yearPrev) &&
                        yearPrev === maxYear &&
                        c.prevDocumentName) ||
                      (Number.isFinite(yearNext) &&
                        yearNext === maxYear &&
                        c.nextDocumentName)
                    );
                  }) && (
                    <div className="letter-body" style={{ marginTop: '1rem' }}>
                      <p>
                        <strong>Attachments:</strong>{' '}
                        {charges
                          .filter((c) => c.buildingId === building.id)
                          .flatMap((c) => {
                            const items: string[] = [];
                            const yearPrev =
                              c.prevPeriodFrom &&
                              c.prevPeriodFrom.length >= 4
                                ? Number(c.prevPeriodFrom.slice(0, 4))
                                : NaN;
                            const yearNext =
                              c.nextPeriodFrom &&
                              c.nextPeriodFrom.length >= 4
                                ? Number(c.nextPeriodFrom.slice(0, 4))
                                : NaN;
                            const maxYear = Math.max(
                              Number.isFinite(yearPrev) ? yearPrev : -Infinity,
                              Number.isFinite(yearNext) ? yearNext : -Infinity,
                            );
                            if (
                              Number.isFinite(yearPrev) &&
                              yearPrev === maxYear &&
                              c.prevDocumentName
                            ) {
                              items.push(`${c.label} (${c.prevDocumentName})`);
                            }
                            if (
                              Number.isFinite(yearNext) &&
                              yearNext === maxYear &&
                              c.nextDocumentName
                            ) {
                              items.push(`${c.label} (${c.nextDocumentName})`);
                            }
                            return items;
                          })
                          .join(', ')}
                      </p>
                    </div>
                  )}
                </article>
              ) : null;
            })()}
          </section>
        )}

        {activeTab === 'templates' && (
          <section>
            <p className="hint">
              Updated rent costs will be used as a base rent for future bookings.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Area (SQM)</th>
                  <th>Current rent cost</th>
                  <th>Adjustment amount</th>
                  <th>Suggested new rent cost</th>
                </tr>
              </thead>
              <tbody>
                {units
                  .filter((u) => u.buildingId === building.id)
                  .filter(
                    (u) =>
                      !unitSettings.some(
                        (s) =>
                          s.unitId === u.id &&
                          s.regulationRunId === run.id &&
                          s.excludeFromCalculation,
                      ),
                  )
                  .map((unit) => {
                    const monthlyAdjustment =
                      (recomputedRun.adjustmentPerSqm * unit.areaSqm) / 12;
                    const newTemplate = unit.baseMonthlyRent + monthlyAdjustment;
                    const suggested =
                      templateOverrides[unit.id] ?? Math.round(newTemplate);
                    return (
                      <tr key={unit.id}>
                        <td>{unit.name}</td>
                        <td>{unit.areaSqm}</td>
                        <td>
                          {unit.baseMonthlyRent.toLocaleString('da-DK')} kr
                        </td>
                        <td>
                          {(suggested - unit.baseMonthlyRent).toFixed(0)} kr
                        </td>
                        <td>
                          <input
                            type="number"
                            className="inline-input"
                            value={suggested}
                            disabled={isApplyingCostChanges || costLocked}
                            onChange={(e) =>
                              setTemplateOverrides((prev) => ({
                                ...prev,
                                [unit.id]: Number(e.target.value) || 0,
                              }))
                            }
                          />{' '}
                          kr
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <button
              className={`primary-btn${showCostSuccess ? ' success' : ''}`}
              onClick={handleApplyCostChanges}
              disabled={isApplyingCostChanges || costLocked}
            >
              {isApplyingCostChanges
                ? 'Applying rent cost changes…'
                : costLocked
                ? '✓ Rent cost changes applied'
                : 'Apply rent cost changes'}
            </button>
          </section>
        )}

        {showExpenseModal && (
          <div className="dialog-backdrop">
            <div className="dialog" style={{ maxWidth: '520px' }}>
              <h3>{editingExpenseId ? 'Edit expense' : 'Add expense'}</h3>
              <div className="field">
                <label>Expense name *</label>
                <input
                  type="text"
                  value={expenseForm.label}
                  onChange={(e) =>
                    handleExpenseFormChange('label', e.target.value)
                  }
                  placeholder="e.g. Municipal property tax"
                />
              </div>
              <div className="field">
                <label>SKU *</label>
                <select
                  className="inline-input"
                  value={expenseForm.sku}
                  onChange={(e) =>
                    handleExpenseFormChange('sku', e.target.value)
                  }
                >
                  {expenseSkuOptions.map((sku) => (
                    <option key={sku.id} value={sku.id}>
                      {sku.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Date *</label>
                <input
                  type="date"
                  value={expenseForm.date}
                  onChange={(e) =>
                    handleExpenseFormChange('date', e.target.value)
                  }
                />
              </div>
              <div className="field">
                <label>Amount (per year) *</label>
                <input
                  type="number"
                  value={expenseForm.amount}
                  onChange={(e) =>
                    handleExpenseFormChange(
                      'amount',
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                />
              </div>
              <div className="field">
                <label>VAT</label>
                <input
                  type="number"
                  value={expenseForm.vat}
                  onChange={(e) =>
                    handleExpenseFormChange(
                      'vat',
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                />
              </div>
              <p className="hint">Fields marked * are required.</p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '1rem',
                }}
              >
                {editingExpenseId ? (
                  <button
                    className="text-button"
                    onClick={() => handleDeleteExpense(editingExpenseId)}
                  >
                    Delete expense
                  </button>
                ) : (
                  <span />
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="outline-btn" onClick={closeExpenseModal}>
                    Cancel
                  </button>
                  <button className="primary-btn" onClick={handleSaveExpense}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
