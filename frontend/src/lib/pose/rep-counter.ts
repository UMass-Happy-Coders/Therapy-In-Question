import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TRACKING_DROPOUT_MS, type TrackedSide } from '#lib/pose/framing.js';
import type { RepPhase, RepProfile } from '#lib/pose/rep-profile.js';

export interface RepSample {
	timestamp: number;
	knee: number | null;
	hip: number | null;
	ankle: number | null;
	finger: number | null;
	hipY: number | null;
	torsoHeight: number | null;
}

export interface RepMeasurement {
	rep_number: number;
	start_angle: number;
	peak_angle: number;
	duration_ms: number;
	hold_ms: number;
}

const MAX_FRAME_GAP_MS = TRACKING_DROPOUT_MS;
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
	ankle: number | null,
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
	return { timestamp, knee, hip, ankle, finger: null, hipY, torsoHeight };
}

export class RepCounter {
	reps = 0;
	phase: RepPhase = 'rest';
	holdElapsedMs = 0;
	cue: string | null;
	measurements: RepMeasurement[] = [];
	private readonly configurationError: string | null;
	private lastTimestamp: number | null = null;
	private restSince: number | null = null;
	private armed = false;
	private qualified = false;
	private kneeStraight = false;
	private restHipY: number | null = null;
	private restTorsoHeight: number | null = null;
	private restAngle: number | null = null;
	private startAngle = 0;
	private peakAngle = 0;
	private repStartAt = 0;

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
		const anklePumps = this.profile.exercise === 'seated_ankle_pumps';
		const fingerBends = this.profile.exercise === 'seated_index_finger_bends';
		if (fingerBends) {
			if (sample.finger === null || !Number.isFinite(sample.finger)) {
				this.invalidate('Finger angle unavailable');
				return;
			}
		} else if (anklePumps) {
			if (sample.ankle === null || !Number.isFinite(sample.ankle)) {
				this.invalidate('Ankle angle unavailable');
				return;
			}
		} else if (sample.knee === null || !Number.isFinite(sample.knee)) {
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
			if (sample.knee! >= 165) this.kneeStraight = true;
			if (sample.knee! < 155 || !this.kneeStraight) {
				this.invalidate('Knee bent');
				return;
			}
		}
		const elapsed = this.lastTimestamp === null ? 0 : sample.timestamp - this.lastTimestamp;
		this.lastTimestamp = sample.timestamp;
		this.cue = null;
		const primary = fingerBends ? sample.finger! : anklePumps ? sample.ankle! : legRaise ? sample.hip! : sample.knee!;
		if (this.phase !== 'rest' && primary > this.peakAngle) this.peakAngle = primary;
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
				this.restAngle = Math.min(this.restAngle ?? primary, primary);
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
			this.startAngle = Math.min(this.restAngle ?? primary, primary);
			this.peakAngle = primary;
			this.repStartAt = sample.timestamp;
		}

		if (this.phase === 'raise') {
			if (resting) {
				this.phase = 'rest';
				this.restAngle = primary;
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
				if (this.qualified) {
					this.reps += 1;
					this.measurements.push({
						rep_number: this.reps,
						start_angle: this.startAngle,
						peak_angle: this.peakAngle,
						duration_ms: Math.max(1, Math.round(sample.timestamp - this.repStartAt)),
						hold_ms: Math.round(this.holdElapsedMs)
					});
				}
				this.phase = 'rest';
				this.restAngle = primary;
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
		this.restAngle = null;
	}

	reset(): void {
		this.suspend();
		this.reps = 0;
		this.measurements = [];
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
