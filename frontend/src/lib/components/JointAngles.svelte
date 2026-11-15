<script lang="ts">
	let {
		kneeRaw,
		kneeFiltered,
		hipRaw,
		hipFiltered,
		ankleRaw,
		ankleFiltered,
		ankleExercise
	}: {
		kneeRaw: number | null;
		kneeFiltered: number | null;
		hipRaw: number | null;
		hipFiltered: number | null;
		ankleRaw: number | null;
		ankleFiltered: number | null;
		ankleExercise: boolean;
	} = $props();
</script>

<section aria-labelledby="joint-angles-heading" class="pt-6">
	<h2 id="joint-angles-heading" class="mb-4">{ankleExercise ? 'Ankle angle' : 'Joint angles'}</h2>
	<dl class="m-0 grid grid-cols-2 gap-6">
		{#if ankleExercise}
			<div class="col-span-2">
				<dt class="mb-1 font-semibold">Ankle plantar flexion</dt>
				<dd class="m-0"><output aria-label="Smoothed ankle plantar flexion" class="text-lg tabular-nums">{ankleFiltered === null ? 'No reliable measurement' : `${ankleFiltered.toFixed(1)} deg`}</output></dd>
			</div>
		{:else}
		<div>
			<dt class="mb-1 font-semibold">Knee angle</dt>
			<dd class="m-0">
				<output aria-label="Smoothed knee angle" class="text-lg tabular-nums">
					{kneeFiltered === null ? 'No reliable measurement' : `${kneeFiltered.toFixed(1)} deg`}
				</output>
			</dd>
		</div>
		<div>
			<dt class="mb-1 font-semibold">Hip flexion</dt>
			<dd class="m-0">
				<output aria-label="Smoothed hip flexion" class="text-lg tabular-nums">
					{hipFiltered === null ? 'No reliable measurement' : `${hipFiltered.toFixed(1)} deg`}
				</output>
			</dd>
		</div>
		{/if}
	</dl>
	{#if ankleExercise}
		<p class="mb-0 mt-3 text-sm">Zero is approximate neutral. Negative values indicate dorsiflexion.</p>
	{/if}
	<details class="mt-5">
		<summary class="cursor-pointer font-semibold">Raw measurements</summary>
		<dl class="m-0 mt-3 grid grid-cols-2 gap-6 text-sm">
			{#if ankleExercise}
				<div class="col-span-2">
					<dt class="mb-1">Ankle plantar flexion</dt>
					<dd class="m-0"><output aria-label="Raw ankle plantar flexion" class="tabular-nums">{ankleRaw === null ? 'No reliable measurement' : `${ankleRaw.toFixed(1)} deg`}</output></dd>
				</div>
			{:else}
			<div>
				<dt class="mb-1">Knee angle</dt>
				<dd class="m-0">
					<output aria-label="Raw knee angle" class="tabular-nums">
						{kneeRaw === null ? 'No reliable measurement' : `${kneeRaw.toFixed(1)} deg`}
					</output>
				</dd>
			</div>
			<div>
				<dt class="mb-1">Hip flexion</dt>
				<dd class="m-0">
					<output aria-label="Raw hip flexion" class="tabular-nums">
						{hipRaw === null ? 'No reliable measurement' : `${hipRaw.toFixed(1)} deg`}
					</output>
				</dd>
			</div>
			{/if}
		</dl>
	</details>
</section>
