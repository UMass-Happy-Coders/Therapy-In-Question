import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseType } from '#lib/programs.js';

export type TrackedSide = 'left' | 'right';
export interface RequiredJoint {
	label: string;
	index: number;
}

const JOINT_INDICES = {
	left: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
	right: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 }
};
const LOWER_BODY = ['hip', 'knee', 'ankle'] as const;
const FULL_SIDE = ['shoulder', 'hip', 'knee', 'ankle'] as const;
const ANKLE = ['knee', 'ankle', 'heel', 'toe'] as const;
const VISIBILITY_THRESHOLD = 0.65;
const FRAME_MARGIN = 0.04;
const STABLE_MS = 500;
const MAX_FRAME_GAP_MS = 500;

export class FramingGate {
	readonly joints: readonly RequiredJoint[];
	readonly requiredMask: number;
	visibleMask = 0;
	ready = false;
	hasPose = false;
	private visibleSince: number | null = null;
	private lastFrameAt: number | null = null;

	constructor(exercise: ExerciseType, side: TrackedSide) {
		const names = exercise === 'seated_ankle_pumps'
			? ANKLE
			: exercise === 'seated_knee_extension' ? LOWER_BODY : FULL_SIDE;
		const prefix = side === 'left' ? 'Left' : 'Right';
		this.joints = names.map((name) => ({
			label: `${prefix} ${name}`,
			index: JOINT_INDICES[side][name]
		}));
		this.requiredMask = (1 << this.joints.length) - 1;
	}

	get stabilizing() {
		return this.hasPose && this.visibleMask === this.requiredMask && !this.ready;
	}

	update(landmarks: readonly NormalizedLandmark[] | undefined, timestamp: number) {
		if (
			!Number.isFinite(timestamp) ||
			(this.lastFrameAt !== null && timestamp <= this.lastFrameAt)
		) {
			this.reset();
			return;
		}
		if (this.lastFrameAt !== null && timestamp - this.lastFrameAt > MAX_FRAME_GAP_MS) {
			this.visibleSince = null;
		}
		this.lastFrameAt = timestamp;
		this.hasPose = landmarks !== undefined && landmarks.length > 0;
		let mask = 0;
		for (let index = 0; index < this.joints.length; index++) {
			const point = landmarks?.[this.joints[index].index];
			if (
				point &&
				Number.isFinite(point.visibility) && point.visibility >= VISIBILITY_THRESHOLD &&
				(point.presence === undefined ||
					(Number.isFinite(point.presence) && point.presence >= VISIBILITY_THRESHOLD)) &&
				point.x >= FRAME_MARGIN && point.x <= 1 - FRAME_MARGIN &&
				point.y >= FRAME_MARGIN && point.y <= 1 - FRAME_MARGIN
			) {
				mask |= 1 << index;
			}
		}
		this.visibleMask = mask;
		if (!this.hasPose || mask !== this.requiredMask) {
			this.visibleSince = null;
			this.ready = false;
			return;
		}
		this.visibleSince ??= timestamp;
		this.ready = timestamp - this.visibleSince >= STABLE_MS;
	}

	reset() {
		this.visibleSince = null;
		this.lastFrameAt = null;
		this.visibleMask = 0;
		this.ready = false;
		this.hasPose = false;
	}
}
