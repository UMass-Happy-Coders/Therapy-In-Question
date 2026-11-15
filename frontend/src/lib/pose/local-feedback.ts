import type { ProgramExercise } from '#lib/programs.js';
import type { RepPhase } from '#lib/pose/rep-profile.js';

export function movementCue(
	exercise: ProgramExercise,
	state: 'setup' | 'running' | 'paused' | 'finished',
	phase: RepPhase,
	reps: number,
	holdElapsedMs: number,
	correction: string | null
): string {
	if (state === 'setup') return 'Frame your body, then start the exercise.';
	if (state === 'finished') return 'Set finished.';
	if (state === 'paused') return correction ? `Paused: ${correction}.` : 'Exercise paused. Resume when you are ready.';
	if (correction === 'Knee bent') return 'Keep your knee straight for this rep.';
	if (correction === 'Return to rest' || correction === 'Return to seated rest') return 'Return to your starting position before the next rep.';
	if (correction === 'Raise hips') return 'Raise your hips toward your standing position.';
	if (correction === 'Stand fully') return 'Complete the standing position before returning.';
	if (correction) return `${correction}.`;
	if (reps >= exercise.reps) return 'Set target reached. End the set when you are ready.';
	if (phase === 'rest') return 'Start your next rep when you are ready.';
	if (phase === 'hold' && holdElapsedMs < exercise.hold_seconds * 1000) return `Hold for ${exercise.hold_seconds} seconds at your target.`;
	if (phase === 'hold' || phase === 'lower') return 'Return to your starting position.';
	if (exercise.exercise_type === 'seated_knee_extension') return `Extend your knee toward ${exercise.target_angle} degrees.`;
	if (exercise.exercise_type === 'straight_leg_raise') return `Raise your leg toward ${exercise.target_angle} degrees of hip flexion.`;
	return `Stand toward your ${exercise.target_angle}-degree knee target.`;
}
