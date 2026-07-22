export interface WindowStats {
  current: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  slope: number;
}

// `values` spans the lookback window in chronological order, most recent last.
// Slope is an ordinary-least-squares fit against the minute index within the
// window (robust to noise at a single endpoint, unlike a plain two-point diff).
export const computeWindowStats = (values: number[]): WindowStats => {
  const n = values.length;
  const current = values[n - 1];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const xbar = (n - 1) / 2;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - xbar) * (v - mean);
    den += (i - xbar) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;

  return { current, mean, std, min, max, slope };
};
