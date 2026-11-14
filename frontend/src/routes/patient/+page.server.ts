import { error, redirect } from '@sveltejs/kit';
import { isAssignedProgram } from '#lib/programs.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const response = await backendGet('/api/patient/programs', cookies);
	if (response.status === 401) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (!response.ok) {
		error(503, 'We could not load your assigned programs. Please try again.');
	}
	const programs = await backendJson(response);
	if (!Array.isArray(programs) || !programs.every(isAssignedProgram)) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	return { programs };
};
