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
  RegulationRun,
  RegulationUnitSetting,
  RegulationBookingSetting,
  Unit as UnitModel,
} from './models';

type Tab = 'buildings' | 'regulation' | 'invoices' | 'notifications' | 'templates';

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

  const skuOptions = ['1001', '1002', '1003', '1004', '1005', '1006', '1007'];
  const [selectedSku, setSelectedSku] = useState<string>(skuOptions[0]);

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
          const yearPrev =
            charge.prevPeriodFrom &&
            charge.prevPeriodFrom.length >= 4
              ? Number(charge.prevPeriodFrom.slice(0, 4))
              : NaN;
          if (Number.isFinite(yearPrev) && yearPrev > 0) {
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
            charge.nextPeriodFrom &&
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

  const sortedChargeRows = useMemo(
    () =>
      [...buildingChargeRows.rows].sort((a, b) =>
        chargeYearSort === 'asc' ? a.year - b.year : b.year - a.year,
      ),
    [buildingChargeRows.rows, chargeYearSort],
  );

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

  const [showRegulationSuccessDialog, setShowRegulationSuccessDialog] =
    useState(false);
  const [showCostChangesSuccessDialog, setShowCostChangesSuccessDialog] =
    useState(false);

  const handleRunRegulationFromInvoices = () => {
    setShowRegulationSuccessDialog(true);
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

  const handleAddChargeRow = () => {
    const newId = `pc-${Date.now()}`;
    const today = new Date();
    const year = today.getFullYear();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    setCharges((prev) => [
      ...prev,
      {
        id: newId,
        buildingId: building.id,
        label: '',
        periodType: 'year',
        prevPeriodFrom: '',
        prevPeriodTo: '',
        prevAmount: 0,
        nextPeriodFrom: start,
        nextPeriodTo: end,
        nextAmount: 0,
      },
    ]);
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
                <p>
                  Previous expenses:{' '}
                  <strong>
                    {run.totalPrevExpenses.toLocaleString('da-DK')} kr / year
                  </strong>
                </p>
                <p>
                  Next expenses:{' '}
                  <strong>
                    {run.totalNextExpenses.toLocaleString('da-DK')} kr / year
                  </strong>
                </p>
                <p>
                  Δ expenses:{' '}
                  <strong>
                    {recomputedRun.totalDelta.toLocaleString('da-DK')} kr / year
                  </strong>
                </p>
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
                      <th>Label</th>
                      <th>
                        <button
                          type="button"
                          className="table-sort"
                          onClick={() =>
                            setChargeYearSort((prev) =>
                              prev === 'asc' ? 'desc' : 'asc',
                            )
                          }
                        >
                          Year {chargeYearSort === 'asc' ? '↑' : '↓'}
                        </button>
                      </th>
                      <th>Amount / year</th>
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
                        >
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">{row.label}</span>
                            ) : (
                              <input
                                type="text"
                                className="inline-input"
                                value={row.label}
                                placeholder="e.g. Municipal property tax"
                                onChange={(e) =>
                                  setCharges((prev) =>
                                    prev.map((c) =>
                                      c.id === row.chargeId
                                        ? { ...c, label: e.target.value }
                                        : c,
                                    ),
                                  )
                                }
                              />
                            )}
                          </td>
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">{row.year}</span>
                            ) : (
                              <input
                                type="number"
                                className="inline-input"
                                value={row.year}
                                onChange={(e) => {
                                  const y =
                                    Number(e.target.value) ||
                                    new Date().getFullYear();
                                  const from = `${y}-01-01`;
                                  const to = `${y}-12-31`;
                                  setCharges((prev) =>
                                    prev.map((c) =>
                                      c.id === row.chargeId
                                        ? row.which === 'prev'
                                          ? {
                                              ...c,
                                              prevPeriodFrom: from,
                                              prevPeriodTo: to,
                                            }
                                          : {
                                              ...c,
                                              nextPeriodFrom: from,
                                              nextPeriodTo: to,
                                            }
                                        : c,
                                    ),
                                  );
                                }}
                              />
                            )}
                          </td>
                          <td>
                            {isHistorical ? (
                              <span className="historical-text">
                                {row.amount.toLocaleString('da-DK')} kr
                              </span>
                            ) : (
                              <>
                                <input
                                  type="number"
                                  className="inline-input"
                                  value={row.amount}
                                  onChange={(e) =>
                                    setCharges((prev) =>
                                      prev.map((c) =>
                                        c.id === row.chargeId
                                          ? row.which === 'prev'
                                            ? {
                                                ...c,
                                                prevAmount:
                                                  Number(e.target.value) || 0,
                                              }
                                            : {
                                                ...c,
                                                nextAmount:
                                                  Number(e.target.value) || 0,
                                              }
                                          : c,
                                      ),
                                    )
                                  }
                                />{' '}
                                kr
                              </>
                            )}
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
                                onChange={(e) => {
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
                            {!isHistorical && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setCharges((prev) =>
                                    prev.map((c) =>
                                      c.id === row.chargeId
                                        ? row.which === 'prev'
                                          ? {
                                              ...c,
                                              prevPeriodFrom: '',
                                              prevPeriodTo: '',
                                              prevAmount: 0,
                                            }
                                          : {
                                              ...c,
                                              nextPeriodFrom: '',
                                              nextPeriodTo: '',
                                              nextAmount: 0,
                                            }
                                        : c,
                                    ),
                                  )
                                }
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
                <button className="outline-btn" onClick={handleAddChargeRow}>
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
                      onChange={(e) => {
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
                <h3>SKU and Invoicing entity</h3>
                <p className="hint">
                  Identify invoicing lines that should be regulated by selecting
                  SKU and select invoicing entity to issue new regulated rent.
                </p>
                <div className="field">
                  <label>SKU</label>
                  <select
                    value={selectedSku}
                    onChange={(e) => setSelectedSku(e.target.value)}
                  >
                    {skuOptions.map((sku) => (
                      <option key={sku} value={sku}>
                        {sku}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Invoicing entity</label>
                  <select
                    value={selectedInvoicingEntity}
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

              <div className="panel" style={{ marginBottom: '0.75rem' }}>
                <h3>Included unit types</h3>
                {unitTypes.map((type) => (
                  <div key={type} className="field checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={includedTypes[type] ?? true}
                        onChange={(e) =>
                          setIncludedTypes((prev) => ({
                            ...prev,
                            [type]: e.target.checked,
                          }))
                        }
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
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <button
                className="primary-btn"
                onClick={() => setActiveTab('invoices')}
              >
                Calculate distribution per booking
              </button>
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
                  <th>Base rent</th>
                  <th>Public taxes & fees</th>
                  <th>New monthly rent</th>
                  <th>Applied from</th>
                  <th>% increase</th>
                  <th>Exclude from application</th>
                  <th>Retroactive amount</th>
                </tr>
              </thead>
              <tbody>
                {invoicePreviews.map((inv) => (
                  <tr key={inv.bookingId}>
                    <td>{inv.tenantName}</td>
                    <td>{inv.unitName}</td>
                    <td>
                      {(
                        units.find(
                          (u) =>
                            u.name === inv.unitName &&
                            u.buildingId === building.id,
                        )?.areaSqm ?? '–'
                      ).toString()}
                    </td>
                    <td>
                      {formatDate(
                        bookings.find((b) => b.id === inv.bookingId)?.startDate,
                      )}
                    </td>
                    <td>
                      {formatDate(
                        bookings.find((b) => b.id === inv.bookingId)?.endDate,
                      )}
                    </td>
                    <td>{inv.oldMonthlyRent.toLocaleString('da-DK')} kr</td>
                    <td>
                      {inv.monthlyAdjustment.toLocaleString('da-DK', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      kr
                    </td>
                    <td>
                      {inv.newMonthlyRent.toLocaleString('da-DK', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      kr
                    </td>
                    <td>
                      {bookingSettings.find(
                        (s) =>
                          s.bookingId === inv.bookingId &&
                          s.regulationRunId === run.id,
                      )?.excludeFromApplication
                        ? '–'
                        : formatDate(run.adjustmentStartDate)}
                    </td>
                    <td>
                      {inv.oldMonthlyRent > 0
                        ? `${(
                            ((inv.newMonthlyRent - inv.oldMonthlyRent) /
                              inv.oldMonthlyRent) *
                            100
                          ).toFixed(1)}%`
                        : '0.0%'}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={
                          bookingSettings.find(
                            (s) =>
                              s.bookingId === inv.bookingId &&
                              s.regulationRunId === run.id,
                          )?.excludeFromApplication ?? false
                        }
                        onChange={(e) =>
                          setBookingSettings((prev) =>
                            prev.map((s) =>
                              s.bookingId === inv.bookingId &&
                              s.regulationRunId === run.id
                                ? {
                                    ...s,
                                    excludeFromApplication: e.target.checked,
                                  }
                                : s,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      {inv.retroactiveAmount > 0
                        ? `${inv.retroactiveAmount.toFixed(0)} kr`
                        : '0 kr'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="panel" style={{ marginTop: '1rem' }}>
              <div className="field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={autoApproveInvoices}
                    onChange={(e) => setAutoApproveInvoices(e.target.checked)}
                  />
                  Automatically approve new invoicing lines
                </label>
              </div>
              <button
                className="primary-btn"
                onClick={handleRunRegulationFromInvoices}
              >
                Run rent regulation
              </button>
            </div>
          </section>
        )}

        {showRegulationSuccessDialog && (
          <div className="dialog-backdrop">
            <div className="dialog">
              <h3>Rent regulation completed</h3>
              <p>
                Rent regulation has been successfully applied and new invoicing
                lines have been created.
              </p>
              <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                <button
                  className="primary-btn"
                  onClick={() => {
                    setShowRegulationSuccessDialog(false);
                    setActiveTab('notifications');
                  }}
                >
                  Next: Review tenant notification
                </button>
              </div>
            </div>
          </div>
        )}

        {showCostChangesSuccessDialog && (
          <div className="dialog-backdrop">
            <div className="dialog">
              <h3>Cost changes applied</h3>
              <p>Rent cost changes have been successfully applied.</p>
              <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                <button
                  className="primary-btn"
                  onClick={() => setShowCostChangesSuccessDialog(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
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
            <button className="primary-btn" onClick={() => setActiveTab('templates')}>
              Next: Review cost adjustments
            </button>
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
              className="primary-btn"
              onClick={() => setShowCostChangesSuccessDialog(true)}
            >
              Apply rent cost changes
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
