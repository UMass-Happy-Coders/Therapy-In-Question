import { error, redirect } from '@sveltejs/kit';
import { isAssignedProgram } from '#lib/programs.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, params }) => {
	const response = await backendGet('/api/patient/programs', cookies);
	if (response.status === 401) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (response.status === 403) error(403, 'Patient access required.');
	if (!response.ok) error(503, 'We could not load this exercise. Please try again.');
	const assignments = await backendJson(response);
	if (!Array.isArray(assignments) || !assignments.every(isAssignedProgram)) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	const assignment = assignments.find((item) => item.id === params.assignmentId);
	const exercise = assignment?.program.exercises.find((item) => item.id === params.exerciseId);
	if (!assignment || !exercise) error(404, 'Assigned exercise not found.');
	return { assignment, exercise };
};
