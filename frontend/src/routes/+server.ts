import { redirect } from '@sveltejs/kit';
import { homeFor } from '#lib/auth.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	redirect(303, locals.user ? homeFor(locals.user) : '/login');
};
