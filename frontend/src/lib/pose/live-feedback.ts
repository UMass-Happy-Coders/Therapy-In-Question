import type { RepPhase } from '#lib/pose/rep-profile.js';

export interface FeedbackSample {
	set_ordinal: number;
	reps_completed: number;
	elapsed_ms: number;
	phase: RepPhase;
}

export interface FeedbackState {
	status: 'disabled' | 'idle' | 'connecting' | 'ready' | 'waiting' | 'unavailable';
	message: string;
}

type Packet =
	| { type: 'ready'; interval_ms: 30000 }
	| { type: 'encouragement'; request_id: number; message: string }
	| { type: 'cooldown'; request_id: number; retry_after_ms: number }
	| { type: 'unavailable'; request_id: number; detail: string };

const PHRASES: Record<string, true> = {
	'Your effort today counts.': true,
	'Keep your focus on this movement.': true,
	'Take this set one rep at a time.': true,
	'Every completed rep counts toward this set.': true,
	'Give each repetition your attention.': true
};
const UNAVAILABLE = 'Encouragement is unavailable. Instant cues still work.';

function integer(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
	return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function parsePacket(data: unknown): Packet | null {
	if (typeof data !== 'string' || data.length > 2048) return null;
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const packet = value as Record<string, unknown>;
	if (packet.type === 'ready') {
		return keys(packet, ['type', 'interval_ms']) && packet.interval_ms === 30000
			? packet as Packet : null;
	}
	if (!integer(packet.request_id, 1, 2147483647)) return null;
	if (packet.type === 'encouragement') {
		return keys(packet, ['type', 'request_id', 'message']) &&
			typeof packet.message === 'string' && Object.hasOwn(PHRASES, packet.message)
			? packet as Packet : null;
	}
	if (packet.type === 'cooldown') {
		return keys(packet, ['type', 'request_id', 'retry_after_ms']) && integer(packet.retry_after_ms, 1, 30000)
			? packet as Packet : null;
	}
	if (packet.type === 'unavailable') {
		return keys(packet, ['type', 'request_id', 'detail']) && packet.detail === UNAVAILABLE
			? packet as Packet : null;
	}
	return null;
}

function validSample(sample: FeedbackSample): boolean {
	return integer(sample.set_ordinal, 0, 119) && integer(sample.reps_completed, 0, 1000) &&
		integer(sample.elapsed_ms, 0, 86400000) &&
		(sample.phase === 'rest' || sample.phase === 'raise' || sample.phase === 'hold' || sample.phase === 'lower');
}

export class FeedbackChannel {
	private enabled = false;
	private disposed = false;
	private failed = false;
	private sample: FeedbackSample | null = null;
	private blocked = false;
	private quietSince = 0;
	private socket: WebSocket | null = null;
	private generation = 0;
	private ready = false;
	private requestId = 0;
	private nextRequestAt = 0;
	private pending: { id: number; sentAt: number; suppressed: boolean } | null = null;
	private state: FeedbackState = { status: 'disabled', message: '' };
	private scheduledAt = 0;
	private scheduleTimer: ReturnType<typeof setTimeout> | undefined;
	private connectionTimer: ReturnType<typeof setTimeout> | undefined;
	private requestTimer: ReturnType<typeof setTimeout> | undefined;
	private messageTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly sessionId: string, private readonly onstate: (state: FeedbackState) => void) {
		this.onstate({ ...this.state });
	}

	setEnabled(enabled: boolean): void {
		if (this.disposed || this.enabled === enabled) return;
		this.enabled = enabled;
		this.failed = false;
		if (!enabled) {
			this.disconnect();
			this.publish('disabled', '');
			return;
		}
		this.quietSince = performance.now();
		this.advance();
	}

	update(sample: FeedbackSample | null, blocked = false): void {
		if (this.disposed) return;
		if (sample === null) {
			this.sample = null;
			this.blocked = false;
			this.disconnect();
			this.publish(this.enabled ? 'idle' : 'disabled', '');
			return;
		}
		if (!validSample(sample)) {
			this.sample = null;
			this.fail();
			return;
		}
		if (this.sample === null || this.sample.set_ordinal !== sample.set_ordinal || sample.elapsed_ms < this.sample.elapsed_ms) {
			this.disconnect();
			this.quietSince = performance.now();
		}
		if (this.blocked && !blocked) this.quietSince = performance.now();
		this.sample = { ...sample };
		this.blocked = blocked;
		if (blocked) {
			if (this.pending) this.pending.suppressed = true;
			this.clearMessage();
		}
		this.advance();
	}

	retry(): void {
		if (this.disposed || !this.enabled || this.sample === null || !this.failed) return;
		this.failed = false;
		this.disconnect();
		this.quietSince = performance.now();
		this.advance();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.sample = null;
		this.disconnect();
	}

	private publish(status: FeedbackState['status'], message = this.state.message): void {
		if (this.disposed || (this.state.status === status && this.state.message === message)) return;
		this.state = { status, message };
		this.onstate({ ...this.state });
	}

	private clearSchedule(): void {
		clearTimeout(this.scheduleTimer);
		this.scheduleTimer = undefined;
		this.scheduledAt = 0;
	}

	private clearMessage(): void {
		clearTimeout(this.messageTimer);
		this.messageTimer = undefined;
		this.publish(this.state.status, '');
	}

	private disconnect(): void {
		this.generation += 1;
		this.clearSchedule();
		clearTimeout(this.connectionTimer);
		clearTimeout(this.requestTimer);
		clearTimeout(this.messageTimer);
		this.connectionTimer = undefined;
		this.requestTimer = undefined;
		this.messageTimer = undefined;
		this.pending = null;
		this.ready = false;
		const socket = this.socket;
		this.socket = null;
		if (socket) {
			socket.onopen = null;
			socket.onmessage = null;
			socket.onerror = null;
			socket.onclose = null;
			socket.close();
		}
	}

	private fail(): void {
		this.failed = true;
		this.disconnect();
		this.publish(this.enabled ? 'unavailable' : 'disabled', '');
	}

	private connect(): void {
		if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
			this.fail();
			return;
		}
		this.publish('connecting', '');
		const generation = this.generation;
		let socket: WebSocket;
		try {
			const url = new URL(`/api/patient/sessions/${encodeURIComponent(this.sessionId)}/feedback`, window.location.href);
			url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			socket = new WebSocket(url);
		} catch {
			this.fail();
			return;
		}
		this.socket = socket;
		const current = () => !this.disposed && this.enabled && this.sample !== null &&
			this.generation === generation && this.socket === socket;
		this.connectionTimer = setTimeout(() => {
			if (current()) this.fail();
		}, 10000);
		socket.onerror = () => {
			if (current()) this.fail();
		};
		socket.onclose = () => {
			if (current()) this.fail();
		};
		socket.onmessage = (event) => {
			if (!current()) return;
			const packet = parsePacket(event.data);
			if (packet === null) {
				this.fail();
				return;
			}
			if (packet.type === 'ready') {
				if (this.ready) {
					this.fail();
					return;
				}
				clearTimeout(this.connectionTimer);
				this.connectionTimer = undefined;
				this.ready = true;
				this.publish('ready', '');
				this.advance();
				return;
			}
			if (!this.ready) {
				this.fail();
				return;
			}
			const pending = this.pending;
			if (pending === null || packet.request_id !== pending.id) return;
			clearTimeout(this.requestTimer);
			this.requestTimer = undefined;
			this.pending = null;
			const now = performance.now();
			if (now - pending.sentAt > 15000) {
				this.publish('ready', '');
				this.advance();
				return;
			}
			if (packet.type === 'unavailable') {
				this.fail();
				return;
			}
			if (packet.type === 'cooldown') {
				this.nextRequestAt = Math.max(this.nextRequestAt, now + packet.retry_after_ms);
				this.publish('ready', '');
			} else if (!this.blocked && !pending.suppressed && now - this.quietSince >= 3000) {
				clearTimeout(this.messageTimer);
				this.publish('ready', packet.message);
				this.messageTimer = setTimeout(() => {
					if (current()) this.clearMessage();
				}, 10000);
			} else {
				this.publish('ready', '');
			}
			this.advance();
		};
	}

	private advance(): void {
		if (this.disposed) return;
		if (!this.enabled || this.sample === null) {
			this.publish(this.enabled ? 'idle' : 'disabled', '');
			return;
		}
		if (this.failed) {
			this.publish('unavailable', '');
			return;
		}
		if (this.socket === null) {
			this.connect();
			return;
		}
		if (!this.ready || this.pending !== null || this.blocked) {
			this.clearSchedule();
			return;
		}
		const now = performance.now();
		const due = Math.max(this.nextRequestAt, this.quietSince + 3000);
		if (this.sample.elapsed_ms < 5000) {
			this.clearSchedule();
			return;
		}
		if (due > now) {
			if (this.scheduleTimer !== undefined && this.scheduledAt === due) return;
			this.clearSchedule();
			this.scheduledAt = due;
			this.scheduleTimer = setTimeout(() => {
				this.scheduleTimer = undefined;
				this.scheduledAt = 0;
				this.advance();
			}, due - now);
			return;
		}
		this.clearSchedule();
		if (this.requestId === 2147483647 || this.socket.readyState !== WebSocket.OPEN) {
			this.fail();
			return;
		}
		const id = ++this.requestId;
		this.pending = { id, sentAt: now, suppressed: false };
		this.nextRequestAt = now + 30000;
		this.clearMessage();
		this.publish('waiting', '');
		try {
			this.socket.send(JSON.stringify({
				type: 'feedback',
				request_id: id,
				set_ordinal: this.sample.set_ordinal,
				reps_completed: this.sample.reps_completed,
				elapsed_ms: this.sample.elapsed_ms,
				phase: this.sample.phase
			}));
		} catch {
			this.fail();
			return;
		}
		this.requestTimer = setTimeout(() => {
			if (!this.disposed && this.pending?.id === id) this.fail();
		}, 15000);
	}
}
