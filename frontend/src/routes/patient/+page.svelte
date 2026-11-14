<script lang="ts">
	import Webcam from '#lib/components/Webcam.svelte';
</script>

<svelte:head>
	<title>Camera preview - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="page-shell">
	<div class="page-intro">
		<h1>Camera preview</h1>
	</div>
	<section aria-label="Your camera preview">
		<Webcam />
	</section>
</main>

<style>
</style>
