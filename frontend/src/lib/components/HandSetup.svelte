<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
	import Webcam from '#lib/components/Webcam.svelte';
	import ExerciseTutorial from '#lib/components/ExerciseTutorial.svelte';
	import RepProgress from '#lib/components/RepProgress.svelte';
	import LiveFeedback from '#lib/components/LiveFeedback.svelte';
	import { startHandTracking, type HandTrackerStatus } from '#lib/hand/tracker.js';
	import { OneEuroFilter } from '#lib/pose/one-euro.js';
	import { jointAngle } from '#lib/pose/geometry.js';
	import { RepCounter, type RepSample } from '#lib/pose/rep-counter.js';
	import { createRepProfile, type RepPhase } from '#lib/pose/rep-profile.js';
	import { RecordingCountdown, startingPositionReady, type CountdownState } from '#lib/pose/recording-countdown.js';
	import { movementCue } from '#lib/pose/local-feedback.js';
	import type { TrackedSide } from '#lib/pose/framing.js';
	import type { PoseCapture } from '#lib/pose/recording.js';
	import type { ProgramExercise } from '#lib/programs.js';
	import type { SetResult } from '#lib/sessions.js';

	let { exercise, onfinish, finishLabel = 'Finish exercise', onrecord, recordingReady = true, sessionId, setOrdinal = 0 }: {
		exercise: ProgramExercise;
		onfinish?: (result: SetResult) => void;
		finishLabel?: string;
		onrecord?: (frame: Omit<PoseCapture, 'setOrdinal' | 'exerciseId'>) => boolean;
		recordingReady?: boolean;
		sessionId?: string;
		setOrdinal?: number;
	} = $props();

	const profile = untrack(() => createRepProfile(exercise));
	const counter = untrack(() => new RepCounter(profile));
	const filter = new OneEuroFilter();
	const requiredPoints = [0, 5, 6, 7, 8];
	let video = $state<HTMLVideoElement>();
	let canvas = $state<HTMLCanvasElement>();
	let live = $state(false);
	let tutorialComplete = $state(false);
	let session = $state<'setup' | 'running' | 'paused' | 'finished'>('setup');
	let status = $state<HandTrackerStatus>('loading');
	let modelError = $state('');
	let retry = $state(0);
	let reliableHand = $state(false);
	let detectedSide = $state<TrackedSide | null>(null);
	let lockedSide = $state<TrackedSide | null>(null);
	let candidateSide: TrackedSide | null = null;
	let finger = $state<number | null>(null);
	let rawFinger: number | null = null;
	let reps = $state(0);
	let phase = $state<RepPhase>('rest');
	let holdElapsedMs = $state(0);
	let repCue = $state<string | null>(null);
	let preparation = $state<CountdownState>({ armed: false, remaining: null });
	let preparationNotice = $state('');
	let positionReady = false;
	let countdown: RecordingCountdown | null = null;
	let elapsedMs = $state(0);
	let accumulatedMs = 0;
	let runningSince = 0;
	let lastFrameAt = 0;
	let lastUsableAt = 0;
	let generation = 0;
	let runId = '';
	let stopTracker: (() => void) | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;

	const finished = $derived(session === 'finished');
	const canBegin = $derived(live && status === 'tracking' && reliableHand &&
		finger !== null && profile.configurationError === null && recordingReady && !finished);
	const selectedHand = $derived(lockedSide ?? detectedSide);
	const feedbackCue = $derived(preparation.armed
		? preparation.remaining === null ? 'Keep one hand in view and gently straighten your index finger.' : `Starting in ${preparation.remaining}.`
		: movementCue(exercise, session, phase, reps, holdElapsedMs, repCue));
	const elapsedSeconds = $derived(Math.floor(elapsedMs / 1000));
	const elapsed = $derived(`${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`);
	const trackingStatus = $derived(finished ? 'Exercise finished' : !live ? 'Camera off' :
		status === 'error' ? 'Hand detection unavailable' : status === 'loading' ? 'Loading hand detection' :
		lockedSide && detectedSide && lockedSide !== detectedSide ? `Use the same ${lockedSide} hand for this set.` :
		reliableHand ? 'Hand visible' : 'Keep your wrist and index finger in view, close enough to the camera.');

	function copyCounter() {
		reps = counter.reps;
		phase = counter.phase;
		holdElapsedMs = counter.holdElapsedMs;
		repCue = counter.cue;
	}

	function captureRunning(current: HTMLVideoElement) {
		const stream = current.srcObject;
		return stream instanceof MediaStream && stream.getVideoTracks().some((track) =>
			track.readyState === 'live' && !track.muted) && !current.paused && !current.ended &&
			current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
	}

	function clearHand() {
		reliableHand = false;
		detectedSide = null;
		candidateSide = null;
		finger = null;
		rawFinger = null;
		positionReady = false;
		lastFrameAt = 0;
		lastUsableAt = 0;
		filter.reset();
	}

	function requestPreparation() {
		if (!tutorialComplete || finished || session === 'running' || document.hidden || !countdown) return;
		if (preparation.armed) return;
		preparationNotice = '';
		positionReady = false;
		if (session === 'setup') counter.reset();
		else counter.suspend();
		copyCounter();
		countdown.arm();
	}

	function cancelCountdown() {
		countdown?.cancel();
		positionReady = false;
		preparationNotice = 'Countdown canceled. Start it again when ready.';
	}

	function prepareCamera() {
		tutorialComplete = true;
		requestPreparation();
	}

	function pauseExercise(reason: string | null = null) {
		countdown?.cancel();
		positionReady = false;
		if (session === 'running') {
			accumulatedMs += performance.now() - runningSince;
			elapsedMs = accumulatedMs;
			session = 'paused';
			counter.suspend();
			copyCounter();
		}
		if (reason !== null && session !== 'finished') {
			repCue = reason;
			preparationNotice = reason;
		}
	}

	function beginPreparedExercise(): boolean {
		if (!canBegin || !positionReady || !detectedSide || !video || !captureRunning(video) ||
			document.hidden || performance.now() - lastFrameAt > 500 ||
			(lockedSide !== null && detectedSide !== lockedSide) ||
			(session !== 'setup' && session !== 'paused')) return false;
		lockedSide ??= detectedSide;
		if (!runId) runId = crypto.randomUUID();
		runningSince = performance.now();
		lastUsableAt = runningSince;
		preparationNotice = '';
		session = 'running';
		return true;
	}

	function stopCamera() {
		generation += 1;
		stopTracker?.();
		stopTracker = undefined;
		const stream = video?.srcObject;
		if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
		if (video) video.srcObject = null;
		live = false;
	}

	function finishExercise() {
		if (finished) return;
		pauseExercise();
		counter.suspend();
		copyCounter();
		session = 'finished';
		countdown?.dispose();
		if (clock !== undefined) clearInterval(clock);
		clock = undefined;
		stopCamera();
		onfinish?.({
			reps_completed: reps,
			elapsed_seconds: Math.round(elapsedMs) / 1000,
			rep_metrics: counter.measurements.slice()
		});
	}

	function reviewMovement() {
		pauseExercise();
		stopCamera();
		clearHand();
		tutorialComplete = false;
	}

	function retryDetection() {
		if (!live || finished) return;
		pauseExercise();
		modelError = '';
		retry += 1;
	}

	function validHand(points: readonly NormalizedLandmark[] | undefined, world: readonly Landmark[] | undefined,
		side: TrackedSide | null, score: number, currentVideo: HTMLVideoElement): boolean {
		if (!points || !world || points.length !== 21 || world.length !== 21 || !side ||
			!Number.isFinite(score) || score < 0.65 || (lockedSide !== null && lockedSide !== side)) return false;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const index of requiredPoints) {
			const point = points[index];
			const spatial = world[index];
			if (!point || !spatial || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
				!Number.isFinite(point.z) || !Number.isFinite(spatial.x) || !Number.isFinite(spatial.y) ||
				!Number.isFinite(spatial.z) || point.x < 0.03 || point.x > 0.97 || point.y < 0.03 || point.y > 0.97) return false;
			minX = Math.min(minX, point.x);
			maxX = Math.max(maxX, point.x);
			minY = Math.min(minY, point.y);
			maxY = Math.max(maxY, point.y);
		}
		const span = Math.hypot((maxX - minX) * currentVideo.videoWidth, (maxY - minY) * currentVideo.videoHeight);
		const segment = Math.hypot((points[5].x - points[6].x) * currentVideo.videoWidth,
			(points[5].y - points[6].y) * currentVideo.videoHeight);
		return span >= 90 && segment >= 10;
	}

	onMount(() => {
		countdown = new RecordingCountdown((state) => preparation = state, () => {
			if (!beginPreparedExercise()) preparationNotice = 'Your hand position changed. Start another countdown when ready.';
		});
		const keydown = (event: KeyboardEvent) => {
			if (!tutorialComplete || finished || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
			if (event.key === 'Escape' && (preparation.armed || session === 'running')) {
				event.preventDefault();
				if (session === 'running') pauseExercise();
				else cancelCountdown();
				return;
			}
			if (event.code !== 'Space' || event.target instanceof HTMLElement &&
				event.target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
			event.preventDefault();
			if (session === 'running') pauseExercise();
			else if (preparation.armed) cancelCountdown();
			else requestPreparation();
		};
		const visibilityChanged = () => {
			if (document.hidden) pauseExercise('Exercise paused while this page is hidden.');
		};
		window.addEventListener('keydown', keydown);
		document.addEventListener('visibilitychange', visibilityChanged);
		clock = setInterval(() => {
			if (finished) return;
			const now = performance.now();
			if (session === 'running') {
				elapsedMs = accumulatedMs + now - runningSince;
				if (!recordingReady) pauseExercise('Movement recording unavailable.');
				else if (!video || !live || !captureRunning(video)) pauseExercise('Camera unavailable.');
				else if (now - lastUsableAt > 1000) pauseExercise('Hand tracking lost. Resume with a countdown when ready.');
			}
			if (lastFrameAt && now - lastFrameAt > 500) {
				reliableHand = false;
				finger = null;
				positionReady = false;
				countdown?.update(false, now);
			}
		}, 100);
		return () => {
			window.removeEventListener('keydown', keydown);
			document.removeEventListener('visibilitychange', visibilityChanged);
		};
	});

	$effect(() => {
		const currentVideo = video;
		const currentCanvas = canvas;
		const currentLive = live;
		const complete = finished;
		retry;
		return untrack(() => {
			const token = ++generation;
			clearHand();
			if (session === 'running') pauseExercise('Camera tracking unavailable.');
			else countdown?.update(false, performance.now());
			status = 'loading';
			if (!currentVideo || !currentCanvas || !currentLive || complete) return;
			function refreshCapture() {
				if (generation !== token) return;
				if (!captureRunning(currentVideo!)) {
					clearHand();
					pauseExercise('Camera unavailable.');
				}
			}
			const stream = currentVideo.srcObject;
			const tracks = stream instanceof MediaStream ? stream.getVideoTracks() : [];
			const events = ['playing', 'pause', 'ended', 'emptied', 'loadeddata', 'waiting'];
			for (const event of events) currentVideo.addEventListener(event, refreshCapture);
			for (const track of tracks) {
				track.addEventListener('ended', refreshCapture);
				track.addEventListener('mute', refreshCapture);
				track.addEventListener('unmute', refreshCapture);
			}
			const stop = startHandTracking({
				video: currentVideo,
				canvas: currentCanvas,
				onFrame(points, world, side, score, timestamp) {
					if (generation !== token || finished) return;
					lastFrameAt = timestamp;
					if (!captureRunning(currentVideo) || document.hidden) {
						clearHand();
						pauseExercise(document.hidden ? 'Exercise not visible.' : 'Camera unavailable.');
						return;
					}
					detectedSide = side;
					if (side !== null && score >= 0.65 && candidateSide !== side) {
						filter.reset();
						counter.suspend();
						copyCounter();
						countdown?.update(false, timestamp);
						candidateSide = side;
					}
					if (lockedSide && side && score >= 0.65 && lockedSide !== side) {
						reliableHand = false;
						finger = null;
						rawFinger = null;
						pauseExercise(`Use the same ${lockedSide} hand for this set.`);
						return;
					}
					const usable = validHand(points, world, side, score, currentVideo);
					const angle = usable ? jointAngle(world![5], world![6], world![7]) : null;
					rawFinger = angle === null ? null : 180 - angle;
					finger = rawFinger === null ? null : filter.filter(rawFinger, timestamp);
					reliableHand = usable && finger !== null;
					if (!reliableHand) {
						positionReady = false;
						countdown?.update(false, timestamp);
						if (session === 'running' && timestamp - lastUsableAt > 1000) pauseExercise('Hand tracking lost. Resume with a countdown when ready.');
						return;
					}
					if (session === 'running' && timestamp - lastUsableAt > 1000) {
						pauseExercise('Hand tracking lost. Resume with a countdown when ready.');
						lastUsableAt = timestamp;
						return;
					}
					lastUsableAt = timestamp;
					const sample: RepSample = { timestamp, finger, knee: null, hip: null, ankle: null, hipY: null, torsoHeight: null };
					const wasRunning = session === 'running';
					if (!wasRunning && preparation.armed) {
						positionReady = canBegin && rawFinger !== null && rawFinger < 12 && finger! < 12 && startingPositionReady(profile, sample);
						if (positionReady) counter.update(sample);
						else counter.suspend();
						copyCounter();
						countdown?.update(positionReady, timestamp);
					}
					if (!wasRunning || session !== 'running') return;
					if (!recordingReady) {
						pauseExercise('Movement recording unavailable.');
						return;
					}
					counter.update(sample);
					copyCounter();
					if (onrecord && points && world && side) {
						try {
							if (!onrecord({ landmarks: points, worldLandmarks: world, timestamp,
								elapsedMs: accumulatedMs + timestamp - runningSince, phase, reps,
								cue: feedbackCue, side, runId })) pauseExercise('Movement recording buffer full.');
						} catch {
							pauseExercise('Movement recording unavailable.');
						}
					}
				},
				onStatus(next, error) {
					if (generation !== token) return;
					status = next;
					modelError = error ?? '';
					if (next !== 'tracking') {
						clearHand();
						if (session === 'running' || next === 'error') pauseExercise('Hand detection unavailable.');
						else countdown?.update(false, performance.now());
					}
				}
			});
			stopTracker = stop;
			return () => {
				generation += 1;
				stop();
				if (stopTracker === stop) stopTracker = undefined;
				for (const event of events) currentVideo.removeEventListener(event, refreshCapture);
				for (const track of tracks) {
					track.removeEventListener('ended', refreshCapture);
					track.removeEventListener('mute', refreshCapture);
					track.removeEventListener('unmute', refreshCapture);
				}
			};
		});
	});

	onDestroy(() => {
		countdown?.dispose();
		if (clock !== undefined) clearInterval(clock);
		stopCamera();
	});
</script>

{#if !tutorialComplete}
	<ExerciseTutorial {exercise} oncontinue={prepareCamera} />
{:else}
	<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
		<div class="w-full max-w-[960px]">
			<RepProgress exerciseType={exercise.exercise_type} {reps} {phase} {holdElapsedMs} holdMs={exercise.hold_seconds * 1000} />
			<section aria-label="Hand exercise camera" class="relative">
				{#if !finished}
					<Webcam bind:video bind:live autostart />
					<canvas bind:this={canvas} aria-hidden="true" class="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-contain"></canvas>
				{/if}
			</section>
			<LiveFeedback {sessionId} {setOrdinal} running={session === 'running'} preparing={preparation.armed}
				{finished} cue={feedbackCue} corrective={repCue !== null || reps >= exercise.reps} {reps} {phase} {elapsedMs} />
			<dl class="m-0 mt-5 grid grid-cols-2 gap-4 rounded-lg bg-[var(--surface)] p-5">
				<div>
					<dt class="text-sm">Selected hand</dt>
					<dd class="m-0 mt-1 text-xl font-semibold">{selectedHand ? selectedHand === 'left' ? 'Left hand' : 'Right hand' : 'Not detected'}</dd>
				</div>
				<div>
					<dt class="text-sm">Estimated index finger bend</dt>
					<dd class="m-0 mt-1 text-xl font-semibold tabular-nums"><output aria-label="Estimated index finger bend">{finger === null ? 'Unavailable' : `${Math.round(finger)} degrees`}</output></dd>
				</div>
			</dl>
		</div>
		<section aria-labelledby="hand-controls-heading" class="rounded-lg bg-[var(--surface)] p-6 lg:sticky lg:top-6">
			<h2 id="hand-controls-heading" class="mb-5">Finger exercise controls</h2>
			<p role="status" class="mb-5 font-semibold">{trackingStatus}</p>
			{#if profile.configurationError}<p role="alert" class="text-[var(--error)]">{profile.configurationError}</p>{/if}
			<dl class="m-0 mb-6">
				<dt>Active time</dt>
				<dd class="m-0 text-3xl font-semibold tabular-nums"><output aria-label="Exercise elapsed time">{elapsed}</output></dd>
			</dl>
			{#if !finished}
				{#if session === 'running'}
					<button class="min-h-14 w-full text-lg" onclick={() => pauseExercise()}>Pause exercise</button>
				{:else if preparation.armed}
					<p role="status" class="font-semibold">{preparation.remaining === null ? 'Gently straighten your index finger and keep your hand in view.' : 'Hold your hand steady. Starting in'}</p>
					{#if preparation.remaining !== null}<output aria-label="Countdown" class="mb-4 block text-6xl font-semibold tabular-nums">{preparation.remaining}</output>{/if}
					<button class="button-secondary min-h-14 w-full text-lg" onclick={cancelCountdown}>Cancel countdown</button>
				{:else}
					{#if session === 'paused'}<p class="font-semibold">Exercise paused</p>{/if}
					<button class="min-h-14 w-full text-lg" onclick={requestPreparation}>{session === 'setup' ? 'Start 5-second countdown' : 'Resume with countdown'}</button>
				{/if}
				{#if preparationNotice}<p role="status" class="mb-0 mt-3 text-sm">{preparationNotice}</p>{/if}
				<button class="button-secondary mt-3 min-h-14 w-full text-lg" onclick={finishExercise}>{finishLabel}</button>
				<button class="button-secondary mt-3 w-full" onclick={reviewMovement} disabled={session === 'running'}>Review the movement</button>
				{#if status === 'error'}
					<p role="alert" class="break-words text-sm text-[var(--error)]">{modelError || 'Hand detection could not start.'}</p>
					<button class="button-secondary mt-3 w-full" onclick={retryDetection} disabled={!live}>Retry hand detection</button>
				{/if}
				<p class="mb-0 mt-4 text-sm">Press Space to pause, request or cancel a countdown. Press Escape to pause or cancel.</p>
			{/if}
			<p class="mb-0 mt-5 text-sm">Stay seated with your hand supported. Move only within a pain-free range and stop if it hurts. For rehabilitation, use only the movement and target assigned by your therapist. Camera angles are estimates, not a strength measurement.</p>
		</section>
	</div>
{/if}
