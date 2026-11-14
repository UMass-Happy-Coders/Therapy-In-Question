<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	interface Props {
		video?: HTMLVideoElement;
		live?: boolean;
	}

	let { video = $bindable(), live = $bindable(false) }: Props = $props();

	let stream: MediaStream | null = null;
	let error = $state('');
	let ready = $state(false);
	let pending = $state(false);
	let destroyed = false;

	onMount(() => {
		ready = true;
	});

	async function start() {
		if (pending || live) return;
		error = '';
		if (!navigator.mediaDevices?.getUserMedia) {
			error = 'Camera unavailable: open the site over HTTPS or on localhost.';
			return;
		}
		pending = true;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false
			});
			if (destroyed) return stop();
			video!.srcObject = stream;
			await video!.play();
			live = true;
		} catch (e) {
			stop();
			const name = e instanceof DOMException ? e.name : '';
			error =
				name === 'NotAllowedError'
					? 'Camera permission denied. Allow it in the browser address bar and try again.'
					: name === 'NotFoundError'
						? 'No camera found.'
						: name === 'NotReadableError'
							? 'Camera is in use by another app.'
							: `Could not start camera: ${e}`;
		} finally {
			pending = false;
		}
	}

	function stop() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (video) video.srcObject = null;
		live = false;
	}

	onDestroy(() => {
		destroyed = true;
		stop();
	});
</script>

<div class="webcam">
	<video bind:this={video} playsinline muted aria-label="Your camera preview"></video>

	{#if !live}
		<div class="overlay">
			<button onclick={start} disabled={!ready || pending}>
				{pending ? 'Starting camera...' : 'Start camera'}
			</button>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>
	{:else}
		<button class="stop" onclick={stop}>Stop camera</button>
	{/if}
</div>

<style>
	.webcam {
		position: relative;
		width: 100%;
		max-width: 960px;
		aspect-ratio: 16 / 9;
		min-height: 12rem;
		background: var(--camera-background);
		border-radius: 8px;
		overflow: hidden;
	}

	video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		transform: scaleX(-1);
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.75rem;
		text-align: center;
		color: var(--surface);
	}

	.error {
		color: var(--camera-error);
		max-width: 40ch;
	}

	.stop {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
	}
</style>
