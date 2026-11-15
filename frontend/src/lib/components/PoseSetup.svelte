<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import Webcam from '#lib/components/Webcam.svelte';
	import JointAngles from '#lib/components/JointAngles.svelte';
	import RepProgress from '#lib/components/RepProgress.svelte';
	import HandRaiseControls from '#lib/components/HandRaiseControls.svelte';
	import LiveFeedback from '#lib/components/LiveFeedback.svelte';
	import { JointAngleEstimator } from '#lib/pose/angles.js';
	import { FramingGate, type RequiredJoint, type TrackedSide } from '#lib/pose/framing.js';
	import { HandRaiseGesture, type HandRaiseState } from '#lib/pose/hand-raise.js';
	import { RepCounter, makeRepSample } from '#lib/pose/rep-counter.js';
	import { createRepProfile, type RepPhase } from '#lib/pose/rep-profile.js';
	import { movementCue } from '#lib/pose/local-feedback.js';
	import { startPoseTracking, type TrackerStatus } from '#lib/pose/tracker.js';
	import type { PoseCapture } from '#lib/pose/recording.js';
	import type { ProgramExercise } from '#lib/programs.js';
	import type { SetMeasurement } from '#lib/sessions.js';

	let { exercise, onfinish, finishLabel = 'Finish exercise', onrecord, recordingReady = true, sessionId, setOrdinal = 0 }: {
		exercise: ProgramExercise;
		onfinish?: (result: SetMeasurement) => void;
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
	let handsFreeEnabled = $state(false);
	let handRaiseState = $state<HandRaiseState>('waiting');
	let handRaiseProgressMs = $state(0);
	let handRaiseAction = $state<'paused' | 'resumed' | 'blocked' | null>(null);
	let elapsedMs = $state(0);
	let gate: FramingGate;
	let angleEstimator: JointAngleEstimator;
	let generation = 0;
	let lastFrameAt = 0;
	let accumulatedMs = 0;
	let runningSince = 0;
	let clock: ReturnType<typeof setInterval> | undefined;
	let runId = '';

	const finished = $derived(session === 'finished');
	const ankleExercise = $derived(exercise.exercise_type === 'seated_ankle_pumps');
	const feedbackCue = $derived(movementCue(exercise, session, phase, reps, holdElapsedMs, repCue));
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
								: !requiredHeightReady ? 'Hip height unavailable' : 'Framing ready'
							: !hasPose
								? 'No pose detected'
								: stabilizing
									? 'Checking framing'
									: 'Joints not visible'
	);

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

	function beginExercise(fromGesture = false): boolean {
		if (
			!canBegin ||
			!video ||
			!captureRunning(video) ||
			document.hidden ||
			performance.now() - lastFrameAt > 500 ||
			(session !== 'setup' && session !== 'paused')
		) return false;
		if (!fromGesture) resetHandRaise();
		if (!runId) runId = crypto.randomUUID();
		if (session === 'setup') {
			counter.reset();
			angleEstimator.lockAnkleNeutral();
		} else {
			counter.suspend();
		}
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
		onfinish?.({ reps_completed: reps, elapsed_seconds: Math.round(elapsedMs) / 1000 });
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
			const token = ++generation;
			gate = new FramingGate(exerciseType, currentSide);
			angleEstimator = new JointAngleEstimator(currentSide, exerciseType === 'seated_ankle_pumps');
			clearFraming();
			pauseExercise('Camera tracking unavailable');
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
					if (session === 'running') {
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
					if (handsFreeEnabled && (session === 'running' || session === 'paused')) {
						if (handRaise.update(landmarks, timestamp)) {
							if (session === 'running') {
								pauseExercise(null, true);
								handRaiseAction = 'paused';
							} else {
								handRaiseAction = beginExercise(true) ? 'resumed' : 'blocked';
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
						pauseExercise(
							nextStatus === 'error' ? 'Pose detection unavailable' : 'Joint tracking unavailable'
						);
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
	});
</script>

{#if ankleExercise}
	<p class="mb-6 max-w-4xl">Sit with your leg supported and your foot free to move. Keep your full body in view, with the selected knee, ankle, heel and toes clearly visible from the side. Only do this exercise if assigned by your therapist; stop if pain increases.</p>
{/if}

<div class="grid grid-cols-[minmax(0,1fr)_19rem] items-start gap-8">
	<div class="w-full max-w-[960px]">
		<section aria-label="Exercise camera" class="relative">
			<Webcam bind:video bind:live />
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

		{#if session === 'setup'}
			<button class="w-full" onclick={() => beginExercise()} disabled={!canBegin}>Start exercise</button>
		{:else if session !== 'finished'}
			<p class="mb-4 font-semibold">{session === 'running' ? 'Exercise in progress' : 'Exercise paused'}</p>
			<div class="flex flex-col gap-3">
				{#if session === 'running'}
					<button onclick={() => pauseExercise()}>Pause exercise</button>
				{:else}
					<button onclick={() => beginExercise()} disabled={!canBegin}>Resume exercise</button>
				{/if}
				<button class="button-secondary" onclick={finishExercise}>{finishLabel}</button>
			</div>
		{/if}

		<HandRaiseControls
			enabled={handsFreeEnabled}
			disabled={finished}
			available={captureAvailable && status === 'tracking'}
			active={session === 'running' || session === 'paused'}
			state={handRaiseState}
			progressMs={handRaiseProgressMs}
			action={handRaiseAction}
			onchange={setHandsFreeEnabled}
		/>
	</section>
</div>
