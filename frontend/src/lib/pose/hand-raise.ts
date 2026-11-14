import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export const HAND_RAISE_HOLD_MS = 1000;
export type HandRaiseState = 'waiting' | 'ready' | 'raising' | 'lower-hand' | 'unavailable';

const RELEASE_MS = 400;
const MAX_FRAME_GAP_MS = 500;

function reliable(point: NormalizedLandmark | undefined): point is NormalizedLandmark {
	return point !== undefined &&
		Number.isFinite(point.x) && Number.isFinite(point.y) &&
		Number.isFinite(point.visibility) && point.visibility >= 0.65 &&
		(point.presence === undefined || (Number.isFinite(point.presence) && point.presence >= 0.65)) &&
		point.x >= 0.04 && point.x <= 0.96 && point.y >= 0.04 && point.y <= 0.96;
}

export class HandRaiseGesture {
	state: HandRaiseState = 'waiting';
	progressMs = 0;
	private armedMask = 0;
	private latchedMask = 0;
	private loweredSince: [number | null, number | null] = [null, null];
	private raisedSince: [number | null, number | null] = [null, null];
	private releasedSince: number | null = null;
	private lastFrameAt: number | null = null;

	update(landmarks: readonly NormalizedLandmark[] | undefined, timestamp: number): boolean {
		if (!Number.isFinite(timestamp) || (this.lastFrameAt !== null && timestamp <= this.lastFrameAt)) {
			this.reset();
			return false;
		}
		if (this.lastFrameAt !== null && timestamp - this.lastFrameAt > MAX_FRAME_GAP_MS) this.reset();
		this.lastFrameAt = timestamp;
		let validMask = 0;
		let raisedMask = 0;
		let loweredMask = 0;
		const nose = landmarks?.[0];
		for (let arm = 0; arm < 2; arm++) {
			const shoulder = landmarks?.[11 + arm];
			const elbow = landmarks?.[13 + arm];
			const wrist = landmarks?.[15 + arm];
			if (!reliable(nose) || !reliable(shoulder) || !reliable(elbow) || !reliable(wrist)) continue;
			const bit = 1 << arm;
			validMask |= bit;
			if (wrist.y < nose.y - 0.03 && elbow.y < shoulder.y) raisedMask |= bit;
			else if (wrist.y > shoulder.y + 0.04) loweredMask |= bit;
		}

		this.progressMs = 0;
		if (this.latchedMask !== 0) {
			this.latchedMask |= raisedMask;
			this.state = (validMask & this.latchedMask) === this.latchedMask ? 'lower-hand' : 'unavailable';
			if ((loweredMask & this.latchedMask) === this.latchedMask && raisedMask === 0) {
				this.releasedSince ??= timestamp;
				if (timestamp - this.releasedSince >= RELEASE_MS) {
					this.latchedMask = 0;
					this.armedMask = loweredMask;
					this.releasedSince = null;
					this.state = 'ready';
				}
			} else {
				this.releasedSince = null;
			}
			return false;
		}

		let raising = false;
		for (let arm = 0; arm < 2; arm++) {
			const bit = 1 << arm;
			if ((validMask & bit) === 0) {
				this.armedMask &= ~bit;
				this.loweredSince[arm] = null;
				this.raisedSince[arm] = null;
			} else if ((loweredMask & bit) !== 0) {
				this.loweredSince[arm] ??= timestamp;
				this.raisedSince[arm] = null;
				if (timestamp - this.loweredSince[arm]! >= RELEASE_MS) this.armedMask |= bit;
			} else {
				this.loweredSince[arm] = null;
				if ((raisedMask & this.armedMask & bit) !== 0) {
					this.raisedSince[arm] ??= timestamp;
					raising = true;
					this.progressMs = Math.max(this.progressMs, timestamp - this.raisedSince[arm]!);
				} else {
					this.raisedSince[arm] = null;
				}
			}
		}
		if (this.progressMs >= HAND_RAISE_HOLD_MS) {
			this.latchedMask = raisedMask;
			this.armedMask = 0;
			this.clearCandidates();
			this.state = 'lower-hand';
			return true;
		}
		this.state = validMask === 0 ? 'unavailable' : raising ? 'raising' : this.armedMask !== 0 ? 'ready' : 'waiting';
		return false;
	}

	reset() {
		this.armedMask = 0;
		this.latchedMask = 0;
		this.releasedSince = null;
		this.lastFrameAt = null;
		this.clearCandidates();
		this.state = 'waiting';
	}

	private clearCandidates() {
		this.loweredSince[0] = null;
		this.loweredSince[1] = null;
		this.raisedSince[0] = null;
		this.raisedSince[1] = null;
		this.progressMs = 0;
	}
}
