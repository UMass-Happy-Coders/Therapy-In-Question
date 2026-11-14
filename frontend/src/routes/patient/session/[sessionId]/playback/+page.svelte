<script lang="ts">
	import SkeletonPlayback from '#lib/components/SkeletonPlayback.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Skeleton playback - {data.session.program.name}</title>
</svelte:head>

<main id="main-content" class="mx-auto max-w-[1440px] px-10 py-10">
	<a href={`/patient/session/${data.session.id}`} class="mb-5 inline-block">Back to session</a>
	<h1>Skeleton playback</h1>
	<p class="mb-8 text-lg">{data.session.program.name} - {data.session.session_date} (UTC)</p>
	{#key data.session.id}
		<SkeletonPlayback session={data.session} />
	{/key}
</main>
