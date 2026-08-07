import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBatchPlan } from './batchPlan.ts';
import { generateDataset } from './generate.ts';
import { PARAMETER_CONFIG } from './config.ts';

const toCsv = <T extends object>(rows: T[], columns: (keyof T)[]): string => {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => String(row[col])).join(',')).join('\n');
  return `${header}\n${body}\n`;
};

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
mkdirSync(dataDir, { recursive: true });

const plan = buildBatchPlan();
const { batches, rows } = generateDataset(plan);

writeFileSync(
  join(dataDir, 'paracetamol_batches.csv'),
  toCsv(batches, [
    'batch_id',
    'plant',
    'is_golden_batch',
    'batch_start_datetime',
    'batch_duration_minutes',
    'deviation_scenario',
    'deviation_severity',
  ]),
);

writeFileSync(
  join(dataDir, 'paracetamol_batch_timeseries.csv'),
  toCsv(rows, ['batch_id', 'elapsed_minutes', 'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm']),
);

writeFileSync(
  join(dataDir, 'paracetamol_parameter_config.csv'),
  toCsv(PARAMETER_CONFIG, ['parameter', 'unit', 'golden_target', 'lower_limit', 'upper_limit']),
);

const bucketCounts = batches.reduce<Record<string, number>>((acc, b) => {
  const key = b.is_golden_batch ? 'Golden' : `${b.deviation_scenario} / ${b.deviation_severity}`;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(`Generated ${batches.length} batches, ${rows.length} timeseries rows.\n`);
console.log('Bucket breakdown:');
for (const [key, count] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(3)}  ${key}`);
}

const durations = batches.map((b) => b.batch_duration_minutes);
const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
console.log(`\nBatch duration: min=${Math.min(...durations)} max=${Math.max(...durations)} avg=${avgDuration.toFixed(1)} minutes`);
console.log(`\nWrote CSVs to ${dataDir}`);
