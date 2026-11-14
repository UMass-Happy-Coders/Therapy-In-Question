import { error, redirect } from '@sveltejs/kit';
import { isPatient } from '#lib/auth.js';
import { isTherapistMessage } from '#lib/messages.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const responses = await Promise.all([
		backendGet('/api/therapist/patients', cookies),
		backendGet('/api/therapist/messages', cookies)
	]);
	if (responses.some((response) => response.status === 401)) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (responses.some((response) => response.status === 403)) {
		error(403, 'You do not have access to clinic messages.');
	}
	if (responses.some((response) => !response.ok)) {
		error(503, 'We could not load clinic messages. Please try again.');
	}
	const [patients, messages] = await Promise.all(responses.map(backendJson));
	if (
		!Array.isArray(patients) ||
		!patients.every(isPatient) ||
		!Array.isArray(messages) ||
		!messages.every(isTherapistMessage)
	) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	return {
		patients: patients.map(({ id, email, full_name }) => ({ id, email, full_name })),
		messages
	};
};
