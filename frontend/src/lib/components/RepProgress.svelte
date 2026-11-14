<script lang="ts">
	import type { RepPhase } from '#lib/pose/rep-profile.js';

	let {
		reps,
		phase,
		holdElapsedMs,
		holdMs,
		cue
	}: {
		reps: number;
		phase: RepPhase;
		holdElapsedMs: number;
		holdMs: number;
		cue: string | null;
	} = $props();
</script>

<section aria-labelledby="rep-progress-heading" class="pt-6">
	<h2 id="rep-progress-heading" class="mb-4">Repetitions</h2>
	<dl class="m-0 grid grid-cols-3 gap-6">
		<div>
			<dt class="mb-1 font-semibold">Completed reps</dt>
			<dd class="m-0">
				<output aria-label="Completed reps" class="text-3xl font-semibold tabular-nums">{reps}</output>
			</dd>
		</div>
		<div>
			<dt class="mb-1 font-semibold">Exercise phase</dt>
			<dd class="m-0">
				<output aria-label="Exercise phase" class="text-lg">{phase[0].toUpperCase()}{phase.slice(1)}</output>
			</dd>
		</div>
		<div>
			<dt class="mb-1 font-semibold">Hold progress</dt>
			<dd class="m-0">
				<output aria-label="Hold progress" class="text-lg tabular-nums">{(holdElapsedMs / 1000).toFixed(1)} / {(holdMs / 1000).toFixed(1)} s</output>
			</dd>
		</div>
	</dl>
	{#if cue}
		<p role="status" class="mb-0 mt-4 font-semibold text-[var(--error)]">{cue}</p>
	{/if}
</section>
