import type { RecordedFrame, RecordedPoint } from '#lib/pose/recording.js';
import { sessionSteps, type PatientSession } from '#lib/sessions.js';

export interface WorldBounds {
	min_x: number;
	min_y: number;
	max_x: number;
	max_y: number;
}

export interface PlaybackChunk {
	seq: number;
	run_id: string;
	set_ordinal: number;
	exercise_id: string;
	side: 'left' | 'right';
	frame_count: number;
	first_elapsed_ms: number;
	last_elapsed_ms: number;
	rep_boundaries: { frame_index: number; rep_number: number }[];
	start: number;
}

export interface RepMarker {
	position: number;
	rep: number;
	setOrdinal: number;
	runId: string;
}

export interface PlaybackIndex {
	chunks: PlaybackChunk[];
	frames: number;
	bounds: WorldBounds | null;
	reps: RepMarker[];
}

export interface PlaybackFrame {
	position: number;
	frame: RecordedFrame;
	chunk: PlaybackChunk;
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isBounds(value: unknown): value is WorldBounds {
	return object(value) && finite(value.min_x) && finite(value.min_y) &&
		finite(value.max_x) && finite(value.max_y) && value.min_x <= value.max_x && value.min_y <= value.max_y;
}

function isPoint(value: unknown): value is RecordedPoint {
	return object(value) && finite(value.x) && finite(value.y) && finite(value.z) &&
		finite(value.visibility) && value.visibility >= 0 && value.visibility <= 1 &&
		(value.presence === undefined || finite(value.presence) && value.presence >= 0 && value.presence <= 1);
}

function isFrame(value: unknown): value is RecordedFrame {
	return object(value) && typeof value.captured_at === 'string' && Number.isFinite(Date.parse(value.captured_at)) &&
		finite(value.elapsed_ms) && value.elapsed_ms >= 0 && value.elapsed_ms <= 86400000 &&
		Array.isArray(value.landmarks) && (value.landmarks.length === 33 || value.landmarks.length === 21) && value.landmarks.every(isPoint) &&
		Array.isArray(value.world_landmarks) && value.world_landmarks.length === value.landmarks.length && value.world_landmarks.every(isPoint) &&
		(value.phase === 'rest' || value.phase === 'raise' || value.phase === 'hold' || value.phase === 'lower') &&
		integer(value.rep_number, 0, 100) && typeof value.rep_boundary === 'boolean' &&
		Array.isArray(value.annotations) && value.annotations.length <= 4 && value.annotations.every((entry) => typeof entry === 'string' && entry.length <= 160);
}

function isChunk(value: unknown): value is Omit<PlaybackChunk, 'start'> {
	if (!object(value) || !integer(value.seq, 0) || typeof value.run_id !== 'string' ||
		!integer(value.set_ordinal, 0, 119) || typeof value.exercise_id !== 'string' ||
		(value.side !== 'left' && value.side !== 'right') || !integer(value.frame_count, 1, 25) ||
		!finite(value.first_elapsed_ms) || value.first_elapsed_ms < 0 || !finite(value.last_elapsed_ms) ||
		value.last_elapsed_ms < value.first_elapsed_ms || !Array.isArray(value.rep_boundaries)) return false;
	let previous = -1;
	for (const boundary of value.rep_boundaries) {
		if (!object(boundary) || !integer(boundary.frame_index, 0, value.frame_count - 1) ||
			boundary.frame_index <= previous || !integer(boundary.rep_number, 1, 100)) return false;
		previous = boundary.frame_index;
	}
	return true;
}

async function responseJson(path: string, signal: AbortSignal): Promise<unknown> {
	const response = await fetch(path, { cache: 'no-store', signal });
	if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to view this recording.' : response.status === 404 ? 'Recording not found.' : 'The recording could not be loaded. Please try again.');
	return await response.json();
}

export class RecordingPlayback {
	private index: PlaybackIndex | null = null;
	private lifetime = new AbortController();
	private cache = new Map<number, RecordedFrame[]>();
	private request: { seq: number; controller: AbortController; promise: Promise<RecordedFrame[]> } | null = null;

	constructor(private session: PatientSession) {}

