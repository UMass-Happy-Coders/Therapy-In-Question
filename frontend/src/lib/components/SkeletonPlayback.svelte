<script lang="ts">
	import { onMount } from 'svelte';
	import RecordedSkeleton from '#lib/components/RecordedSkeleton.svelte';
	import { RecordingPlayback, type PlaybackFrame, type PlaybackIndex } from '#lib/pose/playback.js';
	import { sessionSteps, type PatientSession } from '#lib/sessions.js';

	let { session }: { session: PatientSession } = $props();
	let index = $state<PlaybackIndex | null>(null);
	let current = $state<PlaybackFrame | null>(null);
	let position = $state(0);
	let loading = $state(true);
	let playing = $state(false);
	let buffering = $state(false);
	let errorMessage = $state('');
	let repSelection = $state('');
	let reader: RecordingPlayback | null = null;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const plan = $derived(sessionSteps(session.program));
	const phases = { rest: 'Rest', raise: 'Raise', hold: 'Hold', lower: 'Lower' };
	const step = $derived(current ? plan[current.chunk.set_ordinal] : null);

	function time(milliseconds: number) {
		const centiseconds = Math.floor(milliseconds / 10);
		return `${Math.floor(centiseconds / 6000).toString().padStart(2, '0')}:${Math.floor(centiseconds % 6000 / 100).toString().padStart(2, '0')}.${(centiseconds % 100).toString().padStart(2, '0')}`;
	}

	function pause() {
		generation += 1;
		playing = false;
		buffering = false;
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	}

	async function seek(target: number) {
		pause();
		if (!index || !reader || index.frames === 0) return;
		const token = generation;
		position = Math.max(0, Math.min(index.frames - 1, target));
		current = null;
		loading = true;
		errorMessage = '';
		try {
			const frame = await reader.frame(position);
			if (generation === token) current = frame;
		} catch (error) {
			if (generation === token) errorMessage = error instanceof Error ? error.message : 'This frame could not be loaded.';
		} finally {
			if (generation === token) loading = false;
		}
	}

	async function scheduleNext(token: number) {
		if (!reader || !index || !current || !playing || token !== generation) return;
		if (position === index.frames - 1) {
			pause();
			return;
		}
		const previous = current;
		const startedAt = performance.now();
		buffering = true;
		try {
			const next = await reader.frame(position + 1);
			if (token !== generation || !playing) return;
			buffering = false;
			const delay = next.chunk.run_id === previous.chunk.run_id
				? next.frame.elapsed_ms - previous.frame.elapsed_ms : 0;
			if (delay < 0) throw new Error('Recording timestamps are out of order.');
			timer = setTimeout(() => {
				if (token !== generation || !playing) return;
				current = next;
				position = next.position;
				void scheduleNext(token);
			}, Math.max(0, delay - (performance.now() - startedAt)));
		} catch (error) {
			if (token !== generation) return;
			pause();
			errorMessage = error instanceof Error ? error.message : 'Playback could not continue.';
		}
	}

	async function play() {
		if (!index || loading || playing || errorMessage || index.frames === 0) return;
		if (position === index.frames - 1) await seek(0);
		if (!current || errorMessage) return;
		playing = true;
		void scheduleNext(generation);
	}

	async function loadRecording() {
		pause();
		reader?.dispose();
		reader = new RecordingPlayback(session);
		const token = generation;
		loading = true;
		index = null;
		current = null;
		position = 0;
		repSelection = '';
		errorMessage = '';
		try {
			const loaded = await reader.loadIndex();
			if (token !== generation) return;
			index = loaded;
			if (loaded.frames > 0) await seek(0);
			else loading = false;
		} catch (error) {
			if (token !== generation) return;
			loading = false;
			errorMessage = error instanceof Error ? error.message : 'The recording could not be loaded.';
		}
	}

	onMount(() => {
		void loadRecording();
		const visibilityChanged = () => { if (document.hidden) pause(); };
		document.addEventListener('visibilitychange', visibilityChanged);
		return () => {
			pause();
			reader?.dispose();
			document.removeEventListener('visibilitychange', visibilityChanged);
		};
	});
