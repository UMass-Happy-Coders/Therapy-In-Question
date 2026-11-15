<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { FeedbackChannel, type FeedbackState } from '#lib/pose/live-feedback.js';
	import type { RepPhase } from '#lib/pose/rep-profile.js';

	let { sessionId, setOrdinal, running, preparing, finished, cue, corrective, reps, phase, elapsedMs }: {
		sessionId?: string;
		setOrdinal: number;
		running: boolean;
		preparing: boolean;
		finished: boolean;
		cue: string;
		corrective: boolean;
		reps: number;
		phase: RepPhase;
		elapsedMs: number;
	} = $props();

	let channel = $state.raw<FeedbackChannel | null>(null);
	let feedback = $state<FeedbackState>({ status: 'disabled', message: '' });
	let spokenEnabled = $state(false);
	let encouragementEnabled = $state(false);
	let speechAvailable = $state(false);
	let speechStatus = $state('');
	let speechFailed = $state(false);
	let visible = $state(true);
	let synthesis: SpeechSynthesis | null = null;
	let speechKind: 'local' | 'encouragement' | null = null;
	let speechGeneration = 0;
	let currentUtterance: SpeechSynthesisUtterance | null = null;
	let lastLocalCue = '';
	let lastEncouragement = '';

	const active = $derived(running && !finished && visible);
	const localActive = $derived((running || preparing) && !finished && visible);
	const connectionText = $derived(
		finished ? 'Set finished.' : !visible ? 'Paused while this page is hidden.' : !running ? 'Start or resume this set to connect.' :
		feedback.status === 'connecting' ? 'Connecting to encouragement...' :
		feedback.status === 'waiting' ? 'Waiting for encouragement...' :
		feedback.status === 'ready' ? (corrective ? 'Connected. Movement cues take priority.' : 'Connected. Encouragement is occasional.') :
		feedback.status === 'unavailable' ? 'Encouragement is unavailable. Instant cues still work.' :
		'Encouragement is not connected.'
	);

	function cancelSpeech(): void {
		speechGeneration += 1;
		speechKind = null;
		currentUtterance = null;
		speechStatus = '';
		speechFailed = false;
		synthesis?.cancel();
	}

	function speak(text: string, kind: 'local' | 'encouragement'): void {
		if (!synthesis || !text) return;
		if (kind === 'encouragement' && speechKind === 'local') return;
		cancelSpeech();
		const generation = speechGeneration;
		try {
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = 'en-US';
			currentUtterance = utterance;
			speechKind = kind;
			speechStatus = 'Waiting for speech to start...';
			utterance.onstart = () => {
				if (generation !== speechGeneration || currentUtterance !== utterance) return;
				speechStatus = kind === 'local' ? 'Speaking movement cue.' : 'Speaking encouragement.';
			};
			utterance.onend = () => {
				if (generation !== speechGeneration || currentUtterance !== utterance) return;
				speechKind = null;
				currentUtterance = null;
				speechStatus = kind === 'local' ? 'Movement cue spoken.' : 'Encouragement spoken.';
			};
			utterance.onerror = (event) => {
				if (generation !== speechGeneration || currentUtterance !== utterance) return;
				speechKind = null;
				currentUtterance = null;
				speechFailed = true;
				speechStatus = event.error === 'not-allowed'
					? 'Speech was blocked by your browser. Movement cues remain visible.'
					: 'Speech could not play. Movement cues remain visible.';
			};
			synthesis.speak(utterance);
		} catch {
			if (generation !== speechGeneration) return;
			speechKind = null;
			currentUtterance = null;
			speechFailed = true;
			speechStatus = 'Speech could not start. Movement cues remain visible.';
		}
	}

	onMount(() => {
		visible = document.visibilityState !== 'hidden';
		if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
			synthesis = window.speechSynthesis;
			speechAvailable = true;
		}
		const onvisibility = () => {
			visible = document.visibilityState !== 'hidden';
			if (!visible) {
				cancelSpeech();
				channel?.update(null);
			}
		};
		document.addEventListener('visibilitychange', onvisibility);
		return () => {
			document.removeEventListener('visibilitychange', onvisibility);
			cancelSpeech();
			synthesis = null;
		};
	});

	$effect(() => {
		const id = sessionId;
		setOrdinal;
		encouragementEnabled = false;
		untrack(() => {
			cancelSpeech();
			lastLocalCue = '';
			lastEncouragement = '';
		});
		const next = id ? new FeedbackChannel(id, (state) => { feedback = state; }) : null;
		channel = next;
		if (!next) feedback = { status: 'disabled', message: '' };
		return () => next?.dispose();
	});

	$effect(() => {
		const current = channel;
		const enabled = encouragementEnabled;
		const sample = active ? {
			set_ordinal: setOrdinal,
			reps_completed: reps,
			elapsed_ms: Math.floor(elapsedMs),
			phase
		} : null;
		const blocked = corrective;
		untrack(() => {
			if (!enabled) current?.setEnabled(false);
			current?.update(sample, blocked);
			if (enabled) current?.setEnabled(true);
		});
	});

	$effect(() => {
		const canSpeak = speechAvailable && spokenEnabled && localActive;
		const text = cue;
		const priority = corrective;
		untrack(() => {
			if (!canSpeak) {
				cancelSpeech();
				lastLocalCue = '';
				return;
			}
			if (priority && speechKind === 'encouragement') {
				cancelSpeech();
				lastLocalCue = '';
			}
			if (text !== lastLocalCue) {
				lastLocalCue = text;
				if (text) speak(text, 'local');
				else if (speechKind === 'local') cancelSpeech();
			}
		});
	});

	$effect(() => {
		const canSpeak = speechAvailable && spokenEnabled && encouragementEnabled && active && !corrective;
		const message = feedback.message;
		untrack(() => {
			if (!canSpeak || !message) {
				lastEncouragement = '';
				if (speechKind === 'encouragement') cancelSpeech();
				return;
			}
			if (message !== lastEncouragement) {
				lastEncouragement = message;
				speak(message, 'encouragement');
			}
		});
	});
