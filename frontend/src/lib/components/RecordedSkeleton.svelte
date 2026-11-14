<script lang="ts">
	import { onMount } from 'svelte';
	import type { PoseLandmarker } from '@mediapipe/tasks-vision';
	import type { RecordedFrame, RecordedPoint } from '#lib/pose/recording.js';
	import type { WorldBounds } from '#lib/pose/playback.js';

	interface Props {
		frame: RecordedFrame | null;
		bounds: WorldBounds | null;
		frameNumber: number;
	}

	let { frame, bounds, frameNumber }: Props = $props();
	let canvas: HTMLCanvasElement;
	let context = $state.raw<CanvasRenderingContext2D | null>(null);
	let connections = $state.raw<Readonly<typeof PoseLandmarker.POSE_CONNECTIONS>>([]);
	let error = $state('');
	let lineColor = '';
	let pointColor = '';

	onMount(() => {
		let destroyed = false;
		const palette = getComputedStyle(canvas);
		lineColor = palette.getPropertyValue('--chocolate-plum').trim();
		pointColor = palette.getPropertyValue('--terracotta-clay').trim();
		context = canvas.getContext('2d');
		if (!context) {
			error = 'Could not display the recorded skeleton: canvas rendering is unavailable.';
			return;
		}
		void import('@mediapipe/tasks-vision').then(
			(vision) => {
				if (!destroyed) connections = vision.PoseLandmarker.POSE_CONNECTIONS;
			},
			(reason: unknown) => {
				if (!destroyed) {
					error = `Could not load the recorded skeleton renderer: ${reason instanceof Error ? reason.message : String(reason)}`;
				}
			}
		);
		return () => {
			destroyed = true;
		};
	});

	function visible(point: RecordedPoint | undefined): point is RecordedPoint {
		return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y) &&
			point.visibility >= 0.35 && (point.presence === undefined || point.presence >= 0.35);
	}

	$effect(() => {
		const ctx = context;
		const currentFrame = frame;
		const fixedBounds = bounds;
		const edges = connections;
		if (!ctx) return;
		ctx.clearRect(0, 0, 960, 640);
		if (!currentFrame || !fixedBounds || edges.length === 0) return;
		const { min_x, min_y, max_x, max_y } = fixedBounds;
		if (!Number.isFinite(min_x) || !Number.isFinite(min_y) ||
			!Number.isFinite(max_x) || !Number.isFinite(max_y) || max_x < min_x || max_y < min_y) return;
		const width = max_x - min_x;
		const height = max_y - min_y;
		const fit = Math.min(width > 0 ? 880 / width : Infinity, height > 0 ? 560 / height : Infinity);
		const scale = Number.isFinite(fit) ? fit : 1;
		const centerX = min_x + width / 2;
		const centerY = min_y + height / 2;
		const points = currentFrame.world_landmarks;
		ctx.strokeStyle = lineColor;
		ctx.lineWidth = 3;
		ctx.lineCap = 'round';
		ctx.beginPath();
		for (const edge of edges) {
			const start = points[edge.start];
			const end = points[edge.end];
			if (!visible(start) || !visible(end)) continue;
			ctx.moveTo(480 - (start.x - centerX) * scale, 320 + (start.y - centerY) * scale);
			ctx.lineTo(480 - (end.x - centerX) * scale, 320 + (end.y - centerY) * scale);
		}
		ctx.stroke();
		ctx.fillStyle = pointColor;
		ctx.lineWidth = 2;
		for (const point of points) {
			if (!visible(point)) continue;
			ctx.beginPath();
			ctx.arc(480 - (point.x - centerX) * scale, 320 + (point.y - centerY) * scale, 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
	});
</script>

<div role="img" aria-label={`Recorded movement skeleton, frame ${frameNumber}`}>
	<canvas
		bind:this={canvas}
		width="960"
		height="640"
		aria-hidden="true"
		class="aspect-[3/2] h-auto w-full bg-(--surface)"
	>
		Recorded movement skeleton for frame {frameNumber}. This browser cannot display the canvas.
	</canvas>
</div>
{#if error}
	<p role="alert" class="mt-3 text-(--error)">{error}</p>
{/if}
