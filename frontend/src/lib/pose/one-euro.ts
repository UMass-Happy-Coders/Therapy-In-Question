const MAX_GAP_MS = 500;

function alpha(cutoff: number, seconds: number) {
	return 1 / (1 + 1 / (2 * Math.PI * cutoff * seconds));
}

export class OneEuroFilter {
	private initialized = false;
	private lastTimestamp = 0;
	private lastInput = 0;
	private filtered = 0;
	private derivative = 0;

	constructor(
		private readonly minCutoff = 1,
		private readonly beta = 0.02,
		private readonly derivativeCutoff = 1
	) {}

	filter(value: number, timestamp: number): number | null {
		if (!Number.isFinite(value) || !Number.isFinite(timestamp)) {
			this.reset();
			return null;
		}
		const elapsed = timestamp - this.lastTimestamp;
		if (this.initialized && elapsed <= 0) {
			this.reset();
			return null;
		}
		if (!this.initialized || elapsed > MAX_GAP_MS) {
			this.initialized = true;
			this.lastTimestamp = timestamp;
			this.lastInput = value;
			this.filtered = value;
			this.derivative = 0;
			return value;
		}
		const seconds = elapsed / 1000;
		const derivativeAlpha = alpha(this.derivativeCutoff, seconds);
		const rawDerivative = (value - this.lastInput) / seconds;
		this.derivative += derivativeAlpha * (rawDerivative - this.derivative);
		const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
		this.filtered += alpha(cutoff, seconds) * (value - this.filtered);
		this.lastInput = value;
		this.lastTimestamp = timestamp;
		return this.filtered;
	}

	reset() {
		this.initialized = false;
		this.lastTimestamp = 0;
		this.lastInput = 0;
		this.filtered = 0;
		this.derivative = 0;
	}
}
