<script lang="ts">
	import Webcam from '#lib/components/Webcam.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function assignedDate(value: string) {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeZone: 'UTC'
		}).format(new Date(value));
	}
</script>

<svelte:head>
	<title>Your programs - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="page-shell">
	<h1>Your programs</h1>
	<div class="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-12">
		<section aria-label="Assigned exercise programs" class="space-y-10">
			{#if data.programs.length === 0}
				<div class="rounded-lg bg-[var(--surface)] p-6">
					<h2>No program assigned</h2>
				</div>
			{:else}
				{#each data.programs as assignment (assignment.id)}
					<article class="rounded-lg bg-[var(--surface)] p-7">
						<h2>{assignment.program.name}</h2>
						<p class="mb-5 text-sm">
							Assigned by {assignment.therapist_name} on {assignedDate(assignment.assigned_at)}
						</p>
						{#if assignment.program.notes}
							<p class="mb-6 whitespace-pre-wrap break-words">{assignment.program.notes}</p>
						{/if}
						<ol class="m-0 list-none space-y-6 p-0">
							{#each assignment.program.exercises as exercise, index (exercise.id)}
								<li>
									<h3 class="mb-2 text-lg font-semibold">
										{index + 1}. {exercise.name}
									</h3>
									<dl class="m-0 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
										<div>
											<dt>Sets and reps</dt>
											<dd class="m-0 font-semibold">{exercise.sets} sets of {exercise.reps} reps</dd>
										</div>
										<div>
											<dt>{exercise.target_label}</dt>
											<dd class="m-0 font-semibold">{exercise.target_angle} degrees</dd>
										</div>
										<div>
											<dt>Hold per rep</dt>
											<dd class="m-0 font-semibold">
												{exercise.hold_seconds === 0 ? 'No hold' : `${exercise.hold_seconds} seconds`}
											</dd>
										</div>
									</dl>
									<a
										href={`/patient/exercise/${assignment.id}/${exercise.id}`}
										class="button mt-4"
										aria-label={`Set up camera for ${exercise.name}`}
									>Set up camera</a>
								</li>
							{/each}
						</ol>
					</article>
				{/each}
			{/if}
		</section>
		<section aria-label="Camera preview">
			<h2>Camera preview</h2>
			<Webcam />
		</section>
	</div>
</main>
