<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import Webcam from '#lib/components/Webcam.svelte';
	import JointAngles from '#lib/components/JointAngles.svelte';
	import RepProgress from '#lib/components/RepProgress.svelte';
	import HandRaiseControls from '#lib/components/HandRaiseControls.svelte';
	import LiveFeedback from '#lib/components/LiveFeedback.svelte';
	import ExerciseTutorial from '#lib/components/ExerciseTutorial.svelte';
	import { JointAngleEstimator } from '#lib/pose/angles.js';
	import { FramingGate, type RequiredJoint, type TrackedSide } from '#lib/pose/framing.js';
	import { HandRaiseGesture, type HandRaiseState } from '#lib/pose/hand-raise.js';
	import { RepCounter, makeRepSample } from '#lib/pose/rep-counter.js';
	import { createRepProfile, type RepPhase } from '#lib/pose/rep-profile.js';
	import { movementCue } from '#lib/pose/local-feedback.js';
	import { startPoseTracking, type TrackerStatus } from '#lib/pose/tracker.js';
	import { exerciseWalkthrough } from '#lib/pose/exercise-tutorial.js';
	import { RecordingCountdown, startingPositionReady, type CountdownState } from '#lib/pose/recording-countdown.js';
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
	const handRaise = new HandRaiseGesture();

	let video = $state<HTMLVideoElement>();
	let canvas = $state<HTMLCanvasElement>();
	let live = $state(false);
	let captureAvailable = $state(false);
	let side = $state<TrackedSide>('left');
	let status = $state<TrackerStatus>('loading');
	let modelError = $state('');
	let retry = $state(0);
	let session = $state<'setup' | 'running' | 'paused' | 'finished'>('setup');
	let ready = $state(false);
	let hasPose = $state(false);
	let visibleMask = $state(0);
	let requiredMask = $state(0);
	let stabilizing = $state(false);
	let joints = $state<readonly RequiredJoint[]>([]);
	let kneeRaw = $state<number | null>(null);
	let kneeFiltered = $state<number | null>(null);
	let hipRaw = $state<number | null>(null);
	let hipFiltered = $state<number | null>(null);
	let ankleRaw = $state<number | null>(null);
	let ankleFiltered = $state<number | null>(null);
	let heightAvailable = $state(false);
	let reps = $state(0);
	let phase = $state<RepPhase>('rest');
	let holdElapsedMs = $state(0);
	let repCue = $state<string | null>(null);
	let handsFreeEnabled = $state(true);
	let handRaiseState = $state<HandRaiseState>('waiting');
	let handRaiseProgressMs = $state(0);
	let handRaiseAction = $state<'paused' | 'countdown' | 'canceled' | null>(null);
	let elapsedMs = $state(0);
	let gate: FramingGate;
	let angleEstimator: JointAngleEstimator;
	let generation = 0;
	let lastFrameAt = 0;
	let accumulatedMs = 0;
	let runningSince = 0;
	let clock: ReturnType<typeof setInterval> | undefined;
	let runId = '';
	let tutorialComplete = $state(false);
	let preparation = $state<CountdownState>({ armed: false, remaining: null });
	let preparationNotice = $state('');
	let positionReady = $state(false);
	let countdown: RecordingCountdown | null = null;
	let cameraHasRun = false;
	const walkthrough = untrack(() => exerciseWalkthrough(exercise));

	const finished = $derived(session === 'finished');
	const ankleExercise = $derived(exercise.exercise_type === 'seated_ankle_pumps');
	const feedbackCue = $derived(preparation.armed
		? preparation.remaining === null ? walkthrough.steps[0].instruction : `Starting in ${preparation.remaining}.`
		: movementCue(exercise, session, phase, reps, holdElapsedMs, repCue));
	const requiredAnglesReady = $derived(
		ankleExercise ? ankleFiltered !== null :
			kneeFiltered !== null &&
			(exercise.exercise_type === 'seated_knee_extension' || hipFiltered !== null)
	);
	const requiredHeightReady = $derived(
		exercise.exercise_type !== 'sit_to_stand' || heightAvailable
	);
	const canBegin = $derived(
		live && captureAvailable && status === 'tracking' && ready && requiredAnglesReady &&
		requiredHeightReady && profile.configurationError === null && !finished && recordingReady
	);
	const elapsedSeconds = $derived(Math.floor(elapsedMs / 1000));
	const elapsed = $derived(
		`${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`
	);
	const framingStatus = $derived(
		finished
			? 'Exercise finished'
			: !live || !captureAvailable
				? 'Camera off'
				: status === 'error'
					? 'Pose detection unavailable'
					: status === 'loading'
						? 'Loading pose detection'
						: ready
							? !requiredAnglesReady
								? 'Joint tracking unavailable'
								: !requiredHeightReady ? 'Hip height unavailable' : 'Joints visible'
							: !hasPose
								? 'Move back until your full body is visible'
								: stabilizing
									? 'Checking framing'
									: 'Joints not visible'
	);

	onMount(() => {
		countdown = new RecordingCountdown(
			(state) => preparation = state,
			() => {
				if (!beginPreparedExercise()) preparationNotice = 'Your position changed. Start another countdown when ready.';
			}
		);
		const keydown = (event: KeyboardEvent) => {
			if (!tutorialComplete || finished || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
			if (event.key === 'Escape' && (preparation.armed || session === 'running')) {
				event.preventDefault();
				if (session === 'running') pauseExercise();
				else cancelCountdown();
				return;
			}
			if (event.code !== 'Space' ||
				event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
			event.preventDefault();
			if (session === 'running') pauseExercise();
			else if (preparation.armed) cancelCountdown();
			else requestPreparation();
		};
		const visibilityChanged = () => {
			if (document.hidden) pauseExercise('Exercise not visible');
		};
		window.addEventListener('keydown', keydown);
		document.addEventListener('visibilitychange', visibilityChanged);
		return () => {
			window.removeEventListener('keydown', keydown);
			document.removeEventListener('visibilitychange', visibilityChanged);
		};
	});

	function requestPreparation(fromGesture = false): boolean {
		if (!tutorialComplete || finished || session === 'running' || document.hidden || !countdown) return false;
		if (preparation.armed) return true;
		if (!fromGesture) resetHandRaise();
		preparationNotice = '';
		positionReady = false;
		if (session === 'setup') counter.reset();
		else counter.suspend();
		copyCounter();
		countdown.arm();
		return true;
	}

	function cancelCountdown() {
		countdown?.cancel();
		positionReady = false;
		preparationNotice = 'Countdown canceled. Start it again when you are ready.';
	}

	function prepareCamera() {
		tutorialComplete = true;
		requestPreparation();
	}

	function reviewMovement() {
		pauseExercise();
		preparationNotice = '';
		tutorialComplete = false;
	}

	function copyCounter() {
		reps = counter.reps;
		phase = counter.phase;
		holdElapsedMs = counter.holdElapsedMs;
		repCue = counter.cue;
	}

	function copyGate() {
		ready = gate.ready;
		hasPose = gate.hasPose;
		visibleMask = gate.visibleMask;
		requiredMask = gate.requiredMask;
		stabilizing = gate.stabilizing;
		joints = gate.joints;
	}

	function resetHandRaise() {
		handRaise.reset();
		handRaiseState = handRaise.state;
		handRaiseProgressMs = 0;
		handRaiseAction = null;
	}
	function setHandsFreeEnabled(enabled: boolean) {
		handsFreeEnabled = enabled;
		resetHandRaise();
	}

	function clearFraming() {
		resetHandRaise();
		gate.reset();
		angleEstimator.reset();
		kneeRaw = null;
		kneeFiltered = null;
		hipRaw = null;
		hipFiltered = null;
		ankleRaw = null;
		ankleFiltered = null;
		heightAvailable = false;
		lastFrameAt = 0;
		copyGate();
	}

	function captureRunning(currentVideo: HTMLVideoElement) {
		const stream = currentVideo.srcObject;
		return (
			stream instanceof MediaStream &&
			stream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted) &&
			!currentVideo.paused &&
			!currentVideo.ended &&
			currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
		);
	}

	function pauseExercise(reason: string | null = null, fromGesture = false) {
		countdown?.cancel();
		positionReady = false;
		if (session !== 'running') return;
		if (!fromGesture) resetHandRaise();
		if (clock !== undefined) clearInterval(clock);
		clock = undefined;
		accumulatedMs += performance.now() - runningSince;
		elapsedMs = accumulatedMs;
		session = 'paused';
		counter.suspend();
		copyCounter();
		if (reason !== null) repCue = reason;
	}

	function beginPreparedExercise(): boolean {
		if (
			!canBegin ||
			!positionReady ||
			!video ||
			!captureRunning(video) ||
			document.hidden ||
			performance.now() - lastFrameAt > 500 ||
			(session !== 'setup' && session !== 'paused')
		) return false;
		if (!runId) runId = crypto.randomUUID();
		angleEstimator.lockAnkleNeutral();
		handRaiseAction = null;
		copyCounter();
		runningSince = performance.now();
		session = 'running';
		clock = setInterval(() => {
			elapsedMs = accumulatedMs + performance.now() - runningSince;
		}, 200);
		return true;
	}

	function finishExercise() {
		if (session !== 'running' && session !== 'paused') return;
		pauseExercise();
		counter.suspend();
		copyCounter();
		session = 'finished';
		onfinish?.({
			reps_completed: reps,
			elapsed_seconds: Math.round(elapsedMs) / 1000,
			rep_metrics: counter.measurements.slice()
		});
	}

	function selectSide(nextSide: TrackedSide) {
		if (session !== 'setup' || side === nextSide) return;
		generation += 1;
		clearFraming();
		counter.suspend();
		copyCounter();
		side = nextSide;
	}

	function retryDetection() {
		if (!live || status !== 'error' || finished) return;
		generation += 1;
		clearFraming();
		modelError = '';
		status = 'loading';
		retry += 1;
	}

	$effect(() => {
		const currentVideo = video;
		const currentCanvas = canvas;
		const currentLive = live;
		const currentSide = side;
		const exerciseType = exercise.exercise_type;
		const complete = finished;
		retry;

		return untrack(() => {
			if (!currentLive && cameraHasRun) countdown?.cancel();
			cameraHasRun = currentLive;
			const token = ++generation;
			gate = new FramingGate(exerciseType, currentSide);
			angleEstimator = new JointAngleEstimator(currentSide, exerciseType === 'seated_ankle_pumps');
			clearFraming();
			positionReady = false;
			if (session === 'running') pauseExercise('Camera tracking unavailable');
			else countdown?.update(false, performance.now());
			modelError = '';
			status = 'loading';
			captureAvailable = !!currentVideo && currentLive && captureRunning(currentVideo);
			if (!currentLive || !currentVideo || !currentCanvas || complete) return;

			let stopTracking: (() => void) | undefined;

			function refreshCapture() {
				if (generation !== token) return;
				captureAvailable = captureRunning(currentVideo!);
				if (!captureAvailable) {
					clearFraming();
					pauseExercise('Camera unavailable');
					if (
						currentVideo!.srcObject === null ||
						tracks.every((track) => track.readyState === 'ended')
					) {
						generation += 1;
						stopTracking?.();
					}
				}
			}

			const stream = currentVideo.srcObject;
			const tracks = stream instanceof MediaStream ? stream.getVideoTracks() : [];
			const videoEvents = ['playing', 'pause', 'ended', 'emptied', 'loadeddata', 'waiting'];
			for (const event of videoEvents) currentVideo.addEventListener(event, refreshCapture);
			for (const track of tracks) {
				track.addEventListener('ended', refreshCapture);
				track.addEventListener('mute', refreshCapture);
				track.addEventListener('unmute', refreshCapture);
			}

			const stop = startPoseTracking({
				video: currentVideo,
				canvas: currentCanvas,
				model: exerciseType === 'seated_ankle_pumps' ? 'heavy' : 'lite',
				onFrame(landmarks, worldLandmarks, timestamp) {
					if (generation !== token) return;
					captureAvailable = live && captureRunning(currentVideo);
					if (!captureAvailable || document.hidden) {
						clearFraming();
						pauseExercise(document.hidden ? 'Exercise not visible' : 'Camera unavailable');
						return;
					}
					gate.update(landmarks, timestamp);
					const angles = angleEstimator.update(landmarks, worldLandmarks, timestamp);
					kneeRaw = angles.knee?.raw ?? null;
					kneeFiltered = angles.knee?.filtered ?? null;
					hipRaw = angles.hip?.raw ?? null;
					hipFiltered = angles.hip?.filtered ?? null;
					ankleRaw = angles.ankle?.raw ?? null;
					ankleFiltered = angles.ankle?.filtered ?? null;
					const sample = makeRepSample(
						landmarks, currentSide, kneeFiltered, hipFiltered, ankleFiltered, timestamp
					);
					heightAvailable = sample.hipY !== null && sample.torsoHeight !== null;
					lastFrameAt = timestamp;
					copyGate();
					const runningAtFrame = session === 'running';
					if (!runningAtFrame && preparation.armed) {
						positionReady = canBegin && startingPositionReady(profile, sample);
						if (positionReady) counter.update(sample);
						else counter.suspend();
						countdown?.update(positionReady, timestamp);
					}
					if (runningAtFrame && session === 'running') {
						if (!recordingReady || !ready || !requiredAnglesReady || !requiredHeightReady) {
							pauseExercise(
								!recordingReady ? 'Movement recording unavailable'
									: !ready ? 'Required joints not visible'
									: ankleExercise ? 'Ankle tracking unavailable'
									: kneeFiltered === null ? 'Knee tracking unavailable'
										: !requiredAnglesReady ? 'Hip tracking unavailable'
											: 'Hip height unavailable'
							);
						} else {
							counter.update(sample);
							copyCounter();
							if (onrecord && landmarks && worldLandmarks && !onrecord({
								landmarks, worldLandmarks, timestamp,
								elapsedMs: accumulatedMs + timestamp - runningSince,
								phase, reps, cue: feedbackCue, side: currentSide, runId
							})) pauseExercise('Movement recording buffer full');
						}
					}
					if (handsFreeEnabled && !finished) {
						if (handRaise.update(landmarks, timestamp)) {
							if (session === 'running') {
								pauseExercise(null, true);
								handRaiseAction = 'paused';
							} else if (preparation.armed) {
								cancelCountdown();
								handRaiseAction = 'canceled';
							} else {
								handRaiseAction = requestPreparation(true) ? 'countdown' : null;
							}
						}
						handRaiseState = handRaise.state;
						handRaiseProgressMs = handRaise.progressMs;
					}
				},
				onStatus(nextStatus, error) {
					if (generation !== token) return;
					status = nextStatus;
					modelError = error ?? '';
					if (nextStatus !== 'tracking') {
						clearFraming();
						positionReady = false;
						if (session === 'running') {
							pauseExercise(nextStatus === 'error' ? 'Pose detection unavailable' : 'Joint tracking unavailable');
						} else {
							countdown?.update(false, performance.now());
							if (nextStatus === 'error') countdown?.cancel();
						}
					}
				}
			});
			stopTracking = stop;

			return () => {
				generation += 1;
				stop();
				for (const event of videoEvents) currentVideo.removeEventListener(event, refreshCapture);
				for (const track of tracks) {
					track.removeEventListener('ended', refreshCapture);
					track.removeEventListener('mute', refreshCapture);
					track.removeEventListener('unmute', refreshCapture);
				}
			};
		});
	});

	onDestroy(() => {
		generation += 1;
		if (clock !== undefined) clearInterval(clock);
		countdown?.dispose();
	});
</script>

{#if !tutorialComplete}
	<ExerciseTutorial {exercise} oncontinue={prepareCamera} />
{:else}
	<div class="grid grid-cols-[minmax(0,1fr)_19rem] items-start gap-8">
		<div class="w-full max-w-[960px]">
			<section aria-label="Exercise camera" class="relative">
				<Webcam bind:video bind:live autostart />
				<canvas
					bind:this={canvas}
					aria-hidden="true"
					class="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-contain"
				></canvas>
			</section>
			<LiveFeedback
				{sessionId}
				{setOrdinal}
				running={session === 'running'}
				preparing={preparation.armed}
				{finished}
				cue={feedbackCue}
				corrective={repCue !== null || reps >= exercise.reps}
				{reps}
				{phase}
				{elapsedMs}
			/>
			<RepProgress
				exerciseType={exercise.exercise_type}
				{reps}
				{phase}
				{holdElapsedMs}
				holdMs={exercise.hold_seconds * 1000}
			/>
			<JointAngles {kneeRaw} {kneeFiltered} {hipRaw} {hipFiltered} {ankleRaw} {ankleFiltered} {ankleExercise} />
		</div>

		<section aria-labelledby="framing-heading" class="rounded-lg bg-[var(--surface)] p-6">
			<h2 id="framing-heading" class="mb-6">Framing check</h2>

			<fieldset disabled={session !== 'setup'} class="m-0 mb-6 min-w-0 border-0 p-0">
				<legend class="mb-2 font-semibold">Tracking side</legend>
				<div class="grid grid-cols-2 gap-3">
					<label class="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 has-checked:bg-[var(--ash-grey)] has-disabled:cursor-default">
						<input
							type="radio"
							name="tracking-side"
							value="left"
							checked={side === 'left'}
							onchange={() => selectSide('left')}
							class="accent-[var(--chocolate-plum)]"
						/>
						Left
					</label>
					<label class="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 has-checked:bg-[var(--ash-grey)] has-disabled:cursor-default">
						<input
							type="radio"
							name="tracking-side"
							value="right"
							checked={side === 'right'}
							onchange={() => selectSide('right')}
							class="accent-[var(--chocolate-plum)]"
						/>
						Right
					</label>
				</div>
			</fieldset>

			<p role="status" class="mb-5 font-semibold">{framingStatus}</p>
			{#if profile.configurationError}
				<p role="alert" class="mb-5 text-sm text-[var(--error)]">{profile.configurationError}</p>
			{/if}

			{#if !finished}
				<ul aria-label="Required joint visibility" class="m-0 mb-6 list-none space-y-3 p-0">
					{#each joints as joint, index (joint.index)}
						<li class="flex items-baseline justify-between gap-3 text-sm">
							<span>{joint.label}</span>
							<span class="font-semibold">{(visibleMask & requiredMask & (1 << index)) !== 0 ? 'Visible' : 'Not visible'}</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if status === 'error' && !finished}
				{#if modelError}
					<p role="alert" class="mb-4 break-words text-sm text-[var(--error)]">{modelError}</p>
				{/if}
				<button class="button-secondary mb-4 w-full" onclick={retryDetection} disabled={!live || !captureAvailable}>
					Retry pose detection
				</button>
			{/if}

			{#if session !== 'setup'}
				<dl class="m-0 mb-6">
					<dt>Active time</dt>
					<dd class="m-0 text-3xl font-semibold tabular-nums">
						<output aria-label="Exercise elapsed time">{elapsed}</output>
					</dd>
				</dl>
			{/if}

			{#if !finished}
				{#if session === 'running'}
					<p class="mb-4 font-semibold">Exercise in progress</p>
					<button class="min-h-14 w-full text-lg" onclick={() => pauseExercise()}>Pause exercise</button>
				{:else if preparation.armed}
					<p role="status" class="mb-2 font-semibold">
						{preparation.remaining !== null ? 'Hold still. Starting in' : canBegin ? 'Get into the starting position' : 'Waiting for your full body in view'}
					</p>
					{#if preparation.remaining !== null}
						<output aria-label="Countdown" class="mb-4 block text-6xl font-semibold tabular-nums">{preparation.remaining}</output>
					{/if}
					<button class="button-secondary min-h-14 w-full text-lg" onclick={cancelCountdown}>Cancel countdown</button>
				{:else}
					{#if session === 'paused'}
						<p class="mb-4 font-semibold">Exercise paused</p>
					{/if}
					<button class="min-h-14 w-full text-lg" onclick={() => requestPreparation()}>
						{session === 'setup' ? 'Start 5-second countdown' : 'Resume with countdown'}
					</button>
				{/if}
				{#if preparationNotice}
					<p role="status" class="mb-0 mt-3 text-sm">{preparationNotice}</p>
				{/if}
				{#if session !== 'setup'}
					<button class="button-secondary mt-3 w-full" onclick={finishExercise}>{finishLabel}</button>
				{/if}
				<button class="button-secondary mt-3 w-full" onclick={reviewMovement} disabled={session === 'running'}>Review the movement</button>
				<p class="mb-0 mt-4 text-sm">Press Space to start a countdown or pause. Press Escape to cancel or pause.</p>
			{/if}

			<HandRaiseControls
				enabled={handsFreeEnabled}
				disabled={finished}
				available={captureAvailable && status === 'tracking'}
				active={!finished}
				state={handRaiseState}
				progressMs={handRaiseProgressMs}
				action={handRaiseAction}
				onchange={setHandsFreeEnabled}
			/>
		</section>
	</div>
{/if}
