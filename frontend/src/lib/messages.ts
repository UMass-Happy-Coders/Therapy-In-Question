export interface TherapistMessage {
	id: string;
	patient_id: string;
	patient_name: string;
	subject: string;
	body: string;
	created_at: string;
	drafted_by_name: string;
	approved_at: string | null;
	approved_by_name: string | null;
	read_at: string | null;
}

export interface InboxMessage {
	id: string;
	subject: string;
	body: string;
	approved_at: string;
	read_at: string | null;
	therapist_name: string;
}

export function isTherapistMessage(value: unknown): value is TherapistMessage {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		typeof value.id === 'string' &&
		'patient_id' in value &&
		typeof value.patient_id === 'string' &&
		'patient_name' in value &&
		typeof value.patient_name === 'string' &&
		'subject' in value &&
		typeof value.subject === 'string' &&
		'body' in value &&
		typeof value.body === 'string' &&
		'created_at' in value &&
		typeof value.created_at === 'string' &&
		'drafted_by_name' in value &&
		typeof value.drafted_by_name === 'string' &&
		'approved_at' in value &&
		(value.approved_at === null || typeof value.approved_at === 'string') &&
		'approved_by_name' in value &&
		(value.approved_by_name === null || typeof value.approved_by_name === 'string') &&
		'read_at' in value &&
		(value.read_at === null || typeof value.read_at === 'string')
	);
}

export function isInboxMessage(value: unknown): value is InboxMessage {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		typeof value.id === 'string' &&
		'subject' in value &&
		typeof value.subject === 'string' &&
		'body' in value &&
		typeof value.body === 'string' &&
		'approved_at' in value &&
		typeof value.approved_at === 'string' &&
		'read_at' in value &&
		(value.read_at === null || typeof value.read_at === 'string') &&
		'therapist_name' in value &&
		typeof value.therapist_name === 'string'
	);
}
