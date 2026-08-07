import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCsv } from '../shared/csv.ts';
import { loadBatchMeta, buildFeatureRows } from './buildFeatures.ts';
import { assignSplits, summarizeSplitsByTier } from './splitPlan.ts';
import { PARAM_KEYS, LOOKBACK_MINUTES, HORIZON_MINUTES } from './types.ts';
import type { FeatureRow } from './types.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

const batchMeta = loadBatchMeta(join(dataDir, 'paracetamol_batches.csv'));
const rows = buildFeatureRows(join(dataDir, 'paracetamol_batch_timeseries.csv'), batchMeta);

const splitAssignment = assignSplits(batchMeta);
rows.forEach((row) => {
  row.split = splitAssignment.get(row.batch_id as string) ?? 'train';
});

const featureColumns: (keyof FeatureRow)[] = ['elapsed_minutes'];
PARAM_KEYS.forEach((p) => {
  featureColumns.push(`${p}_current`, `${p}_mean_30`, `${p}_std_30`, `${p}_min_30`, `${p}_max_30`, `${p}_slope_30`);
});
const targetColumns: (keyof FeatureRow)[] = PARAM_KEYS.map((p) => `${p}_target_30min`);
const metaColumns: (keyof FeatureRow)[] = ['batch_id', 'deviation_scenario', 'deviation_severity', 'split'];

const allColumns = [...metaColumns, ...featureColumns, ...targetColumns];

writeCsv(join(dataDir, 'paracetamol_training_dataset.csv'), rows, allColumns);

const rowsBySplit = rows.reduce<Record<string, number>>((acc, r) => {
  const key = r.split as string;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(`Lookback window: ${LOOKBACK_MINUTES} min (${LOOKBACK_MINUTES + 1} points incl. current) | Horizon: ${HORIZON_MINUTES} min ahead\n`);
console.log(`Feature columns (${featureColumns.length}): ${featureColumns.join(', ')}\n`);
console.log(`Target columns (${targetColumns.length}): ${targetColumns.join(', ')}\n`);
console.log(`Total training samples (rows): ${rows.length}\n`);
console.log('Samples per split:');
for (const [split, count] of Object.entries(rowsBySplit)) {
  console.log(`  ${split.padEnd(6)} ${count}  (${((count / rows.length) * 100).toFixed(1)}%)`);
}

console.log('\nBatches per split, by severity tier:');
const tierSummary = summarizeSplitsByTier(batchMeta, splitAssignment);
for (const [tier, counts] of Object.entries(tierSummary)) {
  console.log(`  ${tier.padEnd(9)} train=${counts.train}  val=${counts.val}  test=${counts.test}`);
}

console.log(`\nWrote ${rows.length} rows to ${join(dataDir, 'paracetamol_training_dataset.csv')}`);
