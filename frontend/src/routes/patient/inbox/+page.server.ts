import { error, redirect } from '@sveltejs/kit';
import { isInboxMessage } from '#lib/messages.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const response = await backendGet('/api/patient/messages', cookies);
	if (response.status === 401) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (response.status === 403) {
		error(403, 'Patient access required.');
	}
	if (!response.ok) {
		error(503, 'We could not load your inbox. Please try again.');
	}
	const messages = await backendJson(response);
	if (!Array.isArray(messages) || !messages.every(isInboxMessage)) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	return { messages };
};
