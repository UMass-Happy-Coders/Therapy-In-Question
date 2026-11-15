<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import PoseSetup from '#lib/components/PoseSetup.svelte';
	import MovementRecording from '#lib/components/MovementRecording.svelte';
	import SessionMetrics from '#lib/components/SessionMetrics.svelte';
	import { MovementRecorder, type RecordingState } from '#lib/pose/recording.js';
	import { isPatientSession, sessionSteps, type PatientSession, type SetResult } from '#lib/sessions.js';

	let { initial }: { initial: PatientSession } = $props();
	let session = $state(untrack(() => initial));
	let measurement = $state<SetResult | null>(null);
	let pain = $state<number | undefined>();
	let difficulty = $state<number | undefined>();
	let comfort = $state<number | undefined>();
	let notes = $state('');
	let pending = $state(false);
	let errorMessage = $state('');
	let saveStatus = $state<number | null>(null);
	let recording = $state<RecordingState>({ totals: null, pendingFrames: 0, busy: false, ready: false, error: '' });
	const recorder = untrack(() => new MovementRecorder(initial.id, (state) => recording = state));

	beforeNavigate(({ cancel }) => {
		if (recording.pendingFrames > 0 && !window.confirm('Leave without saving the pending movement data?')) cancel();
	});

	onMount(() => {
		void recorder.connect();
		const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
			if (recording.pendingFrames > 0) {
				event.preventDefault();
				event.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', warnBeforeLeaving);
		return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
	});

	onDestroy(() => recorder.dispose());

	async function retryRecording() {
		if (await recorder.retry()) errorMessage = '';
	}

	const scores = Array.from({ length: 11 }, (_, index) => index);
	const plan = $derived(sessionSteps(session.program));
	const step = $derived(plan[session.sets.length]!);
	const recordedReps = $derived(session.sets.reduce((total, entry) => total + entry.reps_completed, 0));
	const plannedReps = $derived(plan.reduce((total, entry) => total + entry.exercise.reps, 0));
	const activeSeconds = $derived(session.sets.reduce((total, entry) => total + entry.elapsed_seconds, 0));

	function activeTime(seconds: number) {
		const whole = Math.floor(seconds);
		return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
	}

	async function saveSet(event: SubmitEvent) {
		event.preventDefault();
		if (!measurement || pending || pain === undefined || difficulty === undefined || comfort === undefined) return;
		pending = true;
		errorMessage = '';
		saveStatus = null;
		try {
			if (!await recorder.flush()) {
				errorMessage = 'Set was not saved. Retry recording before saving this set.';
				return;
			}
			const response = await fetch(`/api/patient/sessions/${session.id}/sets`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TherapyInQuestion' },
				body: JSON.stringify({
					ordinal: session.sets.length,
					exercise_id: step.exercise.id,
					set_number: step.set_number,
					...measurement,
					pain, difficulty, comfort, notes: notes.trim()
				})
			});
			if (!response.ok) {
				saveStatus = response.status;
				errorMessage = response.status === 409
					? 'This set conflicts with the saved session. Reload to continue.'
					: response.status === 401 ? 'Sign in again to save this set.' : 'We could not save this set. Please try again.';
				return;
			}
			const updated: unknown = await response.json();
			if (!isPatientSession(updated) || updated.id !== session.id) {
				errorMessage = 'The service returned an unexpected session. Please reload.';
				return;
			}
			session = updated;
			measurement = null;
			pain = undefined;
			difficulty = undefined;
			comfort = undefined;
			notes = '';
		} catch {
			errorMessage = 'We could not reach the service. Please try again.';
		} finally {
			pending = false;
		}
	}
</script>

