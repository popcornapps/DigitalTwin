import { SeededRandom, hashString } from '../generate-dataset/rng.ts';
import type { BatchMeta, SplitName } from './types.ts';

type Tier = 'golden' | 'normal' | 'warning' | 'critical';

const classifyTier = (meta: BatchMeta): Tier => {
  if (meta.is_golden_batch) return 'golden';
  if (meta.deviation_severity === 'Critical') return 'critical';
  if (meta.deviation_severity === 'Warning') return 'warning';
  return 'normal';
};

const shuffledDeterministic = (ids: string[], seed: string): string[] => {
  const rng = new SeededRandom(hashString(seed));
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng.uniform(0, i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Batch-level, tier-stratified split. Golden always goes to train (there's
// only one, and it exists as a clean reference trajectory, not a case to
// evaluate deviation-detection against). Normal/Warning/Critical are each
// split ~70/15/15 independently so every split has a realistic severity mix.
export const assignSplits = (batchMeta: Map<string, BatchMeta>): Map<string, SplitName> => {
  const groups: Record<Tier, string[]> = { golden: [], normal: [], warning: [], critical: [] };
  for (const meta of batchMeta.values()) {
    groups[classifyTier(meta)].push(meta.batch_id);
  }

  const assignment = new Map<string, SplitName>();
  groups.golden.forEach((id) => assignment.set(id, 'train'));

  (['normal', 'warning', 'critical'] as const).forEach((tier) => {
    const ids = shuffledDeterministic(groups[tier], `split-${tier}`);
    const trainCount = Math.round(ids.length * 0.7);
    const valCount = Math.round(ids.length * 0.15);

    ids.forEach((id, idx) => {
      if (idx < trainCount) assignment.set(id, 'train');
      else if (idx < trainCount + valCount) assignment.set(id, 'val');
      else assignment.set(id, 'test');
    });
  });

  return assignment;
};

export const summarizeSplitsByTier = (
  batchMeta: Map<string, BatchMeta>,
  assignment: Map<string, SplitName>,
): Record<Tier, Record<SplitName, number>> => {
  const summary: Record<Tier, Record<SplitName, number>> = {
    golden: { train: 0, val: 0, test: 0 },
    normal: { train: 0, val: 0, test: 0 },
    warning: { train: 0, val: 0, test: 0 },
    critical: { train: 0, val: 0, test: 0 },
  };
  for (const meta of batchMeta.values()) {
    const tier = classifyTier(meta);
    const split = assignment.get(meta.batch_id);
    if (split) summary[tier][split] += 1;
  }
  return summary;
};