</script>

<section aria-label="Skeleton playback controls">
	{#if errorMessage}
		<p role="alert" class="mb-4 text-[var(--error)]">{errorMessage}</p>
		<button class="button-secondary mb-6" onclick={loadRecording}>Reload recording</button>
	{/if}
	{#if index && index.frames > 0}
		<div class="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-8">
			<div>
				<RecordedSkeleton frame={current?.frame ?? null} bounds={index.bounds} frameNumber={position + 1} />
				<div class="mt-5 flex items-center justify-between gap-6">
					<label for="playback-frame" class="font-semibold">Frame <output aria-label="Playback frame">{position + 1}</output> of {index.frames}</label>
					<span role="status">{loading ? 'Loading frame...' : buffering ? 'Buffering...' : playing ? 'Playing' : position === index.frames - 1 ? 'Playback finished' : 'Paused'}</span>
				</div>
				<input
					id="playback-frame"
					type="range"
					min="0"
					max={index.frames - 1}
					step="1"
					value={position}
					aria-label="Playback position"
					aria-valuetext={`Frame ${position + 1} of ${index.frames}`}
					oninput={(event) => { repSelection = ''; void seek(Number(event.currentTarget.value)); }}
					class="mt-3 h-11 w-full cursor-pointer accent-[var(--chocolate-plum)]"
				/>
				<div class="mt-4 flex gap-3">
					<button onclick={() => playing ? pause() : void play()} disabled={loading && !playing || !!errorMessage}>{playing ? 'Pause' : 'Play'}</button>
					<button class="button-secondary" onclick={() => { void seek(position - 1); }} disabled={position === 0}>Previous frame</button>
					<button class="button-secondary" onclick={() => { void seek(position + 1); }} disabled={position === index.frames - 1}>Next frame</button>
				</div>
				<p class="mb-0 mt-4 text-sm">Unrecorded pauses are skipped. No video is stored or played.</p>
			</div>
			<section aria-labelledby="recorded-frame-heading" class="rounded-lg bg-[var(--surface)] p-6">
				<h2 id="recorded-frame-heading">Recorded frame</h2>
				{#if current && step}
					<p class="mb-5 font-semibold">{step.exercise.name} - Set {step.set_number}</p>
					<dl class="m-0 space-y-5">
						<div><dt>Active time</dt><dd class="m-0 text-2xl font-semibold tabular-nums"><output aria-label="Playback active time">{time(current.frame.elapsed_ms)}</output></dd></div>
						<div><dt>Phase</dt><dd class="m-0 font-semibold"><output aria-label="Playback phase">{phases[current.frame.phase]}</output></dd></div>
						<div><dt>Completed reps</dt><dd class="m-0 font-semibold">{current.frame.rep_number}</dd></div>
						<div><dt>Tracked side</dt><dd class="m-0 font-semibold">{current.chunk.side === 'left' ? 'Left' : 'Right'}</dd></div>
					</dl>
					{#if current.frame.annotations.length > 0}
						<ul aria-label="Recorded cues" class="mb-0 mt-6 list-none space-y-2 p-0">
							{#each current.frame.annotations as annotation}<li>{annotation}</li>{/each}
						</ul>
					{/if}
				{/if}
				<label for="playback-rep" class="mb-2 mt-7 block font-semibold">Jump to completed rep</label>
				<select id="playback-rep" bind:value={repSelection} disabled={index.reps.length === 0} onchange={(event) => { if (event.currentTarget.value !== '') void seek(Number(event.currentTarget.value)); }} class="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3">
					<option value="" disabled>{index.reps.length === 0 ? 'No completed rep markers' : 'Choose rep completion'}</option>
					{#each index.reps as marker (marker.position)}
						<option value={String(marker.position)}>{plan[marker.setOrdinal].exercise.name}, set {plan[marker.setOrdinal].set_number}, rep {marker.rep}</option>
					{/each}
				</select>
			</section>
		</div>
	{:else if loading}
		<p role="status">Loading skeleton recording...</p>
	{:else if index && index.frames === 0}
		<p>No movement frames have been saved for this session.</p>
	{/if}
</section>