<main id="main-content" class="mx-auto max-w-[1440px] px-10 py-7">
	<a href="/patient" class="mb-5 inline-flex min-h-11 items-center text-sm">Back to programs</a>
	{#if session.status === 'completed'}
		<div class="mb-7 flex items-center justify-between gap-8">
			<div>
				<h1 class="mb-2">Session summary</h1>
				<p class="mb-0">{session.program.name} - {session.session_date} (UTC)</p>
			</div>
			{#if recording.totals && recording.totals.frames > 0}
				<a href={`/patient/session/${session.id}/playback`} class="button min-h-12">Play skeleton recording</a>
			{/if}
		</div>
		<dl class="mb-7 grid grid-cols-3 gap-8 rounded-lg bg-[var(--ash-grey)] px-7 py-5">
			<div><dt class="mb-1 text-sm">Sets logged</dt><dd class="m-0 text-3xl font-semibold tabular-nums">{session.sets.length} / {plan.length}</dd></div>
			<div><dt class="mb-1 text-sm">Reps recorded</dt><dd class="m-0 text-3xl font-semibold tabular-nums">{recordedReps} / {plannedReps}</dd></div>
			<div><dt class="mb-1 text-sm">Active time</dt><dd class="m-0 text-3xl font-semibold tabular-nums">{activeTime(activeSeconds)}</dd></div>
		</dl>
		<MovementRecording state={recording} onretry={retryRecording} />
		<table class="w-full border-collapse text-left">
			<caption class="mb-5 text-left text-xl font-semibold">Saved set logs</caption>
			<thead class="bg-[var(--ash-grey)]">
				<tr>
					<th scope="col" class="p-4">Exercise</th><th scope="col" class="p-4">Set</th>
					<th scope="col" class="p-4">Reps</th><th scope="col" class="p-4">Pain</th>
					<th scope="col" class="p-4">Difficulty</th><th scope="col" class="p-4">Comfort</th>
					<th scope="col" class="p-4">Active time</th><th scope="col" class="p-4">Notes</th>
				</tr>
			</thead>
			<tbody>
				{#each session.sets as entry (entry.ordinal)}
					<tr class="align-top odd:bg-[var(--surface)]">
						<th scope="row" class="p-4 font-semibold">{plan[entry.ordinal].exercise.name}</th>
						<td class="p-4">{entry.set_number}</td>
						<td class="p-4">{entry.reps_completed} / {plan[entry.ordinal].exercise.reps}</td>
						<td class="p-4">{entry.pain} / 10</td><td class="p-4">{entry.difficulty} / 10</td>
						<td class="p-4">{entry.comfort} / 10</td><td class="p-4 tabular-nums">{activeTime(entry.elapsed_seconds)}</td>
						<td class="max-w-xs whitespace-pre-wrap break-words p-4">{entry.notes || 'None'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="mt-10">
			<SessionMetrics {session} />
		</div>
	{:else}
		<div class="mb-5 flex items-center justify-between gap-10">
			<div>
				<h1 class="mb-2">{step.exercise.name}</h1>
				<p class="mb-0">{session.program.name} - Set {step.set_number} of {step.exercise.sets}</p>
			</div>
			<div class="w-60 shrink-0">
				<p class="mb-2 text-sm">{session.sets.length} of {plan.length} sets logged</p>
				<progress aria-label="Sets logged" value={session.sets.length} max={plan.length} class="block h-2 w-full accent-[var(--chocolate-plum)]">{session.sets.length} / {plan.length}</progress>
			</div>
		</div>
		<dl class="mb-7 flex items-center gap-12 text-sm">
			<div class="flex items-baseline gap-3"><dt>Target reps</dt><dd class="m-0 text-lg font-semibold tabular-nums">{step.exercise.reps}</dd></div>
			<div class="flex items-baseline gap-3"><dt>{step.exercise.target_label}</dt><dd class="m-0 text-lg font-semibold tabular-nums">{step.exercise.target_angle} degrees</dd></div>
			<div class="flex items-baseline gap-3"><dt>Hold per rep</dt><dd class="m-0 text-lg font-semibold">{step.exercise.hold_seconds ? `${step.exercise.hold_seconds} ${step.exercise.hold_seconds === 1 ? 'second' : 'seconds'}` : 'No hold'}</dd></div>
		</dl>
		{#if measurement}
			<section aria-labelledby="set-log-heading" class="mx-auto max-w-5xl rounded-lg bg-[var(--surface)] p-8">
				<h2 id="set-log-heading" class="mb-2 text-2xl">Log set {step.set_number}</h2>
				<p class="mb-6">How did this set feel? Your scores are saved with your movement data.</p>
				<dl class="mb-8 grid grid-cols-2 gap-6 rounded-lg bg-[var(--ash-grey)] p-5">
					<div><dt>Reps recorded</dt><dd class="m-0 text-2xl font-semibold">{measurement.reps_completed} / {step.exercise.reps}</dd></div>
					<div><dt>Active time</dt><dd class="m-0 text-2xl font-semibold tabular-nums">{activeTime(measurement.elapsed_seconds)}</dd></div>
				</dl>
				{#if measurement.rep_metrics.length}
					<table class="mb-8 w-full border-collapse text-left text-sm">
						<caption class="mb-3 text-left font-semibold">Measured reps (camera estimates)</caption>
						<thead class="bg-[var(--ash-grey)]">
							<tr>
								<th scope="col" class="p-3">Rep</th><th scope="col" class="p-3">Start</th>
								<th scope="col" class="p-3">Peak</th><th scope="col" class="p-3">Range of motion</th>
								<th scope="col" class="p-3">Rep time</th>
							</tr>
						</thead>
						<tbody>
							{#each measurement.rep_metrics as rep (rep.rep_number)}
								<tr>
									<th scope="row" class="p-3 font-semibold tabular-nums">{rep.rep_number}</th>
									<td class="p-3 tabular-nums">{rep.start_angle.toFixed(1)} deg</td>
									<td class="p-3 tabular-nums">{rep.peak_angle.toFixed(1)} deg</td>
									<td class="p-3 tabular-nums">{(rep.peak_angle - rep.start_angle).toFixed(1)} deg</td>
									<td class="p-3 tabular-nums">{(rep.duration_ms / 1000).toFixed(1)} s</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<form onsubmit={saveSet} aria-busy={pending}>
					<fieldset disabled={pending} class="m-0 min-w-0 border-0 p-0">
						<legend class="sr-only">Pain, difficulty, and comfort for this set</legend>
						<div class="mb-6 grid grid-cols-3 gap-6">
							<label class="grid gap-2 font-semibold">Pain (0 none, 10 severe)
								<select name="pain" required bind:value={pain} class="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 font-normal">
									<option value={undefined} disabled>Select score</option>
									{#each scores as score}<option value={score}>{score}</option>{/each}
								</select>
							</label>
							<label class="grid gap-2 font-semibold">Difficulty (0 easy, 10 hard)
								<select name="difficulty" required bind:value={difficulty} class="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 font-normal">
									<option value={undefined} disabled>Select score</option>
									{#each scores as score}<option value={score}>{score}</option>{/each}
								</select>
							</label>
							<label class="grid gap-2 font-semibold">Comfort (0 low, 10 high)
								<select name="comfort" required bind:value={comfort} class="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 font-normal">
									<option value={undefined} disabled>Select score</option>
									{#each scores as score}<option value={score}>{score}</option>{/each}
								</select>
							</label>
						</div>
						<label class="mb-6 grid gap-2 font-semibold">Notes (optional)
							<textarea name="notes" maxlength="1000" rows="3" bind:value={notes} class="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 font-normal"></textarea>
						</label>
						{#if errorMessage}
							<p role="alert" class="text-[var(--error)]">{errorMessage}</p>
							{#if saveStatus === 409}<a href={`/patient/session/${session.id}`} data-sveltekit-reload class="mb-5 inline-block">Reload session</a>{/if}
							{#if saveStatus === 401}<a href="/login" class="mb-5 inline-block">Sign in</a>{/if}
						{/if}
						<button type="submit" class="min-h-14 min-w-60 text-lg">{pending ? 'Saving set...' : session.sets.length + 1 === plan.length ? 'Save set and finish' : 'Save set and continue'}</button>
					</fieldset>
				</form>
			</section>
		{:else}
			{#key session.sets.length}
				<PoseSetup
					exercise={step.exercise}
					sessionId={session.id}
					setOrdinal={session.sets.length}
					finishLabel="End set"
					recordingReady={recording.ready}
					onrecord={(frame) => recorder.capture({ ...frame, setOrdinal: session.sets.length, exerciseId: step.exercise.id })}
					onfinish={(result) => { measurement = result; void recorder.flush(); }}
				/>
			{/key}
		{/if}
		<div class="mt-8">
			<MovementRecording state={recording} onretry={retryRecording} />
		</div>
	{/if}
</main>
