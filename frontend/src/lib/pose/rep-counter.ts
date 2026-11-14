import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { TrackedSide } from '#lib/pose/framing.js';
import type { RepPhase, RepProfile } from '#lib/pose/rep-profile.js';

export interface RepSample {
	timestamp: number;
	knee: number | null;
	hip: number | null;
	hipY: number | null;
	torsoHeight: number | null;
}

const MAX_FRAME_GAP_MS = 500;
const MIN_TORSO_HEIGHT = 0.025;
const CONFIGURATION_ERROR = 'The movement target does not leave a reliable rep range.';

function reliable(point: NormalizedLandmark | undefined): point is NormalizedLandmark {
	return point !== undefined &&
		Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) &&
		Number.isFinite(point.visibility) && point.visibility >= 0.65 &&
		(point.presence === undefined || (Number.isFinite(point.presence) && point.presence >= 0.65)) &&
		point.x >= 0.04 && point.x <= 0.96 &&
		point.y >= 0.04 && point.y <= 0.96;
}

export function makeRepSample(
	normalized: readonly NormalizedLandmark[] | undefined,
	side: TrackedSide,
	knee: number | null,
	hip: number | null,
	timestamp: number
): RepSample {
	const hipPoint = normalized?.[side === 'left' ? 23 : 24];
	const shoulderPoint = normalized?.[side === 'left' ? 11 : 12];
	let hipY: number | null = null;
	let torsoHeight: number | null = null;
	if (reliable(hipPoint) && reliable(shoulderPoint)) {
		const span = hipPoint.y - shoulderPoint.y;
		if (span > MIN_TORSO_HEIGHT) {
			hipY = hipPoint.y;
			torsoHeight = span;
		}
	}
	return { timestamp, knee, hip, hipY, torsoHeight };
}

export class RepCounter {
	reps = 0;
	phase: RepPhase = 'rest';
	holdElapsedMs = 0;
	cue: string | null;
	private readonly configurationError: string | null;
	private lastTimestamp: number | null = null;
	private restSince: number | null = null;
	private armed = false;
	private qualified = false;
	private kneeStraight = false;
	private restHipY: number | null = null;
	private restTorsoHeight: number | null = null;

	constructor(private readonly profile: RepProfile) {
		this.configurationError = profile.configurationError ?? (
			!Number.isFinite(profile.restEnter) || !Number.isFinite(profile.restExit) ||
			!Number.isFinite(profile.topEnter) || !Number.isFinite(profile.topExit) ||
			!Number.isFinite(profile.holdMs) || !Number.isFinite(profile.restDwellMs) ||
			profile.restEnter >= profile.restExit || profile.restExit >= profile.topExit ||
			profile.topExit >= profile.topEnter || profile.holdMs < 200 ||
			profile.restDwellMs < 250
				? CONFIGURATION_ERROR
				: null
		);
		this.cue = this.configurationError;
	}

