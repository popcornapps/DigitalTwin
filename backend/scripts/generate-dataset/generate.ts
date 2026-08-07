import { hashString, SeededRandom, MeanRevertingWalk } from './rng.ts';
import { buildPhaseBoundaries, isAgitatorRunning, isDryerRunning } from './phases.ts';
import { agitatorBaseline, processPressureBaseline, flowRateBaseline, temperatureBaseline } from './baseline.ts';
import { resolveFault, resolveCorrelatedFault, applyFault, applyCorrelatedFault } from './deviations.ts';
import { BATCH_ANCHOR_DATE, MINUTES_BETWEEN_BATCH_STARTS } from './config.ts';
import type { BatchPlanEntry, BatchRecord, PhaseBoundaries, TimeseriesRow } from './types.ts';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

const extendForCorrelatedFault = (
  b: PhaseBoundaries,
  durationExtensionMinutes: number,
  restrictionEnd: number,
): PhaseBoundaries => {
  if (durationExtensionMinutes === 0) return b;
  const coolingDuration = b.coolingEnd - b.dryingEnd;
  return { ...b, dryingEnd: restrictionEnd, coolingEnd: restrictionEnd + coolingDuration };
};

export const generateBatch = (
  plan: BatchPlanEntry,
  batchIndex: number,
): { batch: BatchRecord; rows: TimeseriesRow[] } => {
  const rng = new SeededRandom(hashString(plan.batchId));
  const nominalBoundaries = buildPhaseBoundaries(rng);

  const isCorrelated = plan.scenario === 'Correlated_DryerRestriction';
  const correlatedFault = isCorrelated ? resolveCorrelatedFault(plan.severity, nominalBoundaries, rng) : null;
  const singleFault =
    !isCorrelated && plan.scenario !== 'None' ? resolveFault(plan.scenario, plan.severity, nominalBoundaries, rng) : null;

  const boundaries = correlatedFault
    ? extendForCorrelatedFault(nominalBoundaries, correlatedFault.durationExtensionMinutes, correlatedFault.restrictionEnd)
    : nominalBoundaries;

  // Golden batches carry almost no injected noise, so they read as a clean reference trajectory.
  const noiseFactor = plan.isGoldenBatch ? 0.15 : 1.0;

  const tempWalk = new MeanRevertingWalk(rng, temperatureBaseline(0, boundaries, 0), 0.15, 0.28 * noiseFactor);
  const rpmWalk = new MeanRevertingWalk(rng, agitatorBaseline(0, boundaries), 0.3, 0.15 * noiseFactor);
  const pressureWalk = new MeanRevertingWalk(rng, processPressureBaseline(0, boundaries), 0.2, 0.01 * noiseFactor);
  const flowWalk = new MeanRevertingWalk(rng, flowRateBaseline(0, boundaries), 0.2, 0.4 * noiseFactor);
  const fanNoise = new MeanRevertingWalk(rng, 0, 0.3, 1.0 * noiseFactor);

  const rows: TimeseriesRow[] = [];

  for (let t = 0; t <= boundaries.coolingEnd; t++) {
    const rpmBaseline = agitatorBaseline(t, boundaries);
    const tempBaseline = temperatureBaseline(t, boundaries, rpmBaseline);
    const pressureBaseline = processPressureBaseline(t, boundaries);
    const flowBaseline = flowRateBaseline(t, boundaries);

    const fault = applyFault(singleFault, t, boundaries);
    const correlated = applyCorrelatedFault(correlatedFault, t);

    const dryerActive = isDryerRunning(t, boundaries);
    const agitatorActive = isAgitatorRunning(t, boundaries);
    const fanScale = dryerActive ? 1 : 0.05;
    const fan = fanNoise.step(0, fanScale);

    const tempTarget = tempBaseline + (fault.offset.temperature ?? 0);
    const rpmTarget = rpmBaseline + (fault.offset.agitator_rpm ?? 0);
    const pressureTarget = pressureBaseline + fan * 0.02 + (fault.offset.process_pressure ?? 0) + correlated.processPressureOffset;
    const flowTarget = flowBaseline + fan * 0.8 + (fault.offset.flow_rate ?? 0) + correlated.flowRateOffset;

    const tempOut = fault.lockValue.temperature ?? tempWalk.step(tempTarget, 1 * (fault.noiseMultiplier.temperature ?? 1));
    const rpmOut =
      fault.lockValue.agitator_rpm ?? rpmWalk.step(rpmTarget, (agitatorActive ? 1 : 0.05) * (fault.noiseMultiplier.agitator_rpm ?? 1));
    const pressureOut =
      fault.lockValue.process_pressure ??
      pressureWalk.step(pressureTarget, (dryerActive ? 1 : 0.05) * (fault.noiseMultiplier.process_pressure ?? 1));
    const flowOut =
      fault.lockValue.flow_rate ?? flowWalk.step(flowTarget, (dryerActive ? 1 : 0.05) * (fault.noiseMultiplier.flow_rate ?? 1));

    rows.push({
      batch_id: plan.batchId,
      elapsed_minutes: t,
      temperature: round(clamp(tempOut, 15, 90), 1),
      process_pressure: round(clamp(pressureOut, 0.3, 2.0), 2),
      flow_rate: round(clamp(flowOut, 0, 70), 1),
      agitator_rpm: Math.round(clamp(rpmOut, 0, 30)),
    });
  }

  const startDate = new Date(BATCH_ANCHOR_DATE.getTime() + batchIndex * MINUTES_BETWEEN_BATCH_STARTS * 60_000);

  const batch: BatchRecord = {
    batch_id: plan.batchId,
    plant: plan.plant,
    is_golden_batch: plan.isGoldenBatch,
    batch_start_datetime: startDate.toISOString(),
    batch_duration_minutes: boundaries.coolingEnd,
    deviation_scenario: plan.scenario,
    deviation_severity: plan.severity,
  };

  return { batch, rows };
};

export const generateDataset = (plan: BatchPlanEntry[]): { batches: BatchRecord[]; rows: TimeseriesRow[] } => {
  const batches: BatchRecord[] = [];
  const rows: TimeseriesRow[] = [];

  plan.forEach((entry, index) => {
    const { batch, rows: batchRows } = generateBatch(entry, index);
    batches.push(batch);
    rows.push(...batchRows);
  });

  return { batches, rows };
};
