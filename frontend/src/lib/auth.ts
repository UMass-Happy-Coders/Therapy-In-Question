export interface User {
	id: string;
	email: string;
	full_name: string;
	role: 'therapist' | 'patient';
	clinic_id: string;
	clinic_name: string;
}

export interface Patient {
	id: string;
	email: string;
	full_name: string;
}

export function isPatient(value: unknown): value is Patient {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		typeof value.id === 'string' &&
		'email' in value &&
		typeof value.email === 'string' &&
		'full_name' in value &&
		typeof value.full_name === 'string'
	);
}

export function isUser(value: unknown): value is User {
	return (
		isPatient(value) &&
		'role' in value &&
		(value.role === 'therapist' || value.role === 'patient') &&
		'clinic_id' in value &&
		typeof value.clinic_id === 'string' &&
		'clinic_name' in value &&
		typeof value.clinic_name === 'string'
	);
}

export function homeFor(user: User): '/therapist' | '/patient' {
	return user.role === 'therapist' ? '/therapist' : '/patient';
}
