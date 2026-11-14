<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="page-shell">
	<div class="page-intro">
		<h1>{page.status === 503 ? 'Temporarily unavailable' : 'We could not open this page'}</h1>
		<p class="muted" role="alert">{page.error?.message ?? 'Please try again.'}</p>
		<a class="button" href={page.url.pathname} data-sveltekit-reload>Try again</a>
	</div>
</main>
