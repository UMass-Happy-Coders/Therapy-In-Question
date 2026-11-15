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

<div class="relative aspect-video max-h-[44vh] min-h-48 w-full max-w-[960px] overflow-hidden rounded-lg bg-[var(--camera-background)]">
	<video bind:this={video} playsinline muted aria-label="Your camera preview" class="block h-full w-full -scale-x-100 object-contain"></video>

	{#if !live}
		<div class="absolute inset-0 grid place-content-center gap-3 text-center text-[var(--surface)]">
			<button onclick={start} disabled={!ready || pending}>
				{pending ? 'Starting camera...' : 'Start camera'}
			</button>
			{#if error}<p class="max-w-[40ch] text-[var(--camera-error)]" role="alert">{error}</p>{/if}
		</div>
	{:else}
		<button class="absolute right-3 top-3 z-10" onclick={stop}>Stop camera</button>
	{/if}
</div>

