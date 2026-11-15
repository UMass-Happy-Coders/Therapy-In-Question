<script lang="ts">
	import type { Snippet } from 'svelte';
	import ExerciseIllustration from '#lib/components/ExerciseIllustration.svelte';
	import { exerciseWalkthrough } from '#lib/pose/exercise-tutorial.js';
	import type { ProgramExercise } from '#lib/programs.js';

	let { exercise, oncontinue, children }: {
		exercise: ProgramExercise;
		oncontinue: () => void;
		children?: Snippet;
	} = $props();

	const walkthrough = $derived(exerciseWalkthrough(exercise));
</script>

<section aria-label="Exercise tutorial" class="py-2">
	<div class="mb-6 flex items-end justify-between gap-8">
		<div>
			<h2 class="mb-2 text-2xl">Learn the movement</h2>
			<p class="mb-0 text-sm">Follow these three steps before turning on your camera.</p>
		</div>
		<p class="mb-0 text-sm">Illustrations only. Your camera is off.</p>
	</div>

	<ol role="list" class="m-0 grid list-none grid-cols-3 gap-8 p-0">
		{#each walkthrough.steps as step, index (step.pose)}
			<li>
				<div class="mb-4 flex justify-center rounded-lg bg-[var(--surface)] py-2">
					<ExerciseIllustration exerciseType={exercise.exercise_type} pose={step.pose} targetAngle={exercise.target_angle} />
				</div>
				<h3 class="mb-2 flex items-center gap-3 text-lg font-semibold">
					<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ash-grey)] text-sm">{index + 1}</span>
					{step.title}
				</h3>
				<p class="mb-0 pl-10">{step.instruction}</p>
			</li>
		{/each}
	</ol>

	<div class="mt-8 grid grid-cols-[1fr_auto] items-center gap-10 rounded-lg bg-[var(--ash-grey)] p-6">
		<div>
			<h3 class="mb-2 text-lg font-semibold">Set up your camera</h3>
			<p class="mb-0 max-w-3xl text-sm">{walkthrough.camera}</p>
		</div>
		<button type="button" onclick={oncontinue} class="min-h-14 text-lg">
			I am ready - start camera
		</button>
	</div>
	<p class="mb-0 mt-4 max-w-4xl text-sm">Only do this exercise if assigned by your therapist. Stop if pain increases. Camera measurements are estimates and are not clinically validated.</p>
	{@render children?.()}
</section>
