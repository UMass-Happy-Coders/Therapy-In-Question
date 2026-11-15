import type { HandLandmarker, Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { TrackedSide } from '#lib/pose/framing.js';

export type HandTrackerStatus = 'loading' | 'tracking' | 'error';

export interface HandTrackingOptions {
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	onFrame: (
		normalized: readonly NormalizedLandmark[] | undefined,
		world: readonly Landmark[] | undefined,
		side: TrackedSide | null,
		score: number,
		timestamp: number
	) => void;
	onStatus: (status: HandTrackerStatus, error?: string) => void;
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FRAME_INTERVAL_MS = 40;
const STALE_FRAME_MS = 500;

function drawable(point: NormalizedLandmark | undefined): point is NormalizedLandmark {
	return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y) &&
		point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function startHandTracking(options: HandTrackingOptions): () => void {
	const { video, canvas, onFrame, onStatus } = options;
	const document = canvas.ownerDocument;
	const context = canvas.getContext('2d');
	const palette = getComputedStyle(canvas);
	const lineColor = palette.getPropertyValue('--ash-grey').trim() || '#c0caad';
	const pointColor = palette.getPropertyValue('--golden-sand').trim() || '#cec075';
	let landmarker: HandLandmarker | undefined;
	let connections: Readonly<typeof HandLandmarker.HAND_CONNECTIONS> = [];
	let stopped = false;
	let detecting = false;
	let animationFrame: number | undefined;
	let lastVideoTime = -1;
	let lastInferenceAt = -Infinity;
	let lastFreshAt = performance.now();
	let invalidated = false;

	function invalidate(timestamp: number) {
		context?.clearRect(0, 0, canvas.width, canvas.height);
		if (!invalidated) {
			invalidated = true;
			onFrame(undefined, undefined, null, 0, timestamp);
		}
	}

	function closeLandmarker() {
		const current = landmarker;
		landmarker = undefined;
		current?.close();
	}

	function stop() {
		if (stopped) return;
		stopped = true;
		if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
		animationFrame = undefined;
		document.removeEventListener('visibilitychange', visibilityChanged);
		for (const event of ['pause', 'ended', 'emptied', 'waiting']) video.removeEventListener(event, videoUnavailable);
		video.removeEventListener('error', videoFailed);
		try {
			invalidate(performance.now());
		} finally {
			if (!detecting) closeLandmarker();
		}
	}

	function fail(error: unknown) {
		if (stopped) return;
		try {
			stop();
		} finally {
			onStatus('error', error instanceof Error ? error.message : String(error));
		}
	}

	function videoUnavailable() {
		if (!stopped) invalidate(performance.now());
	}

	function videoFailed() {
		fail(new Error(video.error?.message || 'Camera video is unavailable.'));
	}

	function schedule() {
		if (!stopped && !document.hidden && animationFrame === undefined) animationFrame = requestAnimationFrame(tick);
	}

	function visibilityChanged() {
		if (stopped) return;
		if (document.hidden) {
			if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
			animationFrame = undefined;
			invalidate(performance.now());
		} else {
			lastFreshAt = performance.now();
			if (landmarker) schedule();
		}
	}

	function tick() {
		animationFrame = undefined;
		if (stopped || document.hidden || !landmarker) return;
		const now = performance.now();
		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 &&
			video.videoHeight > 0 && !video.paused && !video.ended &&
			video.currentTime !== lastVideoTime && now - lastInferenceAt >= FRAME_INTERVAL_MS) {
			lastVideoTime = video.currentTime;
			lastInferenceAt = now;
			lastFreshAt = now;
			detecting = true;
			try {
				const result = landmarker.detectForVideo(video, now);
				if (stopped || document.hidden) return;
				const points = result.landmarks[0];
				const world = result.worldLandmarks[0];
				const category = result.handedness[0]?.[0];
				const name = category?.categoryName.toLowerCase();
				const side = name === 'left' || name === 'right' ? name : null;
				if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
				if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
				context!.clearRect(0, 0, canvas.width, canvas.height);
				if (points?.length === 21) {
					context!.strokeStyle = lineColor;
					context!.lineWidth = Math.max(2, canvas.width / 480);
					context!.lineCap = 'round';
					context!.beginPath();
					for (const connection of connections) {
						const first = points[connection.start];
						const last = points[connection.end];
						if (!drawable(first) || !drawable(last)) continue;
						context!.moveTo(first.x * canvas.width, first.y * canvas.height);
						context!.lineTo(last.x * canvas.width, last.y * canvas.height);
					}
					context!.stroke();
					context!.fillStyle = pointColor;
					context!.beginPath();
					const radius = Math.max(3, canvas.width / 240);
					for (const point of points) {
						if (!drawable(point)) continue;
						const x = point.x * canvas.width;
						const y = point.y * canvas.height;
						context!.moveTo(x + radius, y);
						context!.arc(x, y, radius, 0, Math.PI * 2);
					}
					context!.fill();
				}
				invalidated = false;
				onFrame(points, world, side, category?.score ?? 0, now);
			} catch (error) {
				fail(error);
			} finally {
				detecting = false;
				if (stopped) closeLandmarker();
			}
		} else if (now - lastFreshAt >= STALE_FRAME_MS) invalidate(now);
		schedule();
	}

	async function initialize() {
		try {
			if (!context) throw new Error('Hand overlay is unavailable.');
			const vision = await import('@mediapipe/tasks-vision');
			if (stopped) return;
			const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
			if (stopped) return;
			const model = await vision.HandLandmarker.createFromOptions(fileset, {
				baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
				runningMode: 'VIDEO',
				numHands: 1,
				minHandDetectionConfidence: 0.65,
				minHandPresenceConfidence: 0.65,
				minTrackingConfidence: 0.65
			});
			if (stopped) {
				model.close();
				return;
			}
			landmarker = model;
			connections = vision.HandLandmarker.HAND_CONNECTIONS;
			lastFreshAt = performance.now();
			onStatus('tracking');
			schedule();
		} catch (error) {
			fail(error);
		}
	}

	document.addEventListener('visibilitychange', visibilityChanged);
	for (const event of ['pause', 'ended', 'emptied', 'waiting']) video.addEventListener(event, videoUnavailable);
	video.addEventListener('error', videoFailed);
	onStatus('loading');
	invalidate(performance.now());
	void initialize();
	return stop;
}
