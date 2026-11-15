import type { ProgramExercise } from '#lib/programs.js';

export interface TutorialStep {
	title: string;
	instruction: string;
	pose: 'start' | 'target' | 'return';
}

export interface ExerciseWalkthrough {
	steps: readonly TutorialStep[];
	camera: string;
}

export function exerciseWalkthrough(
	exercise: Pick<ProgramExercise, 'exercise_type' | 'target_angle' | 'hold_seconds'>
): ExerciseWalkthrough {
	const hold = exercise.hold_seconds > 0
		? ` Hold for ${exercise.hold_seconds} ${exercise.hold_seconds === 1 ? 'second' : 'seconds'}.`
		: '';
	const camera = 'Place the camera to your side. Keep your full body, including your head and torso, visible throughout the movement. Keep the leg you are exercising clear of furniture and the other leg.';

	switch (exercise.exercise_type) {
		case 'seated_knee_extension':
			return {
				steps: [
					{ title: 'Sit with your knee bent', instruction: 'Sit upright on a stable chair with your foot resting on the floor.', pose: 'start' },
					{ title: 'Straighten your knee', instruction: `Keep your thigh on the chair and lift your lower leg toward your assigned knee angle of ${exercise.target_angle} degrees.${hold}`, pose: 'target' },
					{ title: 'Lower with control', instruction: 'Bend your knee and return your foot to the starting position before the next repetition.', pose: 'return' }
				],
				camera
			};
		case 'straight_leg_raise':
			return {
				steps: [
					{ title: 'Lie with your leg straight', instruction: 'Lie on your back with the leg you are exercising straight and resting on the supporting surface.', pose: 'start' },
					{ title: 'Raise your straight leg', instruction: `Keep your knee straight as you raise your leg toward your assigned hip angle of ${exercise.target_angle} degrees.${hold}`, pose: 'target' },
					{ title: 'Lower with control', instruction: 'Keep your knee straight and lower your leg back to the supporting surface before the next repetition.', pose: 'return' }
				],
				camera
			};
		case 'sit_to_stand':
			return {
				steps: [
					{ title: 'Sit with both feet supported', instruction: 'Sit on a stable chair with both feet on the floor. Follow your therapist\'s instructions for hand support.', pose: 'start' },
					{ title: 'Rise from the chair', instruction: `Rise toward standing and your assigned knee angle of ${exercise.target_angle} degrees.${hold}`, pose: 'target' },
					{ title: 'Return to sitting', instruction: 'Bend your hips and knees to sit down with control before the next repetition.', pose: 'return' }
				],
				camera
			};
		case 'seated_ankle_pumps':
			return {
				steps: [
					{ title: 'Support your leg', instruction: 'Sit with your leg supported and your foot free to move. Start with your ankle relaxed and your toes pointing up.', pose: 'start' },
					{ title: 'Point your toes away', instruction: `Keep your leg still and point your toes away toward your assigned ankle plantar flexion of ${exercise.target_angle} degrees.${hold}`, pose: 'target' },
					{ title: 'Return your foot', instruction: 'Bring your foot back to the starting position before the next repetition. Keep your leg supported.', pose: 'return' }
				],
				camera: `${camera} Keep the whole foot, including your heel and toes, visible beyond the leg support.`
			};
	}
}
