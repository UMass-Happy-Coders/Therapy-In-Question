import type {
	NormalizedLandmark,
	PoseLandmarker,
	PoseLandmarkerResult
} from '@mediapipe/tasks-vision';

export type TrackerStatus = 'loading' | 'tracking' | 'error';

export interface PoseTrackingOptions {
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	onFrame: (landmarks: readonly NormalizedLandmark[] | undefined, timestamp: number) => void;
	onStatus: (status: TrackerStatus, error?: string) => void;
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FRAME_INTERVAL_MS = 40;
const STALE_FRAME_MS = 500;
const DRAW_CONFIDENCE = 0.35;

function drawable(point: NormalizedLandmark | undefined): point is NormalizedLandmark {
	return point !== undefined &&
		point.visibility >= DRAW_CONFIDENCE &&
		(point.presence === undefined || point.presence >= DRAW_CONFIDENCE) &&
		Number.isFinite(point.x) && Number.isFinite(point.y) &&
		point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function startPoseTracking(options: PoseTrackingOptions): () => void {
	const { video, canvas, onFrame, onStatus } = options;
	const document = canvas.ownerDocument;
	const context = canvas.getContext('2d');
	const palette = getComputedStyle(canvas);
	const lineColor = palette.getPropertyValue('--ash-grey').trim() || '#c0caad';
	const pointColor = palette.getPropertyValue('--golden-sand').trim() || '#cec075';
	let landmarker: PoseLandmarker | undefined;
	let connections: Readonly<typeof PoseLandmarker.POSE_CONNECTIONS> = [];
	let stopped = false;
	let detecting = false;
	let animationFrame: number | undefined;
	let lastVideoTime = -1;
	let lastInferenceAt = -Infinity;
	let lastFreshAt = performance.now();
	let invalidated = false;

	function clearCanvas() {
		context?.clearRect(0, 0, canvas.width, canvas.height);
	}

	function invalidate(timestamp: number) {
		clearCanvas();
		if (!invalidated) {
			invalidated = true;
			onFrame(undefined, timestamp);
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
		if (animationFrame !== undefined) {
			cancelAnimationFrame(animationFrame);
			animationFrame = undefined;
		}
		document.removeEventListener('visibilitychange', visibilityChanged);
		video.removeEventListener('pause', videoUnavailable);
		video.removeEventListener('ended', videoUnavailable);
		video.removeEventListener('emptied', videoUnavailable);
		video.removeEventListener('waiting', videoUnavailable);
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
		if (!stopped && !document.hidden && animationFrame === undefined) {
			animationFrame = requestAnimationFrame(tick);
		}
	}

	function visibilityChanged() {
		if (stopped) return;
		if (document.hidden) {
			if (animationFrame !== undefined) {
				cancelAnimationFrame(animationFrame);
				animationFrame = undefined;
			}
			invalidate(performance.now());
		} else {
			lastFreshAt = performance.now();
			if (landmarker) schedule();
		}
	}

	function receiveResult(result: PoseLandmarkerResult) {
		if (stopped || document.hidden || !context) return;
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		clearCanvas();
		const points = result.landmarks[0];
		if (points !== undefined && points.length > 0) {
			context.strokeStyle = lineColor;
			context.lineWidth = Math.max(2, width / 480);
			context.lineCap = 'round';
			context.beginPath();
			for (const connection of connections) {
				const start = points[connection.start];
				const end = points[connection.end];
				if (!drawable(start) || !drawable(end)) continue;
				context.moveTo(start.x * width, start.y * height);
				context.lineTo(end.x * width, end.y * height);
			}
			context.stroke();
			context.fillStyle = pointColor;
			context.beginPath();
			const radius = Math.max(3, width / 240);
			for (const point of points) {
				if (!drawable(point)) continue;
				const x = point.x * width;
				const y = point.y * height;
				context.moveTo(x + radius, y);
				context.arc(x, y, radius, 0, Math.PI * 2);
			}
			context.fill();
		}
		invalidated = false;
		onFrame(points !== undefined && points.length > 0 ? points : undefined, performance.now());
	}

	function tick() {
		animationFrame = undefined;
		if (stopped || document.hidden || !landmarker) return;
		const now = performance.now();
		if (
			video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
			video.videoWidth > 0 && video.videoHeight > 0 &&
			!video.paused && !video.ended &&
			video.currentTime !== lastVideoTime &&
			now - lastInferenceAt >= FRAME_INTERVAL_MS
		) {
			lastVideoTime = video.currentTime;
			lastInferenceAt = now;
			lastFreshAt = now;
			detecting = true;
			try {
				landmarker.detectForVideo(video, now, receiveResult);
			} catch (error) {
				fail(error);
			} finally {
				detecting = false;
				if (stopped) closeLandmarker();
			}
		} else if (now - lastFreshAt >= STALE_FRAME_MS) {
			invalidate(now);
		}
		schedule();
	}

	async function initialize() {
		try {
			if (!context) throw new Error('Pose overlay is unavailable.');
			const vision = await import('@mediapipe/tasks-vision');
			if (stopped) return;
			const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
			if (stopped) return;
			const model = await vision.PoseLandmarker.createFromOptions(fileset, {
				baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
				runningMode: 'VIDEO',
				numPoses: 1,
				minPoseDetectionConfidence: 0.5,
				minPosePresenceConfidence: 0.5,
				minTrackingConfidence: 0.5,
				outputSegmentationMasks: false
			});
			if (stopped) {
				model.close();
				return;
			}
			landmarker = model;
			connections = vision.PoseLandmarker.POSE_CONNECTIONS;
			lastFreshAt = performance.now();
			onStatus('tracking');
			schedule();
		} catch (error) {
			fail(error);
		}
	}

	document.addEventListener('visibilitychange', visibilityChanged);
	video.addEventListener('pause', videoUnavailable);
	video.addEventListener('ended', videoUnavailable);
	video.addEventListener('emptied', videoUnavailable);
	video.addEventListener('waiting', videoUnavailable);
	video.addEventListener('error', videoFailed);
	onStatus('loading');
	invalidate(performance.now());
	void initialize();
	return stop;
}
