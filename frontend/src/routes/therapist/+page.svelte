<script lang="ts">
	import { isProgram, type ExerciseDefinition, type Program } from '#lib/programs.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	interface DraftExercise {
		key: number;
		definition: ExerciseDefinition;
		sets: number | undefined;
		reps: number | undefined;
		target_angle: number | undefined;
		hold_seconds: number | undefined;
	}

	const fieldClass = 'w-full rounded border border-(--border) bg-(--surface) px-3 py-2 text-(--chocolate-plum)';
	const textButtonClass = 'button-secondary border-transparent! px-2! py-1! text-sm underline underline-offset-4';
	let draftName = $state('');
	let draftNotes = $state('');
	let draftExercises = $state<DraftExercise[]>([]);
	let draftPatientId = $state('');
	let exerciseId = $state('');
	let nextKey = 0;
	let updatedPrograms = $state<Program[]>([]);
	let selectedId = $state('');
	let assignmentPatientId = $state('');
	let revokePatientId = $state('');
	let pending = $state<'save' | 'assign' | 'revoke' | null>(null);
	let errorMessage = $state('');
	let successMessage = $state('');
	let sessionExpired = $state(false);

	const programs = $derived([
		...updatedPrograms,
		...data.programs.filter((program) => !updatedPrograms.some((updated) => updated.id === program.id))
	].sort((a, b) => b.created_at.localeCompare(a.created_at)));
	const selectedProgram = $derived(programs.find((program) => program.id === selectedId));
	const pickedExercise = $derived(data.exercises.find((exercise) => exercise.id === exerciseId));
	const availablePatients = $derived(
		data.patients.filter(
			(patient) => !selectedProgram?.assignments.some((assignment) => assignment.patient_id === patient.id)
		)
	);

	function clearMessages() {
		errorMessage = '';
		successMessage = '';
		sessionExpired = false;
	}

	function updateProgram(program: Program) {
		updatedPrograms = [program, ...updatedPrograms.filter((saved) => saved.id !== program.id)];
	}

	function addExercise() {
		if (!pickedExercise || draftExercises.length >= 12 || pending) return;
		draftExercises = [...draftExercises, {
			key: nextKey++,
			definition: pickedExercise,
			sets: 2,
			reps: 10,
			target_angle: pickedExercise.target_default,
			hold_seconds: 0
		}];
	}

	function moveExercise(index: number, direction: -1 | 1) {
		const destination = index + direction;
		if (pending || destination < 0 || destination >= draftExercises.length) return;
		const reordered = [...draftExercises];
		[reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
		draftExercises = reordered;
	}

	function resetDraft() {
		if (pending) return;
		if (
			(draftName || draftNotes || draftExercises.length || draftPatientId) &&
			!window.confirm('Discard this unsaved draft?')
		) return;
		draftName = '';
		draftNotes = '';
		draftExercises = [];
		draftPatientId = '';
		exerciseId = '';
		clearMessages();
	}

	function copyProgram(program: Program) {
		if (pending) return;
		if (
			(draftName || draftNotes || draftExercises.length || draftPatientId) &&
			!window.confirm('Replace this unsaved draft with a copy of the saved program?')
		) return;
		clearMessages();
		const copied: DraftExercise[] = [];
		for (const exercise of program.exercises) {
			const definition = data.exercises.find((entry) => entry.id === exercise.exercise_type);
			if (!definition) {
				errorMessage = 'An exercise in this program is no longer available. Your draft has not changed.';
				return;
			}
			copied.push({
				key: nextKey++,
				definition,
				sets: exercise.sets,
				reps: exercise.reps,
				target_angle: exercise.target_angle,
				hold_seconds: exercise.hold_seconds
			});
		}
		draftName = `${program.name.slice(0, 115)} copy`;
		draftNotes = program.notes;
		draftExercises = copied;
		draftPatientId = '';
		exerciseId = '';
		successMessage = 'Copied to a new draft. The saved program and its assignments have not changed.';
	}

	async function mutation(
		path: '/api/therapist/programs' | `/api/therapist/programs/${string}/assignments` | `/api/therapist/programs/${string}/assignments/${string}`,
		method: 'POST' | 'DELETE',
		body?: unknown
	): Promise<Response> {
		const response = await fetch(path, {
			method,
			headers: {
				'Content-Type': 'application/json',
				'X-Requested-With': 'TherapyInQuestion'
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (response.ok) return response;
		sessionExpired = response.status === 401;
		throw new Error(
			response.status === 401
				? 'Your session expired. Your draft is still here. Sign in again before retrying.'
				: response.status === 403
					? 'You do not have permission to change programs for this clinic.'
					: response.status === 404
						? 'This program or patient is no longer available. Refresh the workspace before retrying.'
						: response.status === 422
							? 'Check the program name, exercise values, and patient selection, then try again.'
							: 'The change could not be completed. Please try again.'
		);
	}

	async function readProgram(response: Response): Promise<Program> {
		const program: unknown = await response.json();
		if (!isProgram(program)) {
			throw new Error('The service returned an unexpected response. Refresh saved programs before retrying.');
		}
		return program;
	}

	async function saveProgram(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		clearMessages();
		const name = draftName.trim();
		if (!name) {
			errorMessage = 'Enter a program name.';
			return;
		}
		if (!draftExercises.length) {
			errorMessage = 'Add at least one exercise before saving.';
			return;
		}
		for (const [index, exercise] of draftExercises.entries()) {
			const { sets, reps, target_angle, hold_seconds, definition } = exercise;
			if (
				sets === undefined || !Number.isInteger(sets) || sets < 1 || sets > 10 ||
				reps === undefined || !Number.isInteger(reps) || reps < 1 || reps > 100 ||
				target_angle === undefined || !Number.isFinite(target_angle) ||
				target_angle < definition.target_min || target_angle > definition.target_max ||
				hold_seconds === undefined || !Number.isInteger(hold_seconds) || hold_seconds < 0 || hold_seconds > 60
			) {
				errorMessage = `Check the values for exercise ${index + 1}: ${definition.name}.`;
				return;
			}
		}
		pending = 'save';
		try {
			const response = await mutation('/api/therapist/programs', 'POST', {
				name,
				notes: draftNotes.trim(),
				patient_id: draftPatientId || null,
				exercises: draftExercises.map((exercise) => ({
					exercise_type: exercise.definition.id,
					sets: exercise.sets,
					reps: exercise.reps,
					target_angle: exercise.target_angle,
					hold_seconds: exercise.hold_seconds
				}))
			});
			const program = await readProgram(response);
			updateProgram(program);
			selectedId = program.id;
			assignmentPatientId = '';
			revokePatientId = '';
			const patient = data.patients.find((entry) => entry.id === draftPatientId);
			successMessage = patient
				? `"${program.name}" saved and assigned to ${patient.full_name}.`
				: `"${program.name}" saved. You can assign it from Saved programs.`;
			draftName = '';
			draftNotes = '';
			draftExercises = [];
			draftPatientId = '';
			exerciseId = '';
		} catch (cause) {
			errorMessage = cause instanceof Error && cause.name !== 'TypeError' && cause.name !== 'SyntaxError'
				? cause.message
				: 'We could not confirm the save. Your draft is still here. Check saved programs before retrying.';
		} finally {
			pending = null;
		}
	}

	async function assignProgram(event: SubmitEvent) {
		event.preventDefault();
		if (pending || !selectedProgram || !assignmentPatientId) return;
		const program = selectedProgram;
		const patient = data.patients.find((entry) => entry.id === assignmentPatientId);
		if (!patient) return;
		clearMessages();
		pending = 'assign';
		try {
			const response = await mutation(
				`/api/therapist/programs/${encodeURIComponent(program.id)}/assignments`,
				'POST',
				{ patient_id: patient.id }
			);
			updateProgram(await readProgram(response));
			assignmentPatientId = '';
			successMessage = `"${program.name}" assigned to ${patient.full_name}.`;
		} catch (cause) {
			errorMessage = cause instanceof Error && cause.name !== 'TypeError' && cause.name !== 'SyntaxError'
				? cause.message
				: 'We could not confirm the assignment. Check your connection and try again.';
		} finally {
			pending = null;
		}
	}

	async function revokeAssignment(patientId: string) {
		if (pending || !selectedProgram || revokePatientId !== patientId) return;
		const program = selectedProgram;
		const assignment = program.assignments.find((entry) => entry.patient_id === patientId);
		if (!assignment) return;
		clearMessages();
		pending = 'revoke';
		try {
			const response = await mutation(
				`/api/therapist/programs/${encodeURIComponent(program.id)}/assignments/${encodeURIComponent(patientId)}`,
				'DELETE'
			);
			if (response.status !== 204) {
				throw new Error('The service returned an unexpected response. Refresh saved programs before retrying.');
			}
			updateProgram({
				...program,
				assignments: program.assignments.filter((entry) => entry.patient_id !== patientId)
			});
			revokePatientId = '';
			successMessage = `"${program.name}" is no longer assigned to ${assignment.patient_name}.`;
		} catch (cause) {
			errorMessage = cause instanceof Error && cause.name !== 'TypeError'
				? cause.message
				: 'We could not confirm the removal. Check your connection and try again.';
		} finally {
			pending = null;
		}
	}
</script>

<svelte:head>
	<title>Programs - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="mx-auto max-w-[1440px] px-10 py-10">
	<header class="mb-8 flex items-end justify-between gap-8">
		<div>
			<h1>Programs</h1>
			<p class="mb-0">Build a routine, then assign it to a clinic patient.</p>
		</div>
		<a href="#clinic-patients" class="shrink-0">Clinic patients ({data.patients.length})</a>
	</header>

	{#if errorMessage}
		<div class="mb-6 rounded bg-(--camera-error) p-4 text-(--error)" role="alert">
			<p class="mb-0">{errorMessage}</p>
			{#if sessionExpired}<a href="/login" target="_blank" rel="noreferrer">Sign in in a new tab</a>{/if}
		</div>
	{/if}
	{#if successMessage}
		<p class="mb-6 rounded bg-(--surface-hover) p-4" role="status">{successMessage}</p>
	{/if}

	<div class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-10">
		<section aria-labelledby="draft-heading" class="min-w-0 rounded-md bg-(--surface) p-6">
			<div class="mb-5 flex items-center justify-between gap-4">
				<h2 id="draft-heading" class="mb-0">New program</h2>
				<button type="button" class={textButtonClass} onclick={resetDraft} disabled={pending !== null}>Clear draft</button>
			</div>
			<form onsubmit={saveProgram} aria-busy={pending === 'save'}>
				<fieldset class="m-0 min-w-0 border-0 p-0" disabled={pending !== null}>
					<legend class="sr-only">Program details and exercises</legend>
					<label for="program-name" class="mb-1 block font-semibold">Program name</label>
					<input id="program-name" class={fieldClass} bind:value={draftName} maxlength="120" required placeholder="For example, Knee strength - week 1" />
					<label for="program-notes" class="mt-4 mb-1 block font-semibold">Patient instructions <span class="font-normal">(optional)</span></label>
					<textarea id="program-notes" class={fieldClass} bind:value={draftNotes} rows="3" maxlength="2000"></textarea>

					<div class="mt-6">
						<label for="exercise-picker" class="mb-1 block font-semibold">Add an exercise</label>
						<div class="flex items-start gap-3">
							<select id="exercise-picker" class={fieldClass} bind:value={exerciseId}>
								<option value="">Choose an exercise</option>
								{#each data.exercises as exercise (exercise.id)}
									<option value={exercise.id}>{exercise.name}</option>
								{/each}
							</select>
							<button type="button" class="button-secondary shrink-0" onclick={addExercise} disabled={!pickedExercise || draftExercises.length >= 12}>Add exercise</button>
						</div>
						{#if pickedExercise}<p class="mt-2 mb-0 text-sm">{pickedExercise.description}</p>{/if}
						{#if data.exercises.length === 0}<p class="mt-2 mb-0">No exercises are available. Please try again later.</p>{/if}
					</div>

					<h3 class="mt-6 mb-3 text-lg font-semibold">Exercise order <span class="text-sm font-normal">({draftExercises.length}/12)</span></h3>
					{#if draftExercises.length === 0}
						<p class="mb-0 py-4">No exercises yet. Choose an exercise above to start this routine.</p>
					{:else}
						<ol class="m-0 list-none space-y-6 p-0">
							{#each draftExercises as exercise, index (exercise.key)}
								<li>
									<fieldset class="m-0 min-w-0 border-0 p-0">
										<legend class="mb-2 font-semibold">{index + 1}. {exercise.definition.name}</legend>
										<div class="grid grid-cols-[0.7fr_0.7fr_1.3fr_1fr] gap-3">
											<label class="block text-sm" for={`sets-${exercise.key}`}>Sets
												<input id={`sets-${exercise.key}`} class={fieldClass} type="number" min="1" max="10" step="1" required bind:value={exercise.sets} />
											</label>
											<label class="block text-sm" for={`reps-${exercise.key}`}>Reps
												<input id={`reps-${exercise.key}`} class={fieldClass} type="number" min="1" max="100" step="1" required bind:value={exercise.reps} />
											</label>
											<label class="block text-sm" for={`angle-${exercise.key}`}>{exercise.definition.target_label} (deg)
												<input id={`angle-${exercise.key}`} class={fieldClass} type="number" min={exercise.definition.target_min} max={exercise.definition.target_max} step="any" required bind:value={exercise.target_angle} aria-describedby={`range-${exercise.key}`} />
											</label>
											<label class="block text-sm" for={`hold-${exercise.key}`}>Hold (sec)
												<input id={`hold-${exercise.key}`} class={fieldClass} type="number" min="0" max="60" step="1" required bind:value={exercise.hold_seconds} />
											</label>
										</div>
										<div class="mt-1 flex flex-wrap items-center justify-between gap-2">
											<span id={`range-${exercise.key}`} class="text-xs">Target range: {exercise.definition.target_min}-{exercise.definition.target_max} deg</span>
											<div class="flex gap-1">
												<button type="button" class={textButtonClass} onclick={() => moveExercise(index, -1)} disabled={index === 0} aria-label={`Move exercise ${index + 1} up`}>Move up</button>
												<button type="button" class={textButtonClass} onclick={() => moveExercise(index, 1)} disabled={index === draftExercises.length - 1} aria-label={`Move exercise ${index + 1} down`}>Move down</button>
												<button type="button" class={textButtonClass} onclick={() => { draftExercises = draftExercises.filter((row) => row.key !== exercise.key); }} aria-label={`Remove exercise ${index + 1}: ${exercise.definition.name}`}>Remove</button>
											</div>
										</div>
									</fieldset>
								</li>
							{/each}
						</ol>
					{/if}

					<label for="draft-patient" class="mt-6 mb-1 block font-semibold">Assign when saving <span class="font-normal">(optional)</span></label>
					<select id="draft-patient" class={fieldClass} bind:value={draftPatientId}>
						<option value="">Save without assigning</option>
						{#each data.patients as patient (patient.id)}
							<option value={patient.id}>{patient.full_name} - {patient.email}</option>
						{/each}
					</select>
					<p class="mt-3 mb-4 text-sm">Saved routines stay unchanged. To revise a routine, use it as a new draft.</p>
					<button type="submit" disabled={data.exercises.length === 0}>
						{pending === 'save' ? 'Saving program...' : draftPatientId ? 'Save and assign' : 'Save program'}
					</button>
				</fieldset>
			</form>
		</section>

		<section aria-labelledby="saved-heading" class="min-w-0">
			<h2 id="saved-heading" class="mb-4">Saved programs ({programs.length})</h2>
			{#if programs.length === 0}
				<p>No saved programs yet. Save your first routine using the composer.</p>
			{:else}
				<label for="saved-program" class="mb-1 block font-semibold">View a saved program</label>
				<select id="saved-program" class={fieldClass} bind:value={selectedId} disabled={pending !== null} onchange={() => { assignmentPatientId = ''; revokePatientId = ''; }}>
					<option value="">Choose a program</option>
					{#each programs as program (program.id)}
						<option value={program.id}>{program.name} - {program.created_at.slice(0, 10)}</option>
					{/each}
				</select>
				{#if selectedProgram}
					<article class="mt-6" aria-labelledby="selected-program-name">
						<h3 id="selected-program-name" class="mb-1 wrap-anywhere text-xl font-semibold">{selectedProgram.name}</h3>
						<p class="mb-4 text-sm">Saved {selectedProgram.created_at.slice(0, 10)} by {selectedProgram.created_by_name}</p>
						{#if selectedProgram.notes}
							<h4 class="mb-1 font-semibold">Patient instructions</h4>
							<p class="mb-5 whitespace-pre-wrap wrap-anywhere">{selectedProgram.notes}</p>
						{/if}
						<ol class="m-0 list-none space-y-4 p-0" aria-label="Saved exercise order">
							{#each selectedProgram.exercises as exercise, index (exercise.id)}
								<li>
									<p class="mb-1 font-semibold">{index + 1}. {exercise.name}</p>
									<p class="mb-0 text-sm">{exercise.sets} sets of {exercise.reps} reps</p>
									<p class="mb-0 text-sm">{exercise.target_label}: {exercise.target_angle} deg; hold {exercise.hold_seconds} sec</p>
								</li>
							{/each}
						</ol>
						<button type="button" class="button-secondary mt-5" onclick={() => { if (selectedProgram) copyProgram(selectedProgram); }} disabled={pending !== null}>Use as new draft</button>

						<section aria-labelledby="assignments-heading" class="mt-8">
							<h3 id="assignments-heading" class="mb-3 text-lg font-semibold">Assigned patients ({selectedProgram.assignments.length})</h3>
							{#if selectedProgram.assignments.length === 0}
								<p>This routine is not assigned to any patients.</p>
							{:else}
								<ul class="m-0 list-none space-y-4 p-0">
									{#each selectedProgram.assignments as assignment (assignment.id)}
										<li>
											<div class="flex items-center justify-between gap-3">
												<div class="min-w-0">
													<p class="mb-0 wrap-anywhere font-semibold">{assignment.patient_name}</p>
													<p class="mb-0 text-sm">Assigned {assignment.assigned_at.slice(0, 10)}</p>
												</div>
												<button type="button" class={textButtonClass} onclick={() => { revokePatientId = assignment.patient_id; }} disabled={pending !== null} aria-label={`Remove assignment for ${assignment.patient_name}`}>Remove assignment</button>
											</div>
											{#if revokePatientId === assignment.patient_id}
												<div class="mt-2 rounded bg-(--surface) p-3">
													<p class="mb-2">Remove this routine from {assignment.patient_name}'s programs?</p>
													<div class="flex gap-3">
														<button type="button" onclick={() => revokeAssignment(assignment.patient_id)} disabled={pending !== null}>{pending === 'revoke' ? 'Removing...' : 'Confirm removal'}</button>
														<button type="button" class="button-secondary" onclick={() => { revokePatientId = ''; }} disabled={pending !== null}>Keep assignment</button>
													</div>
												</div>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
							{#if availablePatients.length > 0}
								<form class="mt-5" onsubmit={assignProgram} aria-busy={pending === 'assign'}>
									<label for="assign-patient" class="mb-1 block font-semibold">Assign to a patient</label>
									<select id="assign-patient" class={fieldClass} bind:value={assignmentPatientId} required disabled={pending !== null}>
										<option value="">Choose a patient</option>
										{#each availablePatients as patient (patient.id)}
											<option value={patient.id}>{patient.full_name} - {patient.email}</option>
										{/each}
									</select>
									<button type="submit" class="mt-3" disabled={pending !== null || !assignmentPatientId}>{pending === 'assign' ? 'Assigning...' : 'Assign program'}</button>
								</form>
							{:else if data.patients.length > 0}
								<p class="mt-4 mb-0 text-sm">This routine is assigned to every clinic patient.</p>
							{:else}
								<p class="mt-4 mb-0 text-sm">No clinic patients are available for assignment.</p>
							{/if}
						</section>
					</article>
				{:else}
					<p class="mt-4">Choose a saved program to review its routine and patient assignments.</p>
				{/if}
			{/if}
		</section>
	</div>

	<section id="clinic-patients" aria-labelledby="patients-heading" class="mt-12 scroll-mt-6">
		<h2 id="patients-heading" class="mb-4">Clinic patients ({data.patients.length})</h2>
		{#if data.patients.length === 0}
			<p>No patients are registered at this clinic yet. You can still save programs for later.</p>
		{:else}
			<table class="w-full table-fixed border-collapse text-left">
				<caption class="sr-only">Patient roster and assigned programs</caption>
				<thead>
					<tr>
						<th scope="col" class="w-1/4 pb-3 pr-6 font-semibold">Patient</th>
						<th scope="col" class="w-1/3 pb-3 pr-6 font-semibold">Email</th>
						<th scope="col" class="pb-3 font-semibold">Assigned programs</th>
					</tr>
				</thead>
				<tbody>
					{#each data.patients as patient (patient.id)}
						{@const assigned = programs.filter((program) => program.assignments.some((assignment) => assignment.patient_id === patient.id))}
						<tr class="align-top">
							<th scope="row" class="py-3 pr-6 wrap-anywhere font-semibold">{patient.full_name}</th>
							<td class="py-3 pr-6 wrap-anywhere">{patient.email}</td>
							<td class="py-3">
								{#if assigned.length === 0}
									<span>No assigned programs</span>
								{:else}
									<ul class="m-0 list-none p-0">
										{#each assigned as program (program.id)}
											<li>
												<button type="button" class={`${textButtonClass} max-w-full px-0! text-left! wrap-anywhere`} onclick={() => { selectedId = program.id; assignmentPatientId = ''; revokePatientId = ''; document.getElementById('saved-heading')?.scrollIntoView({ block: 'start' }); }} disabled={pending !== null} aria-label={`View ${program.name}, assigned to ${patient.full_name}`}>{program.name}</button>
											</li>
										{/each}
									</ul>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</main>
