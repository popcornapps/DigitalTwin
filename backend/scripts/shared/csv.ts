import { readFileSync, writeFileSync } from 'node:fs';

export const readCsv = (path: string): Record<string, string>[] => {
  const text = readFileSync(path, 'utf-8').trim();
  const [headerLine, ...lines] = text.split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i];
    });
    return row;
  });
};

export const writeCsv = <T extends object>(path: string, rows: T[], columns: (keyof T)[]): void => {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => String(row[col])).join(',')).join('\n');
  writeFileSync(path, `${header}\n${body}\n`);
};
