import type { ReducedTrialRow } from "psyflow-web";

import { COND_GAIN, COND_LOSS, COND_MIXED } from "./controller";

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "y";
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value01: number): string {
  return `${(value01 * 100).toFixed(1)}%`;
}

function summarizeRows(rows: ReducedTrialRow[]): {
  gamble_rate: string;
  mean_rt_ms: string;
  timeout_count: number;
  total_trials: number;
} {
  if (rows.length === 0) {
    return {
      gamble_rate: "0.0%",
      mean_rt_ms: "0",
      timeout_count: 0,
      total_trials: 0
    };
  }
  const timeoutCount = rows.filter((row) => asBool(row.timed_out)).length;
  const responded = rows.filter((row) => !asBool(row.timed_out));
  const gambleCount = responded.filter((row) => asBool(row.chose_gamble)).length;
  const gambleRate = responded.length > 0 ? formatPercent(gambleCount / responded.length) : "0.0%";
  const rtValues = responded
    .map((row) => asNumber(row.rt_s))
    .filter((value): value is number => value != null);
  const meanRtMs = Math.round(mean(rtValues) * 1000).toString();
  return {
    gamble_rate: gambleRate,
    mean_rt_ms: meanRtMs,
    timeout_count: timeoutCount,
    total_trials: rows.length
  };
}

export function summarizeBlock(rows: ReducedTrialRow[], blockId: string): {
  gamble_rate: string;
  mean_rt_ms: string;
  timeout_count: number;
  total_trials: number;
} {
  const blockRows = rows.filter((row) => String(row.block_id ?? "") === blockId);
  return summarizeRows(blockRows);
}

export function summarizeOverall(rows: ReducedTrialRow[]): {
  gamble_rate: string;
  mean_rt_ms: string;
  timeout_count: number;
  total_trials: number;
} {
  return summarizeRows(rows);
}

function conditionRate(rows: ReducedTrialRow[], condition: string): string {
  const condRows = rows.filter(
    (row) => String(row.condition ?? "") === condition && !asBool(row.timed_out)
  );
  if (condRows.length === 0) {
    return "0.0%";
  }
  const gambleCount = condRows.filter((row) => asBool(row.chose_gamble)).length;
  return formatPercent(gambleCount / condRows.length);
}

export function summarizeConditionRates(rows: ReducedTrialRow[]): {
  gain_rate: string;
  loss_rate: string;
  mixed_rate: string;
} {
  return {
    gain_rate: conditionRate(rows, COND_GAIN),
    loss_rate: conditionRate(rows, COND_LOSS),
    mixed_rate: conditionRate(rows, COND_MIXED)
  };
}

