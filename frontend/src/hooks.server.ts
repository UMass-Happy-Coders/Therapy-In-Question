import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { homeFor, isUser } from '#lib/auth.js';
import { backendGet, backendJson, sessionCookie } from '#lib/server/api.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.setHeaders({ 'cache-control': 'no-store' });

	if (event.cookies.get(sessionCookie) !== undefined) {
		const response = await backendGet('/api/auth/me', event.cookies);
		if (response.status === 401) {
			event.cookies.delete(sessionCookie, { path: '/' });
		} else if (!response.ok) {
			error(503, 'We cannot check your session right now. Please try again.');
		} else {
			const user = await backendJson(response);
			if (!isUser(user)) {
				error(503, 'The service returned an unexpected response. Please try again.');
			}
			event.locals.user = {
				id: user.id,
				email: user.email,
				full_name: user.full_name,
				role: user.role,
				clinic_id: user.clinic_id,
				clinic_name: user.clinic_name
			};
		}
	}

	const { pathname } = event.url;
	const requiredRole = /^\/patient(?:\/|$)/.test(pathname)
		? 'patient'
		: /^\/therapist(?:\/|$)/.test(pathname)
			? 'therapist'
			: null;
	const user = event.locals.user;

	if (requiredRole) {
		if (!user) redirect(303, '/login');
		if (user.role !== requiredRole) redirect(303, homeFor(user));
	}
	if (/^\/login\/?$/.test(pathname) && user) {
		redirect(303, homeFor(user));
	}

	return resolve(event);
};
