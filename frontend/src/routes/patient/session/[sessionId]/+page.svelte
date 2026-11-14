<script lang="ts">
	import SessionFlow from '#lib/components/SessionFlow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.session.program.name} - Therapy in Question</title>
</svelte:head>

{#key data.session.id}
	<SessionFlow initial={data.session} />
{/key}
