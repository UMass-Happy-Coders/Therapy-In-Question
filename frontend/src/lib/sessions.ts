import type { RepMeasurement } from '#lib/pose/rep-counter.js';
import { isProgramDetail, type ProgramDetail, type ProgramExercise } from '#lib/programs.js';

export interface SetMeasurement {
	reps_completed: number;
	elapsed_seconds: number;
}

export interface SetResult extends SetMeasurement {
	rep_metrics: RepMeasurement[];
}

export interface SessionSet extends SetMeasurement {
	ordinal: number;
	exercise_id: string;
	set_number: number;
	pain: number;
	difficulty: number;
	comfort: number;
	notes: string;
	recorded_at: string;
}

export interface PatientSession {
	id: string;
	assignment_id: string;
	session_date: string;
	status: 'in_progress' | 'completed';
	started_at: string;
	completed_at: string | null;
	program: ProgramDetail;
	sets: SessionSet[];
}

export interface SessionStep {
	exercise: ProgramExercise;
	set_number: number;
}

export function sessionSteps(program: ProgramDetail): SessionStep[] {
	return program.exercises.flatMap((exercise) =>
		Array.from({ length: exercise.sets }, (_, index) => ({ exercise, set_number: index + 1 }))
	);
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isSessionSet(value: unknown): value is SessionSet {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as SessionSet;
	return boundedInteger(entry.ordinal, 0, 119) &&
		typeof entry.exercise_id === 'string' && boundedInteger(entry.set_number, 1, 10) &&
		boundedInteger(entry.reps_completed, 0, 1000) &&
		typeof entry.elapsed_seconds === 'number' && Number.isFinite(entry.elapsed_seconds) &&
		entry.elapsed_seconds >= 0 && entry.elapsed_seconds <= 86400 &&
		boundedInteger(entry.pain, 0, 10) && boundedInteger(entry.difficulty, 0, 10) &&
		boundedInteger(entry.comfort, 0, 10) && typeof entry.notes === 'string' &&
		typeof entry.recorded_at === 'string';
}

export function isPatientSession(value: unknown): value is PatientSession {
	if (typeof value !== 'object' || value === null) return false;
	const session = value as PatientSession;
	if (typeof session.id !== 'string' || typeof session.assignment_id !== 'string' ||
		typeof session.session_date !== 'string' || typeof session.started_at !== 'string' ||
		!isProgramDetail(session.program) || session.program.exercises.length === 0 ||
		!session.program.exercises.every((exercise) => boundedInteger(exercise.sets, 1, 10) && boundedInteger(exercise.reps, 1, 100)) ||
		!Array.isArray(session.sets) || !session.sets.every(isSessionSet)) return false;
	const plan = sessionSteps(session.program);
	return session.sets.length <= plan.length &&
		session.sets.every((entry, index) => entry.ordinal === index &&
			entry.exercise_id === plan[index].exercise.id && entry.set_number === plan[index].set_number) &&
		(session.status === 'completed'
			? session.sets.length === plan.length && typeof session.completed_at === 'string'
			: session.status === 'in_progress' && session.sets.length < plan.length && session.completed_at === null);
}
