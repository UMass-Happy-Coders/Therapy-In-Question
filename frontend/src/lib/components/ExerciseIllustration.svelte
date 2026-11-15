<script lang="ts">
	import type { ExerciseType } from '#lib/programs.js';
	import type { TutorialStep } from '#lib/pose/exercise-tutorial.js';

	let { exerciseType, pose, targetAngle }: {
		exerciseType: Exclude<ExerciseType, 'seated_index_finger_bends'>;
		pose: TutorialStep['pose'];
		targetAngle: number;
	} = $props();

	const progress = $derived(pose === 'start' ? 0 : pose === 'target' ? 1 : 0.35);
	const figure = $derived.by(() => {
		switch (exerciseType) {
			case 'seated_knee_extension': {
				const angle = (180 - (90 + (targetAngle - 90) * progress)) * Math.PI / 180;
				const ankleX = 157 + 70 * Math.cos(angle);
				const ankleY = 143 + 70 * Math.sin(angle);
				return {
					headX: 95, headY: 55, shoulderX: 95, shoulderY: 80,
					hipX: 98, hipY: 143, kneeX: 157, kneeY: 143,
					ankleX, ankleY, toeX: ankleX + 24 * Math.sin(angle), toeY: ankleY - 24 * Math.cos(angle),
					label: pose === 'start' ? 'Side-view illustration: seated upright with knee bent and foot on the floor.'
						: pose === 'target' ? 'Side-view illustration: thigh stays on the chair while the lower leg lifts and the knee straightens.'
							: 'Side-view illustration: lower leg moving down as the knee bends back toward the starting position.'
				};
			}
			case 'straight_leg_raise': {
				const angle = targetAngle * progress * Math.PI / 180;
				const kneeX = 120 + 54 * Math.cos(angle);
				const kneeY = 185 - 54 * Math.sin(angle);
				const ankleX = 120 + 108 * Math.cos(angle);
				const ankleY = 185 - 108 * Math.sin(angle);
				return {
					headX: 33, headY: 170, shoulderX: 58, shoulderY: 185,
					hipX: 120, hipY: 185, kneeX, kneeY, ankleX, ankleY,
					toeX: ankleX - 23 * Math.sin(angle), toeY: ankleY - 23 * Math.cos(angle),
					label: pose === 'start' ? 'Side-view illustration: lying on the back with the straight leg resting on a supporting surface.'
						: pose === 'target' ? 'Side-view illustration: leg raised at the hip with the knee kept straight.'
							: 'Side-view illustration: straight leg lowering toward the supporting surface without bending the knee.'
				};
			}
			case 'sit_to_stand': {
				const angle = (180 - (90 + (targetAngle - 90) * progress)) * Math.PI / 360;
				const kneeX = 190 - 55 * Math.sin(angle);
				const kneeY = 215 - 55 * Math.cos(angle);
				const hipX = kneeX - 55 * Math.sin(angle);
				const hipY = kneeY - 55 * Math.cos(angle);
				const shoulderX = hipX - 12 * (1 - progress);
				return {
					headX: shoulderX, headY: hipY - 86, shoulderX, shoulderY: hipY - 61,
					hipX, hipY, kneeX, kneeY, ankleX: 190, ankleY: 215, toeX: 217, toeY: 215,
					label: pose === 'start' ? 'Side-view illustration: sitting on a chair with hips and knees bent and feet on the floor.'
						: pose === 'target' ? 'Side-view illustration: hips lift off the chair and hips and knees straighten toward standing.'
							: 'Side-view illustration: hips and knees bending while lowering back toward the chair.'
				};
			}
			case 'seated_ankle_pumps': {
				const angle = targetAngle * progress * Math.PI / 180;
				return {
					headX: 73, headY: 46, shoulderX: 73, shoulderY: 71,
					hipX: 76, hipY: 137, kneeX: 144, kneeY: 137,
					ankleX: 220, ankleY: 137,
					toeX: 220 + 32 * Math.sin(angle), toeY: 137 - 32 * Math.cos(angle),
					label: pose === 'start' ? 'Side-view illustration: seated with leg supported, heel beyond the support and toes pointing up.'
						: pose === 'target' ? 'Side-view illustration: leg remains still on the support while the foot rotates at the ankle to point toes away.'
							: 'Side-view illustration: foot rotates back toward toes-up while the leg stays supported and still.'
				};
			}
		}
	});
</script>

<svg viewBox="0 0 280 240" role="img" aria-label={figure.label} class="block w-full max-w-xs" fill="none" stroke-linecap="round" stroke-linejoin="round">
	<title>{figure.label}</title>
	<g stroke="var(--border)" stroke-width="3">
		{#if exerciseType === 'straight_leg_raise'}
			<path d="M 14 200 H 258 M 28 200 V 225 M 246 200 V 225" />
		{:else}
			<path d="M 32 223 H 258" />
			{#if exerciseType === 'sit_to_stand'}
				<path d="M 85 92 V 147 H 143 M 93 147 V 221 M 135 147 V 221" />
			{:else if exerciseType === 'seated_ankle_pumps'}
				<path d="M 50 85 V 150 H 110 M 58 150 V 221 M 102 150 V 221 M 128 149 H 205 V 221 M 137 149 V 221" />
			{:else}
				<path d="M 73 94 V 153 H 150 M 82 153 V 221 M 143 153 V 221" />
			{/if}
		{/if}
	</g>
	<g stroke="var(--chocolate-plum)" stroke-width="8">
		<circle cx={figure.headX} cy={figure.headY} r="14" fill="var(--surface)" stroke-width="4" />
		<path d={`M ${figure.headX} ${figure.headY + 15} L ${figure.shoulderX} ${figure.shoulderY} L ${figure.hipX} ${figure.hipY}`} />
		{#if exerciseType === 'straight_leg_raise'}
			<path d="M 62 183 L 96 190 M 120 189 L 174 190 L 230 190" stroke-width="5" />
		{:else if exerciseType === 'sit_to_stand'}
			<path d={`M ${figure.shoulderX} ${figure.shoulderY + 8} L ${figure.shoulderX + 29} ${figure.shoulderY + 38} L ${figure.shoulderX + 51} ${figure.shoulderY + 36}`} stroke-width="5" />
		{:else}
			<path d={`M ${figure.shoulderX} ${figure.shoulderY + 8} L ${figure.shoulderX + 13} ${figure.hipY - 20} L ${figure.hipX + 34} ${figure.hipY - 9}`} stroke-width="5" />
		{/if}
		<path d={`M ${figure.hipX} ${figure.hipY} L ${figure.kneeX} ${figure.kneeY} L ${figure.ankleX} ${figure.ankleY}`} stroke={exerciseType === 'seated_ankle_pumps' ? 'var(--chocolate-plum)' : 'var(--terracotta-clay)'} />
		<path d={`M ${figure.ankleX} ${figure.ankleY} L ${figure.toeX} ${figure.toeY}`} stroke="var(--terracotta-clay)" />
	</g>
</svg>
