<script lang="ts">
	import type { RepPhase } from '#lib/pose/rep-profile.js';
	import type { ExerciseType } from '#lib/programs.js';

	let {
		exerciseType,
		reps,
		phase,
		holdElapsedMs,
		holdMs
	}: {
		exerciseType: ExerciseType;
		reps: number;
		phase: RepPhase;
		holdElapsedMs: number;
		holdMs: number;
	} = $props();

	const phaseLabel = $derived(
		exerciseType === 'seated_index_finger_bends' && phase === 'raise' ? 'Bend'
			: exerciseType === 'seated_index_finger_bends' && phase === 'lower' ? 'Straighten'
			: exerciseType === 'seated_ankle_pumps' && phase === 'raise'
			? 'Point'
			: exerciseType === 'seated_ankle_pumps' && phase === 'lower'
				? 'Return'
				: phase[0].toUpperCase() + phase.slice(1)
	);
</script>

<section aria-labelledby="rep-progress-heading" class="mb-4 rounded-lg bg-[var(--ash-grey)] px-6 py-4">
	<h2 id="rep-progress-heading" class="sr-only">Repetitions</h2>
	<dl class="m-0 grid grid-cols-3 items-center gap-6">
		<div>
			<dt class="mb-1 text-sm">Completed reps</dt>
			<dd class="m-0">
				<output aria-label="Completed reps" class="text-4xl font-semibold leading-none tabular-nums">{reps}</output>
			</dd>
		</div>
		<div>
			<dt class="mb-1 text-sm">Exercise phase</dt>
			<dd class="m-0">
				<output aria-label="Exercise phase" class="text-xl font-semibold">{phaseLabel}</output>
			</dd>
		</div>
		<div>
			<dt class="mb-1 text-sm">Hold progress</dt>
			<dd class="m-0">
				<output aria-label="Hold progress" class="text-lg tabular-nums">
					{#if holdMs > 0}
						{(holdElapsedMs / 1000).toFixed(1)} / {(holdMs / 1000).toFixed(1)} s
					{:else}
						No hold
					{/if}
				</output>
			</dd>
		</div>
	</dl>
</section>
