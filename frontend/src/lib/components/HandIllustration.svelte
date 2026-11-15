<script lang="ts">
	import type { TutorialStep } from '#lib/pose/exercise-tutorial.js';

	let { pose, targetAngle }: { pose: TutorialStep['pose']; targetAngle: number } = $props();
	const bend = $derived((pose === 'target' ? targetAngle : pose === 'return' ? targetAngle * 0.35 : 0) * Math.PI / 180);
	const middleX = $derived(112 + 34 * Math.sin(bend));
	const middleY = $derived(82 - 34 * Math.cos(bend));
	const tipX = $derived(middleX + 25 * Math.sin(bend * 1.25));
	const tipY = $derived(middleY - 25 * Math.cos(bend * 1.25));
	const label = $derived(pose === 'start' ? 'Open hand with the index finger gently straight and wrist supported.' : pose === 'target' ? 'Index finger bending at its middle joint while the wrist and palm stay still.' : 'Index finger gently straightening back toward its open starting position.');
</script>

<svg viewBox="0 0 280 240" role="img" aria-label={label} class="block w-full max-w-xs" fill="none" stroke-linecap="round" stroke-linejoin="round">
	<title>{label}</title>
	<path d="M 58 220 H 224 M 97 220 V 191 M 175 220 V 190" stroke="var(--border)" stroke-width="3" />
	<path d="M 97 191 Q 78 173 74 151 L 55 126 Q 49 115 57 110 Q 65 105 72 115 L 94 138 L 94 114 Q 94 105 104 104 H 173 Q 187 104 187 120 V 153 Q 187 178 175 191" stroke="var(--chocolate-plum)" stroke-width="6" />
	<path d="M 140 113 V 39 Q 140 29 148 29 Q 156 29 156 39 V 115 M 165 116 V 54 Q 165 44 173 44 Q 181 44 181 54 V 119 M 188 125 V 83 Q 188 73 195 73 Q 203 73 203 83 V 140 Q 203 163 187 171" stroke="var(--border)" stroke-width="5" />
	<path d={`M 112 130 V 82 L ${middleX} ${middleY} L ${tipX} ${tipY}`} stroke="var(--terracotta-clay)" stroke-width="9" />
	<circle cx="112" cy="82" r="6" fill="var(--terracotta-clay)" />
	<circle cx={middleX} cy={middleY} r="4" fill="var(--terracotta-clay)" />
	<path d="M 107 159 Q 136 147 166 160" stroke="var(--chocolate-plum)" stroke-width="3" />
</svg>
