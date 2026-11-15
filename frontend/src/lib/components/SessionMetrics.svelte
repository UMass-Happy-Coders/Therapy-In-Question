<script lang="ts">
	import { onMount } from 'svelte';
	import { isSessionMetrics, type PeriodTotals, type SessionMetrics } from '#lib/metrics.js';
	import { sessionSteps, type PatientSession } from '#lib/sessions.js';

	let { session }: { session: PatientSession } = $props();
	let metrics = $state<SessionMetrics | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	const plan = $derived(sessionSteps(session.program));
	const periods = $derived<{ label: string; totals: PeriodTotals }[]>(metrics
		? [
			{ label: `Day of ${session.session_date} (UTC)`, totals: metrics.day },
			{ label: 'Week from Monday (UTC)', totals: metrics.week }
		]
		: []);

	function clock(totalSeconds: number) {
		const whole = Math.floor(totalSeconds);
		return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
	}

	function degrees(value: number) {
		return `${value.toFixed(1)} deg`;
	}

	function seconds(milliseconds: number) {
		return `${(milliseconds / 1000).toFixed(1)} s`;
	}

	async function load() {
		loading = true;
		errorMessage = '';
		try {
			const response = await fetch(`/api/patient/sessions/${session.id}/metrics`, {
				cache: 'no-store', signal: AbortSignal.timeout(15000)
			});
			if (!response.ok) {
				errorMessage = response.status === 401 ? 'Sign in again to load saved measurements.' : 'Saved measurements are unavailable. Retry to load them.';
				return;
			}
			const value: unknown = await response.json();
			if (!isSessionMetrics(value)) {
				errorMessage = 'The service returned unexpected measurements.';
				return;
			}
			metrics = value;
		} catch {
			errorMessage = 'Saved measurements could not be reached. Retry to load them.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<section aria-labelledby="session-metrics-heading" class="mb-10">
	<h2 id="session-metrics-heading" class="mb-2">Saved measurements</h2>
	<p class="mb-6 text-sm">Camera estimates, not clinical measurements. Daily and weekly totals include your other sessions in the same period.</p>
	{#if errorMessage}
		<p role="alert" class="mb-3 text-[var(--error)]">{errorMessage}</p>
		<button class="button-secondary" onclick={load} disabled={loading}>Retry measurements</button>
	{:else if metrics === null}
		<p role="status" class="mb-0">Loading saved measurements...</p>
	{:else}
		<div class="mb-6 grid grid-cols-2 gap-6">
			{#each periods as period (period.label)}
				<section aria-label={period.label} class="rounded-lg bg-[var(--surface)] p-6">
					<h3 class="mb-4 text-lg font-semibold">{period.label}</h3>
					{#if period.totals.adherence}
						<dl class="mb-6 grid grid-cols-3 gap-4">
							<div><dt>Sets logged</dt><dd class="m-0 text-2xl font-semibold tabular-nums">{period.totals.adherence.sets_logged}</dd></div>
							<div><dt>Reps completed</dt><dd class="m-0 text-2xl font-semibold tabular-nums">{period.totals.adherence.reps_completed} / {period.totals.adherence.reps_prescribed}</dd></div>
							<div><dt>Active time</dt><dd class="m-0 text-2xl font-semibold tabular-nums">{clock(period.totals.adherence.active_seconds)}</dd></div>
						</dl>
					{:else}
						<p class="mb-6">No sets logged in this period.</p>
					{/if}
					{#if period.totals.movement.length}
						<table class="w-full border-collapse text-left text-sm">
							<thead class="bg-[var(--ash-grey)]">
								<tr>
									<th scope="col" class="p-3">Exercise</th><th scope="col" class="p-3">Reps</th>
									<th scope="col" class="p-3">Average range</th><th scope="col" class="p-3">Best range</th>
									<th scope="col" class="p-3">Average rep time</th>
								</tr>
							</thead>
							<tbody>
								{#each period.totals.movement as entry (entry.exercise_type)}
									<tr>
										<th scope="row" class="p-3 font-semibold">{entry.name}</th>
										<td class="p-3 tabular-nums">{entry.reps}</td>
										<td class="p-3 tabular-nums">{degrees(entry.avg_range_of_motion)}</td>
										<td class="p-3 tabular-nums">{degrees(entry.max_range_of_motion)}</td>
										<td class="p-3 tabular-nums">{seconds(entry.avg_duration_ms)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="mb-0">No counted reps in this period.</p>
					{/if}
				</section>
			{/each}
		</div>
		{#if metrics.reps.length}
			<details class="rounded-lg bg-[var(--surface)] p-5">
				<summary class="cursor-pointer text-lg font-semibold">Rep measurements in this session</summary>
			<table class="mt-5 w-full border-collapse text-left text-sm">
				<caption class="sr-only">Saved rep measurements</caption>
				<thead class="bg-[var(--ash-grey)]">
					<tr>
						<th scope="col" class="p-4">Exercise</th><th scope="col" class="p-4">Set</th>
						<th scope="col" class="p-4">Rep</th><th scope="col" class="p-4">Start</th>
						<th scope="col" class="p-4">Peak</th><th scope="col" class="p-4">Range of motion</th>
						<th scope="col" class="p-4">Target</th><th scope="col" class="p-4">Rep time</th>
						<th scope="col" class="p-4">Time at target</th>
					</tr>
				</thead>
				<tbody>
					{#each metrics.reps as rep (`${rep.set_ordinal}-${rep.rep_number}`)}
						<tr class="odd:bg-[var(--surface)]">
							<th scope="row" class="p-4 font-semibold">{plan[rep.set_ordinal]?.exercise.name ?? 'Exercise'}</th>
							<td class="p-4 tabular-nums">{plan[rep.set_ordinal]?.set_number ?? rep.set_ordinal + 1}</td>
							<td class="p-4 tabular-nums">{rep.rep_number}</td>
							<td class="p-4 tabular-nums">{degrees(rep.start_angle)}</td>
							<td class="p-4 tabular-nums">{degrees(rep.peak_angle)}</td>
							<td class="p-4 tabular-nums">{degrees(rep.range_of_motion)}</td>
							<td class="p-4 tabular-nums">{degrees(rep.target_angle)}</td>
							<td class="p-4 tabular-nums">{seconds(rep.duration_ms)}</td>
							<td class="p-4 tabular-nums">{seconds(rep.hold_ms)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			</details>
		{:else}
			<p class="mb-0">No counted reps were saved for this session.</p>
		{/if}
	{/if}
</section>
