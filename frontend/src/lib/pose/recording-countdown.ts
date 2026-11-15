import type { RepSample } from '#lib/pose/rep-counter.js';
import type { RepProfile } from '#lib/pose/rep-profile.js';

export interface CountdownState {
	armed: boolean;
	remaining: number | null;
}

const COUNTDOWN_MS = 5000;
const MAX_FRAME_GAP_MS = 500;
const CHECK_INTERVAL_MS = 100;

export class RecordingCountdown {
	private armed = false;
	private remaining: number | null = null;
	private interval: ReturnType<typeof setInterval> | undefined;
	private armedAt = 0;
	private lastFrameAt: number | null = null;
	private eligibleSince: number | null = null;
	private generation = 0;
	private disposed = false;

	constructor(
		private readonly onstate: (state: CountdownState) => void,
		private readonly oncomplete: () => void
	) {}

	arm(): void {
		if (this.disposed || this.armed) return;
		const generation = ++this.generation;
		this.armedAt = performance.now();
		this.lastFrameAt = null;
		this.eligibleSince = null;
		this.interval = setInterval(() => this.tick(generation), CHECK_INTERVAL_MS);
		this.publish(true, null);
	}

	update(eligible: boolean, timestamp: number): void {
		if (this.disposed || !this.armed) return;
		const now = performance.now();
		if (
			!Number.isFinite(timestamp) || timestamp < this.armedAt || timestamp > now ||
			now - timestamp > MAX_FRAME_GAP_MS ||
			(this.lastFrameAt !== null && timestamp <= this.lastFrameAt)
		) {
			this.resetProgress();
			return;
		}
		if (this.lastFrameAt !== null && (
			timestamp - this.lastFrameAt > MAX_FRAME_GAP_MS ||
			now - this.lastFrameAt > MAX_FRAME_GAP_MS
		)) {
			this.eligibleSince = null;
		}
		this.lastFrameAt = timestamp;
		if (!eligible) {
			this.resetProgress();
			return;
		}
		this.eligibleSince ??= timestamp;
		this.tick(this.generation);
	}

	cancel(): void {
		if (this.disposed) return;
		this.generation++;
		this.clearInterval();
		this.lastFrameAt = null;
		this.eligibleSince = null;
		this.publish(false, null);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation++;
		this.clearInterval();
		this.lastFrameAt = null;
		this.eligibleSince = null;
		this.armed = false;
		this.remaining = null;
	}

	private tick(generation: number): void {
		if (this.disposed || !this.armed || generation !== this.generation) return;
		const now = performance.now();
		if (
			this.lastFrameAt === null || now < this.lastFrameAt ||
			now - this.lastFrameAt > MAX_FRAME_GAP_MS
		) {
			this.resetProgress();
			return;
		}
		if (this.eligibleSince === null) return;
		const elapsed = now - this.eligibleSince;
		if (elapsed < COUNTDOWN_MS) {
			this.publish(true, Math.ceil((COUNTDOWN_MS - elapsed) / 1000));
			return;
		}
		this.clearInterval();
		this.lastFrameAt = null;
		this.eligibleSince = null;
		this.publish(false, null);
		if (!this.disposed && generation === this.generation) this.oncomplete();
	}

	private resetProgress(): void {
		this.eligibleSince = null;
		this.publish(true, null);
	}

	private clearInterval(): void {
		if (this.interval === undefined) return;
		clearInterval(this.interval);
		this.interval = undefined;
	}

	private publish(armed: boolean, remaining: number | null): void {
		if (this.disposed || (this.armed === armed && this.remaining === remaining)) return;
		this.armed = armed;
		this.remaining = remaining;
		this.onstate({ armed, remaining });
	}
}

export function startingPositionReady(profile: RepProfile, sample: RepSample): boolean {
	if (profile.configurationError !== null || !Number.isFinite(profile.restEnter)) return false;
	const { knee, hip, ankle, hipY, torsoHeight } = sample;
	switch (profile.exercise) {
		case 'seated_ankle_pumps':
			return ankle !== null && Number.isFinite(ankle) && ankle <= profile.restEnter;
		case 'seated_knee_extension':
			return knee !== null && Number.isFinite(knee) && knee <= profile.restEnter;
		case 'straight_leg_raise':
			return hip !== null && Number.isFinite(hip) && hip >= -10 && hip <= profile.restEnter &&
				knee !== null && Number.isFinite(knee) && knee >= 165;
		case 'sit_to_stand':
			return knee !== null && Number.isFinite(knee) && knee <= profile.restEnter &&
				hip !== null && Number.isFinite(hip) && hip >= 55 &&
				hipY !== null && Number.isFinite(hipY) && hipY > 0 &&
				torsoHeight !== null && Number.isFinite(torsoHeight) && torsoHeight > 0;
		default:
			return false;
	}
}
