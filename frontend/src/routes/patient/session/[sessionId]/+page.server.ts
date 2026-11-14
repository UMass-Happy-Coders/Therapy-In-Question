import { error, redirect } from '@sveltejs/kit';
import { isPatientSession } from '#lib/sessions.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, params }) => {
	const response = await backendGet(`/api/patient/sessions/${params.sessionId}`, cookies);
	if (response.status === 401) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (response.status === 403) error(403, 'Patient access required.');
	if (response.status === 404 || response.status === 422) error(404, 'Session not found.');
	if (!response.ok) error(503, 'We could not load this session. Please try again.');
	const session = await backendJson(response);
	if (!isPatientSession(session)) error(503, 'The service returned an unexpected session.');
	return { session };
};
