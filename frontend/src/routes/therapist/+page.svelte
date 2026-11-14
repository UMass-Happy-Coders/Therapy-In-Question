<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Clinic patients - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="page-shell">
	<div class="page-intro">
		<h1>Clinic patients</h1>
	</div>
	<section aria-label="Patient roster">
		{#if data.patients.length === 0}
			<p class="empty-state muted">No patients are registered at this clinic yet.</p>
		{:else}
			<ul class="roster">
				{#each data.patients as patient (patient.id)}
					<li>
						<span class="patient-name">{patient.full_name}</span>
						<span class="patient-email muted">{patient.email}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.roster {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.roster li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.5rem 2rem;
		padding: 1.25rem 0;
		overflow-wrap: anywhere;
	}

	.patient-name {
		font-weight: 600;
	}

	.empty-state {
		padding: 1.25rem 0;
	}

	@media (max-width: 520px) {
		.roster li {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.15rem;
		}
	}
</style>