	update(sample: RepSample): void {
		if (this.configurationError !== null) {
			this.invalidate(this.configurationError);
			return;
		}
		if (!Number.isFinite(sample.timestamp)) {
			this.invalidate('Tracking time unavailable');
			return;
		}
		if (this.lastTimestamp !== null && sample.timestamp <= this.lastTimestamp) {
			this.invalidate('Tracking interrupted');
			return;
		}
		if (this.lastTimestamp !== null && sample.timestamp - this.lastTimestamp > MAX_FRAME_GAP_MS) {
			this.suspend();
		}
		if (sample.knee === null || !Number.isFinite(sample.knee)) {
			this.invalidate('Knee angle unavailable');
			return;
		}
		const legRaise = this.profile.exercise === 'straight_leg_raise';
		const sitToStand = this.profile.exercise === 'sit_to_stand';
		if ((legRaise || sitToStand) && (sample.hip === null || !Number.isFinite(sample.hip))) {
			this.invalidate('Hip angle unavailable');
			return;
		}
		if (sitToStand && (
			sample.hipY === null || !Number.isFinite(sample.hipY) ||
			sample.torsoHeight === null || !Number.isFinite(sample.torsoHeight) ||
			sample.torsoHeight <= MIN_TORSO_HEIGHT
		)) {
			this.invalidate('Hip height unavailable');
			return;
		}
		if (legRaise) {
			if (sample.knee >= 165) this.kneeStraight = true;
			if (sample.knee < 155 || !this.kneeStraight) {
				this.invalidate('Knee bent');
				return;
			}
		}
		const elapsed = this.lastTimestamp === null ? 0 : sample.timestamp - this.lastTimestamp;
		this.lastTimestamp = sample.timestamp;
		this.cue = null;
		const primary = legRaise ? sample.hip! : sample.knee;
		const hipRise = sitToStand && this.restHipY !== null ? this.restHipY - sample.hipY! : 0;
		const returnedHeight = this.restHipY === null || this.restTorsoHeight === null ||
			Math.abs(hipRise) <= this.restTorsoHeight * 0.12;
		const resting = primary <= this.profile.restEnter &&
			(!legRaise || primary >= -10) &&
			(!sitToStand || (sample.hip! >= 55 && returnedHeight));
		const atTop = primary >= this.profile.topEnter &&
			(!sitToStand || (
				sample.hip! <= 25 && this.restTorsoHeight !== null &&
				hipRise >= this.restTorsoHeight * 0.2
			));
		const keepingTop = primary >= this.profile.topExit &&
			(!sitToStand || (
				sample.hip! <= 35 && this.restTorsoHeight !== null &&
				hipRise >= this.restTorsoHeight * 0.12
			));

		if (this.phase === 'rest') {
			if (resting) {
				this.restSince ??= sample.timestamp;
				if (sample.timestamp - this.restSince >= this.profile.restDwellMs) {
					this.armed = true;
					if (sitToStand) this.recordRestHeight(sample);
				}
				return;
			}
			this.restSince = null;
			if (!this.armed) {
				this.cue = sitToStand ? 'Return to seated rest' : 'Return to rest';
				return;
			}
			if (primary <= this.profile.restExit) return;
			if (sitToStand && hipRise <= 0) {
				this.cue = 'Raise hips';
				return;
			}
			this.phase = 'raise';
		}

		if (this.phase === 'raise') {
			if (resting) {
				this.phase = 'rest';
				this.armed = false;
				this.restSince = sample.timestamp;
				return;
			}
			if (!atTop) {
				if (sitToStand && primary >= this.profile.topEnter) this.cue = 'Stand fully';
				return;
			}
			this.phase = 'hold';
			this.holdElapsedMs = 0;
			return;
		}

		if (this.phase === 'hold') {
			if (keepingTop) {
				this.holdElapsedMs = Math.min(this.profile.holdMs, this.holdElapsedMs + elapsed);
				if (this.holdElapsedMs >= this.profile.holdMs) this.qualified = true;
				return;
			}
			this.phase = 'lower';
			if (!this.qualified) this.holdElapsedMs = 0;
		}

		if (this.phase === 'lower') {
			if (resting) {
				this.restSince ??= sample.timestamp;
				if (sample.timestamp - this.restSince < this.profile.restDwellMs) return;
				if (this.qualified) this.reps += 1;
				this.phase = 'rest';
				this.holdElapsedMs = 0;
				this.qualified = false;
				this.armed = true;
				if (sitToStand) this.recordRestHeight(sample);
				return;
			}
			this.restSince = null;
			if (atTop) {
				this.phase = 'hold';
			} else if (sitToStand && primary <= this.profile.restEnter) {
				this.cue = 'Return to seated rest';
			}
		}
	}

	suspend(): void {
		this.phase = 'rest';
		this.holdElapsedMs = 0;
		this.cue = this.configurationError;
		this.lastTimestamp = null;
		this.restSince = null;
		this.armed = false;
		this.qualified = false;
		this.kneeStraight = false;
		this.restHipY = null;
		this.restTorsoHeight = null;
	}

	reset(): void {
		this.suspend();
		this.reps = 0;
	}

	private invalidate(cue: string): void {
		this.suspend();
		this.cue = cue;
	}

	private recordRestHeight(sample: RepSample): void {
		this.restHipY = sample.hipY;
		this.restTorsoHeight = sample.torsoHeight;
	}
}
