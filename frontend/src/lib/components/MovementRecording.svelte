<script lang="ts">
	import type { RecordingState } from '#lib/pose/recording.js';

	let { state, onretry }: { state: RecordingState; onretry: () => void } = $props();
</script>

<section aria-labelledby="movement-recording-heading" class="mb-8 rounded-lg bg-[var(--surface)] p-5">
	<div class="flex items-start justify-between gap-8">
		<div>
			<h2 id="movement-recording-heading" class="mb-2">Movement recording</h2>
			<p class="mb-0 text-sm">Skeleton landmarks only. No video or audio stored.</p>
		</div>
		{#if state.totals}
			<dl class="m-0 flex gap-8 text-sm">
				<div><dt>Frames saved</dt><dd class="m-0 text-xl font-semibold tabular-nums"><output aria-label="Movement frames saved">{state.totals.frames}</output></dd></div>
				<div><dt>Chunks saved</dt><dd class="m-0 text-xl font-semibold tabular-nums"><output aria-label="Movement chunks saved">{state.totals.chunks}</output></dd></div>
			</dl>
		{/if}
	</div>
	{#if state.error}
		<p role="alert" class="mb-3 mt-4 text-[var(--error)]">{state.error}</p>
		<button class="button-secondary" onclick={onretry} disabled={state.busy}>Retry recording</button>
	{:else if state.totals === null}
		<p role="status" class="mb-0 mt-4">Connecting to movement storage...</p>
	{/if}
	{#if state.pendingFrames > 0}
		<p class="mb-0 mt-3 text-sm">{state.pendingFrames} frames awaiting save confirmation</p>
	{/if}
</section>
