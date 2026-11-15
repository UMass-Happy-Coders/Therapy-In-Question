import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { TrackedSide } from '#lib/pose/framing.js';
import { anklePlantarFlexionAngle, hipFlexionAngle, jointAngle } from '#lib/pose/geometry.js';
import { OneEuroFilter } from '#lib/pose/one-euro.js';

export interface AngleMeasurement {
	raw: number;
	filtered: number;
}

export interface JointAngleFrame {
	knee: AngleMeasurement | null;
	hip: AngleMeasurement | null;
	ankle: AngleMeasurement | null;
}

const JOINT_INDICES = {
	left: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, oppositeHip: 24 },
	right: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, oppositeHip: 23 }
};
const CONFIDENCE_THRESHOLD = 0.65;
const FRAME_MARGIN = 0.04;
const MAX_FRAME_GAP_MS = 500;

function reliable(point: Landmark | undefined): point is Landmark {
	return point !== undefined &&
		Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) &&
		Number.isFinite(point.visibility) && point.visibility >= CONFIDENCE_THRESHOLD &&
		(point.presence === undefined ||
			(Number.isFinite(point.presence) && point.presence >= CONFIDENCE_THRESHOLD));
}

function worldPoint(
	normalized: readonly NormalizedLandmark[],
	world: readonly Landmark[],
	index: number
): Landmark | null {
	const point = normalized[index];
	const position = world[index];
	if (
		!reliable(point) || !reliable(position) ||
		point.x < FRAME_MARGIN || point.x > 1 - FRAME_MARGIN ||
		point.y < FRAME_MARGIN || point.y > 1 - FRAME_MARGIN
	) {
		return null;
	}
	return position;
}

function wrapAngle(value: number): number {
	const wrapped = value % 360;
	return wrapped > 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped;
}

export class JointAngleEstimator {
	private readonly indices: (typeof JOINT_INDICES)[TrackedSide];
	private readonly kneeFilter = new OneEuroFilter();
	private readonly hipFilter = new OneEuroFilter();
	private readonly ankleFilter = new OneEuroFilter();
	private readonly kneeMeasurement: AngleMeasurement = { raw: 0, filtered: 0 };
	private readonly hipMeasurement: AngleMeasurement = { raw: 0, filtered: 0 };
	private readonly ankleMeasurement: AngleMeasurement = { raw: 0, filtered: 0 };
	private readonly frame: JointAngleFrame = { knee: null, hip: null, ankle: null };
	private lastTimestamp: number | null = null;
	private lastHipInput: number | null = null;
	private ankleNeutral: number | null = null;
	private ankleNeutralAt = 0;
	private ankleNeutralLocked = false;

	constructor(side: TrackedSide, private readonly ankleOnly: boolean) {
		this.indices = JOINT_INDICES[side];
	}

	update(
		normalized: readonly NormalizedLandmark[] | undefined,
		world: readonly Landmark[] | undefined,
		timestampMs: number
	): JointAngleFrame {
		this.frame.knee = null;
		this.frame.hip = null;
		this.frame.ankle = null;
		if (
			!Number.isFinite(timestampMs) ||
			(this.lastTimestamp !== null && timestampMs <= this.lastTimestamp) ||
			normalized === undefined || normalized.length === 0 ||
			world === undefined || world.length === 0
		) {
			this.reset();
			return this.frame;
		}
		if (this.lastTimestamp !== null && timestampMs - this.lastTimestamp > MAX_FRAME_GAP_MS) {
			this.reset();
		}
		this.lastTimestamp = timestampMs;
		const knee = worldPoint(normalized, world, this.indices.knee);
		const ankle = worldPoint(normalized, world, this.indices.ankle);
		if (this.ankleOnly) {
			const heel = worldPoint(normalized, world, this.indices.heel);
			const toe = worldPoint(normalized, world, this.indices.toe);
			const raw = knee && ankle && heel && toe
				? anklePlantarFlexionAngle(knee, ankle, heel, toe) : null;
			if (raw === null) {
				this.ankleFilter.reset();
				if (!this.ankleNeutralLocked) this.ankleNeutral = null;
			} else {
				const filtered = this.ankleFilter.filter(raw, timestampMs);
				if (filtered !== null) {
					if (!this.ankleNeutralLocked) {
						this.ankleNeutral = this.ankleNeutral === null
							? filtered
							: this.ankleNeutral + (filtered - this.ankleNeutral) *
								Math.min(1, (timestampMs - this.ankleNeutralAt) / 1000);
						this.ankleNeutralAt = timestampMs;
					}
					this.ankleMeasurement.raw = raw - this.ankleNeutral!;
					this.ankleMeasurement.filtered = filtered - this.ankleNeutral!;
					this.frame.ankle = this.ankleMeasurement;
				}
			}
			return this.frame;
		}
		const hip = worldPoint(normalized, world, this.indices.hip);
		const shoulder = worldPoint(normalized, world, this.indices.shoulder);
		const oppositeHip = worldPoint(normalized, world, this.indices.oppositeHip);
		const leftHip = this.indices.hip === 23 ? hip : oppositeHip;
		const rightHip = this.indices.hip === 24 ? hip : oppositeHip;
		const kneeRaw = hip && knee && ankle ? jointAngle(hip, knee, ankle) : null;
		if (kneeRaw === null) {
			this.kneeFilter.reset();
		} else {
			const filtered = this.kneeFilter.filter(kneeRaw, timestampMs);
			if (filtered !== null) {
				this.kneeMeasurement.raw = kneeRaw;
				this.kneeMeasurement.filtered = filtered;
				this.frame.knee = this.kneeMeasurement;
			}
		}
		const hipRaw = shoulder && hip && knee && leftHip && rightHip
			? hipFlexionAngle(shoulder, hip, knee, leftHip, rightHip)
			: null;
		if (hipRaw === null) {
			this.hipFilter.reset();
			this.lastHipInput = null;
		} else {
			const input = this.lastHipInput === null
				? hipRaw
				: this.lastHipInput + wrapAngle(hipRaw - this.lastHipInput);
			const filtered = this.hipFilter.filter(input, timestampMs);
			if (filtered === null) {
				this.lastHipInput = null;
			} else {
				this.lastHipInput = input;
				this.hipMeasurement.raw = hipRaw;
				this.hipMeasurement.filtered = wrapAngle(filtered);
				this.frame.hip = this.hipMeasurement;
			}
		}
		return this.frame;
	}

	lockAnkleNeutral() {
		this.ankleNeutralLocked = this.ankleNeutral !== null;
	}

	reset() {
		this.kneeFilter.reset();
		this.hipFilter.reset();
		this.ankleFilter.reset();
		this.lastTimestamp = null;
		this.lastHipInput = null;
		this.frame.knee = null;
		this.frame.hip = null;
		this.frame.ankle = null;
		if (!this.ankleNeutralLocked) this.ankleNeutral = null;
	}
}
