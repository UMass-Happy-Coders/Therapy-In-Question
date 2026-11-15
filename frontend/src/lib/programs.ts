export type ExerciseType = 'seated_knee_extension' | 'straight_leg_raise' | 'sit_to_stand' | 'seated_ankle_pumps' | 'seated_index_finger_bends';

export interface ExerciseDefinition {
	id: ExerciseType;
	name: string;
	description: string;
	target_label: string;
	target_min: number;
	target_max: number;
	target_default: number;
}

export interface ProgramExercise {
	id: string;
	position: number;
	exercise_type: ExerciseType;
	name: string;
	target_label: string;
	sets: number;
	reps: number;
	target_angle: number;
	hold_seconds: number;
}

export interface ProgramDetail {
	id: string;
	name: string;
	notes: string;
	created_at: string;
	created_by_name: string;
	exercises: ProgramExercise[];
}

export interface Program extends ProgramDetail {
	assignments: {
		id: string;
		patient_id: string;
		patient_name: string;
		assigned_at: string;
	}[];
}

export interface AssignedProgram {
	id: string;
	assigned_at: string;
	therapist_name: string;
	program: ProgramDetail;
}

function hasStrings(...values: unknown[]): boolean {
	return values.every((value) => typeof value === 'string');
}

function isExerciseType(value: unknown): value is ExerciseType {
	return value === 'seated_knee_extension' || value === 'straight_leg_raise' || value === 'sit_to_stand' || value === 'seated_ankle_pumps' || value === 'seated_index_finger_bends';
}

export function isExerciseDefinition(value: unknown): value is ExerciseDefinition {
	if (typeof value !== 'object' || value === null) return false;
	const exercise = value as ExerciseDefinition;
	return (
		isExerciseType(exercise.id) &&
		hasStrings(exercise.name, exercise.description, exercise.target_label) &&
		[exercise.target_min, exercise.target_max, exercise.target_default].every(
			(number) => typeof number === 'number' && Number.isFinite(number)
		)
	);
}

function isProgramExercise(value: unknown): value is ProgramExercise {
	if (typeof value !== 'object' || value === null) return false;
	const exercise = value as ProgramExercise;
	return (
		isExerciseType(exercise.exercise_type) &&
		hasStrings(exercise.id, exercise.name, exercise.target_label) &&
		[exercise.position, exercise.sets, exercise.reps, exercise.target_angle, exercise.hold_seconds].every(
			(number) => typeof number === 'number' && Number.isFinite(number)
		)
	);
}

export function isProgramDetail(value: unknown): value is ProgramDetail {
	if (typeof value !== 'object' || value === null) return false;
	const program = value as ProgramDetail;
	return (
		hasStrings(program.id, program.name, program.notes, program.created_at, program.created_by_name) &&
		Array.isArray(program.exercises) &&
		program.exercises.every(isProgramExercise)
	);
}

export function isProgram(value: unknown): value is Program {
	return (
		isProgramDetail(value) &&
		'assignments' in value &&
		Array.isArray(value.assignments) &&
		value.assignments.every((assignment: unknown) => {
			if (typeof assignment !== 'object' || assignment === null) return false;
			const entry = assignment as Program['assignments'][number];
			return hasStrings(entry.id, entry.patient_id, entry.patient_name, entry.assigned_at);
		})
	);
}

export function isAssignedProgram(value: unknown): value is AssignedProgram {
	if (typeof value !== 'object' || value === null) return false;
	const assignment = value as AssignedProgram;
	return (
		hasStrings(assignment.id, assignment.assigned_at, assignment.therapist_name) &&
		isProgramDetail(assignment.program)
	);
}