	async loadIndex(): Promise<PlaybackIndex> {
		const result: PlaybackIndex = { chunks: [], frames: 0, bounds: null, reps: [] };
		const plan = sessionSteps(this.session.program);
		let after = -1;
		while (true) {
			const page = await responseJson(`/api/patient/sessions/${this.session.id}/recording/index?after_seq=${after}&limit=100`, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]));
			if (!object(page) || !Array.isArray(page.chunks) || page.chunks.length > 100 ||
				(page.bounds !== null && !isBounds(page.bounds)) ||
				(page.next_after_seq !== null && !integer(page.next_after_seq, 0))) throw new Error('The service returned an invalid recording index.');
			for (const entry of page.chunks) {
				if (!isChunk(entry) || entry.seq <= after ||
					plan[entry.set_ordinal]?.exercise.id !== entry.exercise_id ||
					entry.rep_boundaries.some((boundary) => boundary.rep_number > plan[entry.set_ordinal].exercise.reps)) throw new Error('The recording index does not match this session.');
				const previous = result.chunks.at(-1);
				if (previous?.run_id === entry.run_id && previous.set_ordinal === entry.set_ordinal && entry.first_elapsed_ms < previous.last_elapsed_ms) throw new Error('Recording timestamps are out of order.');
				const chunk = { ...entry, start: result.frames };
				for (const boundary of chunk.rep_boundaries) result.reps.push({ position: chunk.start + boundary.frame_index, rep: boundary.rep_number, setOrdinal: chunk.set_ordinal, runId: chunk.run_id });
				result.chunks.push(chunk);
				result.frames += chunk.frame_count;
				if (!Number.isSafeInteger(result.frames)) throw new Error('The recording frame count is invalid.');
				after = chunk.seq;
			}
			if (page.bounds !== null) {
				const bounds = page.bounds as unknown as WorldBounds;
				result.bounds = result.bounds ? {
					min_x: Math.min(result.bounds.min_x, bounds.min_x), min_y: Math.min(result.bounds.min_y, bounds.min_y),
					max_x: Math.max(result.bounds.max_x, bounds.max_x), max_y: Math.max(result.bounds.max_y, bounds.max_y)
				} : bounds;
			}
			if (page.next_after_seq === null) break;
			if (page.chunks.length === 0 || page.next_after_seq !== after) throw new Error('The recording index did not advance.');
		}
		this.index = result;
		return result;
	}

	async frame(position: number): Promise<PlaybackFrame> {
		if (!this.index || !integer(position, 0, this.index.frames - 1)) throw new Error('Frame not found.');
		let low = 0;
		let high = this.index.chunks.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (this.index.chunks[middle].start <= position) low = middle;
			else high = middle - 1;
		}
		const chunk = this.index.chunks[low];
		if (this.request && this.request.seq !== chunk.seq) this.cancelRead();
		let frames = this.cache.get(chunk.seq);
		if (!frames) {
			if (!this.request) {
				const controller = new AbortController();
				this.request = { seq: chunk.seq, controller, promise: this.readChunk(chunk, controller.signal) };
			}
			const request = this.request;
			try {
				frames = await request.promise;
			} finally {
				if (this.request === request) this.request = null;
			}
		}
		this.cache.delete(chunk.seq);
		this.cache.set(chunk.seq, frames);
		if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
		return { position, frame: frames[position - chunk.start], chunk };
	}

	private async readChunk(chunk: PlaybackChunk, signal: AbortSignal): Promise<RecordedFrame[]> {
		const value = await responseJson(`/api/patient/sessions/${this.session.id}/recording/chunks?after_seq=${chunk.seq - 1}&limit=1`, AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(15000)]));
		if (!object(value) || !Array.isArray(value.chunks) || value.chunks.length !== 1) throw new Error('The saved recording chunk is missing.');
		const stored = value.chunks[0];
		if (!object(stored) || stored.seq !== chunk.seq || stored.run_id !== chunk.run_id ||
			stored.set_ordinal !== chunk.set_ordinal || stored.exercise_id !== chunk.exercise_id || stored.side !== chunk.side ||
			stored.frame_count !== chunk.frame_count || !Array.isArray(stored.frames) ||
			stored.frames.length !== chunk.frame_count || !stored.frames.every(isFrame)) throw new Error('The saved recording chunk is invalid.');
		const expectedPoints = sessionSteps(this.session.program)[chunk.set_ordinal].exercise.exercise_type === 'seated_index_finger_bends' ? 21 : 33;
		if (stored.frames.some((frame) => frame.landmarks.length !== expectedPoints)) throw new Error('The saved landmarks do not match this exercise.');
		const frames = stored.frames as RecordedFrame[];
		if (frames[0].elapsed_ms !== chunk.first_elapsed_ms || frames.at(-1)!.elapsed_ms !== chunk.last_elapsed_ms ||
			frames.some((frame, index) => index > 0 && frame.elapsed_ms < frames[index - 1].elapsed_ms)) throw new Error('Recording timestamps are out of order.');
		return frames;
	}

	cancelRead() {
		this.request?.controller.abort();
		this.request = null;
	}

	dispose() {
		this.lifetime.abort();
		this.cancelRead();
		this.cache.clear();
	}
}
