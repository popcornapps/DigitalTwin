import { readCsv } from '../shared/csv.ts';
import { computeWindowStats } from './rollingStats.ts';
import { PARAM_KEYS, LOOKBACK_MINUTES, HORIZON_MINUTES } from './types.ts';
import type { BatchMeta, FeatureRow } from './types.ts';

const round = (v: number, decimals = 4): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

export const loadBatchMeta = (batchesPath: string): Map<string, BatchMeta> => {
  const batchRows = readCsv(batchesPath);
  const meta = new Map<string, BatchMeta>();
  batchRows.forEach((b) => {
    meta.set(b.batch_id, {
      batch_id: b.batch_id,
      is_golden_batch: b.is_golden_batch === 'true',
      batch_duration_minutes: Number(b.batch_duration_minutes),
      deviation_scenario: b.deviation_scenario,
      deviation_severity: b.deviation_severity,
    });
  });
  return meta;
};

interface SeriesPoint {
  elapsed_minutes: number;
  values: Record<(typeof PARAM_KEYS)[number], number>;
}

const loadSeriesByBatch = (timeseriesPath: string): Map<string, SeriesPoint[]> => {
  const tsRows = readCsv(timeseriesPath);
  const byBatch = new Map<string, SeriesPoint[]>();

  tsRows.forEach((r) => {
    const arr = byBatch.get(r.batch_id) ?? [];
    arr.push({
      elapsed_minutes: Number(r.elapsed_minutes),
      values: {
        temperature: Number(r.temperature),
        process_pressure: Number(r.process_pressure),
        flow_rate: Number(r.flow_rate),
        agitator_rpm: Number(r.agitator_rpm),
      },
    });
    byBatch.set(r.batch_id, arr);
  });

  for (const series of byBatch.values()) {
    series.sort((a, b) => a.elapsed_minutes - b.elapsed_minutes);
  }

  return byBatch;
};

export const buildFeatureRows = (
  timeseriesPath: string,
  batchMeta: Map<string, BatchMeta>,
): FeatureRow[] => {
  const seriesByBatch = loadSeriesByBatch(timeseriesPath);
  const rows: FeatureRow[] = [];

  for (const [batchId, series] of seriesByBatch) {
    const meta = batchMeta.get(batchId);
    if (!meta) continue;

    for (let t = LOOKBACK_MINUTES; t + HORIZON_MINUTES <= meta.batch_duration_minutes; t++) {
      const window = series.slice(t - LOOKBACK_MINUTES, t + 1);
      const targetPoint = series[t + HORIZON_MINUTES];
      if (window.length !== LOOKBACK_MINUTES + 1 || !targetPoint) continue;

      const row: FeatureRow = {
        batch_id: batchId,
        elapsed_minutes: t,
        deviation_scenario: meta.deviation_scenario,
        deviation_severity: meta.deviation_severity,
      };

      for (const param of PARAM_KEYS) {
        const stats = computeWindowStats(window.map((w) => w.values[param]));
        row[`${param}_current`] = round(stats.current);
        row[`${param}_mean_30`] = round(stats.mean);
        row[`${param}_std_30`] = round(stats.std);
        row[`${param}_min_30`] = round(stats.min);
        row[`${param}_max_30`] = round(stats.max);
        row[`${param}_slope_30`] = round(stats.slope);
        row[`${param}_target_30min`] = round(targetPoint.values[param]);
      }

      rows.push(row);
    }
  }

  return rows;
};
