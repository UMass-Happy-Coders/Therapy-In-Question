import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { RepPhase } from '#lib/pose/rep-profile.js';
import type { TrackedSide } from '#lib/pose/framing.js';

export interface RecordedPoint {
	x: number;
	y: number;
	z: number;
	visibility: number;
	presence?: number;
}

export interface RecordedFrame {
	captured_at: string;
	elapsed_ms: number;
	landmarks: RecordedPoint[];
	world_landmarks: RecordedPoint[];
	phase: RepPhase;
	rep_number: number;
	rep_boundary: boolean;
	annotations: string[];
}

export interface PoseCapture {
	landmarks: readonly NormalizedLandmark[];
	worldLandmarks: readonly Landmark[];
	timestamp: number;
	elapsedMs: number;
	phase: RepPhase;
	reps: number;
	cue: string | null;
	side: TrackedSide;
	runId: string;
	setOrdinal: number;
	exerciseId: string;
}

interface RecordingChunk {
	chunk_id: string;
	run_id: string;
	set_ordinal: number;
	exercise_id: string;
	side: TrackedSide;
	frames: RecordedFrame[];
}

export interface RecordingState {
	totals: { chunks: number; frames: number } | null;
	pendingFrames: number;
	busy: boolean;
	ready: boolean;
	error: string;
}

const CHUNK_SIZE = 25;
const MAX_PENDING_FRAMES = 250;
const SAMPLE_INTERVAL_MS = 200;

function validPoint(point: Landmark | NormalizedLandmark) {
	return Number.isFinite(point.x) && Math.abs(point.x) <= 10000 &&
		Number.isFinite(point.y) && Math.abs(point.y) <= 10000 &&
		Number.isFinite(point.z) && Math.abs(point.z) <= 10000 &&
		Number.isFinite(point.visibility) && point.visibility >= 0 && point.visibility <= 1 &&
		(point.presence === undefined || Number.isFinite(point.presence) && point.presence >= 0 && point.presence <= 1);
}

function copyPoint(point: Landmark | NormalizedLandmark): RecordedPoint {
	const result: RecordedPoint = {
		x: point.x, y: point.y, z: point.z, visibility: point.visibility
	};
	if (point.presence !== undefined) result.presence = point.presence;
	return result;
}

function nonnegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export class MovementRecorder {
	private totals: RecordingState['totals'] = null;
	private queue: RecordingChunk[] = [];
	private partial: RecordingChunk | null = null;
	private pendingFrames = 0;
	private connected = false;
	private error = '';
	private disposed = false;
	private loading: Promise<boolean> | null = null;
	private uploading: Promise<boolean> | null = null;
	private runId = '';
	private lastSampleAt = -Infinity;
	private lastRep = 0;

	constructor(private sessionId: string, private onchange: (state: RecordingState) => void) {}

	private publish() {
		if (this.disposed) return;
		this.onchange({
			totals: this.totals,
			pendingFrames: this.pendingFrames,
			busy: this.loading !== null || this.uploading !== null,
			ready: this.connected && !this.error && this.pendingFrames < MAX_PENDING_FRAMES,
			error: this.error
		});
	}

	async connect(): Promise<boolean> {
		if (this.loading) return this.loading;
		this.loading = this.loadTotals();
		this.publish();
		try {
			return await this.loading;
		} finally {
			this.loading = null;
			this.publish();
		}
	}

	private async loadTotals(): Promise<boolean> {
		this.error = '';
		try {
			const response = await fetch(`/api/patient/sessions/${this.sessionId}/recording`, {
				cache: 'no-store', signal: AbortSignal.timeout(15000)
			});
			if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to save movement data.' : 'Movement storage is unavailable. Retry to continue.');
			const value: unknown = await response.json();
			if (typeof value !== 'object' || value === null ||
				!('chunks' in value) || !nonnegativeInteger(value.chunks) ||
				!('frames' in value) || !nonnegativeInteger(value.frames)) throw new Error('The service returned unexpected recording totals.');
			this.totals = { chunks: value.chunks, frames: value.frames };
			this.connected = true;
			return true;
		} catch (error) {
			this.connected = false;
			this.error = error instanceof Error && error.name === 'Error' ? error.message : 'Movement storage could not be reached. Retry to continue.';
			return false;
		}
	}

	capture(input: PoseCapture): boolean {
		if (this.disposed || !this.connected || this.error || this.pendingFrames >= MAX_PENDING_FRAMES) return false;
		if (input.runId !== this.runId) {
			this.seal();
			this.runId = input.runId;
			this.lastSampleAt = -Infinity;
			this.lastRep = 0;
		}
		const boundary = input.reps > this.lastRep;
		if (input.timestamp - this.lastSampleAt < SAMPLE_INTERVAL_MS && !boundary) return true;
		if (input.landmarks.length !== 33 || input.worldLandmarks.length !== 33 ||
			!input.landmarks.every(validPoint) || !input.worldLandmarks.every(validPoint)) return true;
		if (!this.partial) {
			this.partial = {
				chunk_id: crypto.randomUUID(), run_id: input.runId,
				set_ordinal: input.setOrdinal, exercise_id: input.exerciseId, side: input.side, frames: []
			};
		}
		this.partial.frames.push({
			captured_at: new Date(performance.timeOrigin + input.timestamp).toISOString(),
			elapsed_ms: Math.round(input.elapsedMs),
			landmarks: input.landmarks.map(copyPoint),
			world_landmarks: input.worldLandmarks.map(copyPoint),
			phase: input.phase, rep_number: input.reps, rep_boundary: boundary,
			annotations: input.cue ? [input.cue] : []
		});
		this.pendingFrames += 1;
		this.lastSampleAt = input.timestamp;
		this.lastRep = input.reps;
		if (this.partial.frames.length === CHUNK_SIZE) {
			this.seal();
			void this.pump();
		}
		this.publish();
		return this.pendingFrames < MAX_PENDING_FRAMES;
	}

	private seal() {
		if (!this.partial) return;
		this.queue.push(this.partial);
		this.partial = null;
	}

	private async pump(): Promise<boolean> {
		if (this.uploading) return this.uploading;
		if (!this.connected || this.error || this.disposed) return false;
		this.uploading = this.sendQueued();
		this.publish();
		try {
			return await this.uploading;
		} finally {
			this.uploading = null;
			this.publish();
		}
	}

	private async sendQueued(): Promise<boolean> {
		try {
			while (this.queue.length && !this.disposed) {
				const chunk = this.queue[0];
				const response = await fetch(`/api/patient/sessions/${this.sessionId}/recording/chunks`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TherapyInQuestion' },
					body: JSON.stringify(chunk), signal: AbortSignal.timeout(15000)
				});
				if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to save movement data.' : response.status === 409 ? 'This movement chunk conflicts with saved data. Your unsaved frames are retained.' : 'Movement data was not confirmed saved. Retry to continue.');
				const receipt = await response.json();
				if (receipt === null || typeof receipt !== 'object' || receipt.chunk_id !== chunk.chunk_id ||
					receipt.frame_count !== chunk.frames.length || !nonnegativeInteger(receipt.seq) ||
					!nonnegativeInteger(receipt.total_chunks) || !nonnegativeInteger(receipt.total_frames)) throw new Error('The service returned an unexpected recording receipt.');
				this.totals = { chunks: receipt.total_chunks, frames: receipt.total_frames };
				this.pendingFrames -= chunk.frames.length;
				this.queue.shift();
				this.publish();
			}
			return !this.disposed;
		} catch (error) {
			this.error = error instanceof Error && error.name === 'Error' ? error.message : 'Movement data was not confirmed saved. Retry to continue.';
			return false;
		}
	}

	async flush(): Promise<boolean> {
		this.seal();
		if (this.loading) await this.loading;
		return await this.pump();
	}

	async retry(): Promise<boolean> {
		if (this.uploading) await this.uploading;
		if (!await this.connect()) return false;
		return await this.flush();
	}

	dispose() {
		this.disposed = true;
	}
}
