import type { RepMeasurement } from '#lib/pose/rep-counter.js';

export interface SavedRep extends RepMeasurement {
	set_ordinal: number;
	range_of_motion: number;
	target_angle: number;
}

export interface MovementTotals {
	exercise_type: string;
	name: string;
	reps: number;
	avg_range_of_motion: number;
	max_range_of_motion: number;
	avg_duration_ms: number;
}

export interface AdherenceTotals {
	sets_logged: number;
	reps_completed: number;
	reps_prescribed: number;
	active_seconds: number;
}

export interface PeriodTotals {
	movement: MovementTotals[];
	adherence: AdherenceTotals | null;
}

export interface SessionMetrics {
	reps: SavedRep[];
	day: PeriodTotals;
	week: PeriodTotals;
}

function finite(...values: unknown[]): boolean {
	return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

function isPeriodTotals(value: unknown): value is PeriodTotals {
	if (typeof value !== 'object' || value === null) return false;
	const totals = value as PeriodTotals;
	return Array.isArray(totals.movement) &&
		totals.movement.every((entry) => typeof entry === 'object' && entry !== null &&
			typeof entry.exercise_type === 'string' && typeof entry.name === 'string' &&
			finite(entry.reps, entry.avg_range_of_motion, entry.max_range_of_motion, entry.avg_duration_ms)) &&
		(totals.adherence === null || (typeof totals.adherence === 'object' &&
			finite(totals.adherence.sets_logged, totals.adherence.reps_completed,
				totals.adherence.reps_prescribed, totals.adherence.active_seconds)));
}

export function isSessionMetrics(value: unknown): value is SessionMetrics {
	if (typeof value !== 'object' || value === null) return false;
	const metrics = value as SessionMetrics;
	return Array.isArray(metrics.reps) &&
		metrics.reps.every((entry) => typeof entry === 'object' && entry !== null &&
			finite(entry.set_ordinal, entry.rep_number, entry.start_angle, entry.peak_angle,
				entry.range_of_motion, entry.target_angle, entry.duration_ms, entry.hold_ms)) &&
		isPeriodTotals(metrics.day) && isPeriodTotals(metrics.week);
}
