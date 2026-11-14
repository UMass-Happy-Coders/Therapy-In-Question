<script lang="ts">
	import PoseSetup from '#lib/components/PoseSetup.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.exercise.name} - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="mx-auto max-w-[1440px] px-10 py-10">
	<a href="/patient" class="mb-5 inline-block">Back to programs</a>
	<h1>{data.exercise.name}</h1>
	<p class="mb-6">{data.assignment.program.name}</p>
	<dl class="mb-8 grid max-w-4xl grid-cols-4 gap-6">
		<div>
			<dt>Sets</dt>
			<dd class="m-0 text-lg font-semibold">{data.exercise.sets}</dd>
		</div>
		<div>
			<dt>Reps per set</dt>
			<dd class="m-0 text-lg font-semibold">{data.exercise.reps}</dd>
		</div>
		<div>
			<dt>{data.exercise.target_label}</dt>
			<dd class="m-0 text-lg font-semibold">{data.exercise.target_angle} degrees</dd>
		</div>
		<div>
			<dt>Hold per rep</dt>
			<dd class="m-0 text-lg font-semibold">
				{data.exercise.hold_seconds === 0 ? 'No hold' : `${data.exercise.hold_seconds} seconds`}
			</dd>
		</div>
	</dl>
	{#key data.exercise.id}
		<PoseSetup exercise={data.exercise} />
	{/key}
</main>
