import { error, redirect } from '@sveltejs/kit';
import { isAssignedProgram } from '#lib/programs.js';
import { isPatientSession } from '#lib/sessions.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const [response, sessionsResponse] = await Promise.all([
		backendGet('/api/patient/programs', cookies),
		backendGet('/api/patient/sessions/today', cookies)
	]);
	if (response.status === 401 || sessionsResponse.status === 401) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (!response.ok || !sessionsResponse.ok) {
		error(503, 'We could not load your assigned programs. Please try again.');
	}
	const [programs, sessions] = await Promise.all([
		backendJson(response),
		backendJson(sessionsResponse)
	]);
	if (!Array.isArray(programs) || !programs.every(isAssignedProgram) ||
		!Array.isArray(sessions) || !sessions.every(isPatientSession)) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	return { programs, sessions, today: new Date().toISOString().slice(0, 10) };
};