</script>

<div class={sessionId ? 'grid grid-cols-2 gap-8 pt-6' : 'pt-6'}>
<section aria-labelledby="movement-cue-heading">
	<h2 id="movement-cue-heading" class="mb-3">Movement cue</h2>
	<p role="status" class={`m-0 text-lg font-semibold${corrective ? ' text-[var(--error)]' : ''}`}>{cue}</p>
	{#if speechAvailable}
		<label class="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-default">
			<input type="checkbox" bind:checked={spokenEnabled} disabled={finished} class="h-4 w-4 accent-[var(--chocolate-plum)]" />
			Spoken cues
		</label>
		{#if spokenEnabled}
			<p role="status" class={`mb-0 mt-1 text-sm${speechFailed ? ' text-[var(--error)]' : ''}`}>
				{!localActive ? 'Spoken cues are paused.' : speechStatus || 'Waiting for the next movement cue.'}
			</p>
		{/if}
	{/if}
</section>

{#if sessionId}
	<section aria-labelledby="encouragement-heading">
		<h2 id="encouragement-heading" class="mb-3">Encouragement</h2>
		<label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-default">
			<input type="checkbox" bind:checked={encouragementEnabled} disabled={finished} aria-describedby="encouragement-privacy" class="h-4 w-4 accent-[var(--chocolate-plum)]" />
			Gemini encouragement
		</label>
		<p id="encouragement-privacy" class="mb-0 mt-1 text-sm">Sends this set's rep count, phase, active time and prescribed targets to Gemini. No video or landmarks.</p>
		{#if encouragementEnabled}
			<p role="status" class="mb-0 mt-3 text-sm">{connectionText}</p>
			<div aria-live="polite" aria-atomic="true">
				{#if feedback.message && active && !corrective}
					<p class="mb-0 mt-3">{feedback.message}</p>
				{/if}
			</div>
			{#if feedback.status === 'unavailable'}
				<button class="button-secondary mt-3" disabled={!active} onclick={() => channel?.retry()}>Retry encouragement</button>
			{/if}
		{/if}
	</section>
{/if}
</div>
