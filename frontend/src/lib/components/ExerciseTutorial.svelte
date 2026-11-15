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

<section aria-label="Exercise tutorial" class="py-6">
	<h2 class="mb-2">Learn the movement</h2>
	<p class="mb-2 text-xl font-semibold">{exercise.name}</p>
	<p class="mb-2">
		Assigned target: {exercise.target_label} {exercise.target_angle} degrees.
		{#if exercise.hold_seconds > 0}
			Hold for {exercise.hold_seconds} {exercise.hold_seconds === 1 ? 'second' : 'seconds'}.
		{:else}
			No hold assigned.
		{/if}
	</p>
	<p class="mb-5 muted">Movement illustrations only, not measurements of your movement. The camera is not on yet.</p>

	<ol role="list" class="m-0 grid list-none grid-cols-1 gap-6 p-0 md:grid-cols-3">
		{#each walkthrough.steps as step, index (step.pose)}
			<li>
				<ExerciseIllustration exerciseType={exercise.exercise_type} pose={step.pose} targetAngle={exercise.target_angle} />
				<h3 class="mb-2 mt-2 text-lg font-semibold">{index + 1}. {step.title}</h3>
				<p class="mb-0">{step.instruction}</p>
			</li>
		{/each}
	</ol>

	<div class="mt-6 max-w-4xl">
		<h3 class="mb-2 text-lg font-semibold">Set up your camera</h3>
		<p class="mb-3">{walkthrough.camera}</p>
		<p class="mb-5">Only do this exercise if assigned by your therapist. Stop if pain increases. Camera measurements are estimates and are not clinically validated.</p>
	</div>
	{@render children?.()}
	<button type="button" onclick={oncontinue} class="min-h-14 w-full text-lg sm:w-auto">
		I am ready - start camera
	</button>
</section>
