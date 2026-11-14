import { API_URL } from '$app/env/private';
import { error, type Cookies } from '@sveltejs/kit';

export const sessionCookie = 'tiq_session';

export async function backendGet(
	path:
		| '/api/auth/me'
		| '/api/therapist/patients'
		| '/api/therapist/messages'
		| '/api/patient/messages',
		| '/api/exercises'
		| '/api/therapist/programs'
		| '/api/patient/programs',
	cookies: Cookies
): Promise<Response> {
	const session = cookies.get(sessionCookie);
	try {
		return await fetch(new URL(path, API_URL), {
			headers: session ? { cookie: `${sessionCookie}=${encodeURIComponent(session)}` } : {},
			cache: 'no-store',
			redirect: 'error'
		});
	} catch {
		error(503, 'The service is temporarily unavailable. Please try again.');
	}
}

export async function backendJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		error(503, 'The service returned an unexpected response. Please try again.');
	}
}
