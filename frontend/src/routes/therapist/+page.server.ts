import { error, redirect } from '@sveltejs/kit';
import { isPatient } from '#lib/auth.js';
import { isExerciseDefinition, isProgram } from '#lib/programs.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const responses = await Promise.all([
		backendGet('/api/therapist/patients', cookies),
		backendGet('/api/exercises', cookies),
		backendGet('/api/therapist/programs', cookies)
	]);
	if (responses.some((response) => response.status === 401)) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (responses.some((response) => response.status === 403)) {
		error(403, 'You do not have access to this therapist workspace.');
	}
	if (responses.some((response) => !response.ok)) {
		error(503, 'We could not load your clinic workspace. Please try again.');
	}
	const [patients, exercises, programs] = await Promise.all(responses.map(backendJson));
	if (
		!Array.isArray(patients) ||
		!patients.every(isPatient) ||
		!Array.isArray(exercises) ||
		!exercises.every(isExerciseDefinition) ||
		!Array.isArray(programs) ||
		!programs.every(isProgram)
	) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	return {
		patients: patients.map(({ id, email, full_name }) => ({ id, email, full_name })),
		exercises,
		programs
	};
};
