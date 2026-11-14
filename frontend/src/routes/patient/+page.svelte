<script lang="ts">
	import { goto } from '$app/navigation';
	import Webcam from '#lib/components/Webcam.svelte';
	import { isPatientSession } from '#lib/sessions.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let starting = $state<string | null>(null);
	let errorAssignment = $state<string | null>(null);
	let startError = $state('');
	const todaySessions = $derived(new Map(data.sessions.map((session) => [session.assignment_id, session] as const)));

	async function startSession(assignmentId: string) {
		if (starting) return;
		starting = assignmentId;
		errorAssignment = assignmentId;
		startError = '';
		try {
			const response = await fetch('/api/patient/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TherapyInQuestion' },
				body: JSON.stringify({ assignment_id: assignmentId })
			});
			if (response.status === 401) {
				await goto('/login');
				return;
			}
			if (!response.ok) {
				startError = 'We could not start this session. Please reload and try again.';
				return;
			}
			const session: unknown = await response.json();
			if (!isPatientSession(session) || session.assignment_id !== assignmentId) {
				startError = 'The service returned an unexpected session. Please reload.';
				return;
			}
			await goto(`/patient/session/${session.id}`);
		} catch {
			startError = 'We could not reach the service. Please try again.';
		} finally {
			starting = null;
		}
	}

	function assignedDate(value: string) {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeZone: 'UTC'
		}).format(new Date(value));
	}
</script>

<svelte:head>
	<title>Today's programs - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="page-shell">
	<h1>Today's programs</h1>
	<p class="mb-8">{assignedDate(data.today)} (UTC)</p>
	<div class="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-12">
		<section aria-label="Assigned exercise programs" class="space-y-10">
			{#if data.programs.length === 0}
				<div class="rounded-lg bg-[var(--surface)] p-6">
					<h2>No program assigned</h2>
				</div>
			{:else}
				{#each data.programs as assignment (assignment.id)}
				{@const session = todaySessions.get(assignment.id)}
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
					<div class="mt-7 flex items-center gap-5">
						{#if session}
							<a href={`/patient/session/${session.id}`} class="button">{session.status === 'completed' ? 'View session summary' : 'Continue session'}</a>
							<span>{session.sets.length} of {session.program.exercises.reduce((total, exercise) => total + exercise.sets, 0)} sets logged</span>
						{:else}
							<button onclick={() => startSession(assignment.id)} disabled={starting !== null}>{starting === assignment.id ? 'Starting session...' : 'Start session'}</button>
						{/if}
					</div>
					{#if startError && errorAssignment === assignment.id}
						<p role="alert" class="mt-4 text-[var(--error)]">{startError}</p>
					{/if}
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
