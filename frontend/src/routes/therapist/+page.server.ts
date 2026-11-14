import { error, redirect } from '@sveltejs/kit';
import { isPatient } from '#lib/auth.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const response = await backendGet('/api/therapist/patients', cookies);
	if (response.status === 401) {
		cookies.delete(sessionCookie, { path: '/' });
		redirect(303, '/login');
	}
	if (response.status === 403) {
		error(403, 'You do not have access to this clinic roster.');
	}
	if (!response.ok) {
		error(503, 'We could not load your clinic patients. Please try again.');
	}
	const patients = await backendJson(response);
	if (!Array.isArray(patients) || !patients.every(isPatient)) {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
	return {
		patients: patients.map(({ id, email, full_name }) => ({ id, email, full_name }))
	};
};
