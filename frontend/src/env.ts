import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	API_URL: {
		schema: (value: string | undefined) => {
			const url = new URL(value || 'http://127.0.0.1:8000');
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
				throw new Error('API_URL must be an HTTP or HTTPS backend URL without credentials.');
			}
			return url.origin;
		}
	}
});
