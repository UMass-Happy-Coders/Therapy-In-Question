<script lang="ts">
	import { homeFor } from '#lib/auth.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Home exercise programs - Therapy in Question</title>
	<meta
		name="description"
		content="Follow your therapist's home exercise program with movement targets and camera-based tracking, without storing video."
	/>
</svelte:head>

<main id="main-content" class="mx-auto max-w-6xl px-12 pb-16 pt-16">
	<section aria-labelledby="overview-heading" class="grid grid-cols-[1.25fr_0.75fr] items-center gap-16 pb-16">
		<div>
			<h1 id="overview-heading" class="max-w-[680px] text-6xl! leading-[1.08]! tracking-[-0.045em]!">
				Your home exercises.<br />A clearer plan.
			</h1>
			<p class="mb-8 mt-6 max-w-[540px] text-xl leading-relaxed">
				Your therapist sets the exercises and targets. Follow your routine and keep up with your program between visits.
			</p>
			{#if data.user}
				<a href={homeFor(data.user)} class="button">Return to your workspace</a>
			{:else}
				<nav aria-label="Choose your workspace" class="flex flex-wrap gap-3">
					<a href="/patient" class="button">Patient workspace</a>
					<a href="/therapist" class="button button-secondary">Therapist workspace</a>
				</nav>
			{/if}
		</div>

		<aside aria-labelledby="movements-heading" class="rounded-lg bg-[var(--ash-grey)] p-8">
			<h2 id="movements-heading" class="mb-8 text-2xl!">Supported exercises</h2>
			<ul class="m-0 list-none space-y-6 p-0 text-lg font-semibold">
				<li>Seated knee extension</li>
				<li>Straight leg raise</li>
				<li>Sit-to-stand</li>
			</ul>
		</aside>
	</section>

	<section id="how-it-works" aria-labelledby="workflow-heading" class="scroll-mt-8 pb-14">
		<h2 id="workflow-heading" class="mb-8 text-3xl!">From your therapist to your routine</h2>
		<ol class="m-0 grid list-none grid-cols-3 gap-12 p-0">
			<li>
				<h3 class="mb-3 text-xl font-semibold">Get your program</h3>
				<p class="mb-0">Exercises, sets, reps, and movement targets assigned by your therapist.</p>
			</li>
			<li>
				<h3 class="mb-3 text-xl font-semibold">Follow your routine</h3>
				<p class="mb-0">Open each exercise from your program and use your camera as you move.</p>
			</li>
			<li>
				<h3 class="mb-3 text-xl font-semibold">Hear from your therapist</h3>
				<p class="mb-0">Read therapist-approved follow-ups in your patient inbox.</p>
			</li>
		</ol>
	</section>

	<section id="privacy" aria-labelledby="privacy-heading" class="grid scroll-mt-8 grid-cols-[0.9fr_1.1fr] items-center gap-12 rounded-lg bg-[var(--surface)] p-8">
		<h2 id="privacy-heading" class="mb-0 text-3xl!">Movement tracking.<br />No video recordings.</h2>
		<p class="mb-0 text-lg">Camera frames are processed in your browser, not saved as a video.</p>
	</section>
</main>
