import type { ExerciseType, ProgramExercise } from '#lib/programs.js';

export type RepPhase = 'rest' | 'raise' | 'hold' | 'lower';

export interface RepProfile {
	exercise: ExerciseType;
	restEnter: number;
	restExit: number;
	topEnter: number;
	topExit: number;
	holdMs: number;
	restDwellMs: number;
	configurationError: string | null;
}

export function createRepProfile(
	exercise: Pick<ProgramExercise, 'exercise_type' | 'target_angle' | 'hold_seconds'>
): RepProfile {
	const legRaise = exercise.exercise_type === 'straight_leg_raise';
	const anklePumps = exercise.exercise_type === 'seated_ankle_pumps';
	const restEnter = anklePumps
		? Math.min(5, exercise.target_angle * 0.2)
		: legRaise
			? Math.min(10, exercise.target_angle * 0.2)
			: Math.min(100, exercise.target_angle - 20);
	const restExit = restEnter + (anklePumps ? 4 : legRaise ? 5 : 8);
	const topEnter = exercise.target_angle - 3;
	const topExit = exercise.target_angle - (anklePumps ? 7 : 8);
	return {
		exercise: exercise.exercise_type,
		restEnter,
		restExit,
		topEnter,
		topExit,
		holdMs: Math.max(200, exercise.hold_seconds * 1000),
		restDwellMs: 250,
		configurationError: topExit <= restExit
			? 'The movement target does not leave a reliable rep range.'
			: null
	};
}
