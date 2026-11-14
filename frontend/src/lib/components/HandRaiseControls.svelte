<script lang="ts">
	import { HAND_RAISE_HOLD_MS, type HandRaiseState } from '#lib/pose/hand-raise.js';

	let { enabled, disabled, available, active, state, progressMs, action, onchange }: {
		enabled: boolean;
		disabled: boolean;
		available: boolean;
		active: boolean;
		state: HandRaiseState;
		progressMs: number;
		action: 'paused' | 'resumed' | 'blocked' | null;
		onchange: (enabled: boolean) => void;
	} = $props();

	const labels: Record<HandRaiseState, string> = {
		waiting: 'Waiting for a lowered hand',
		ready: 'Ready',
		raising: 'Hold hand up',
		'lower-hand': 'Lower hand to reset',
		unavailable: 'Hand not visible'
	};
</script>

<fieldset {disabled} class="m-0 mt-6 min-w-0 border-0 p-0">
	<legend class="font-semibold">Hands-free controls</legend>
	<label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-default">
		<input type="checkbox" checked={enabled} onchange={(event) => onchange(event.currentTarget.checked)} class="h-4 w-4 accent-[var(--chocolate-plum)]" />
		Hand raise: pause / resume
	</label>
	{#if enabled && !disabled}
		<output aria-label="Hand raise detection" aria-live="off" class="block text-sm">
			{!available ? 'Tracking unavailable' : !active ? 'Not active' : labels[state]}
		</output>
		{#if available && active && state === 'raising'}
			<progress aria-label="Hand raise hold" max={HAND_RAISE_HOLD_MS} value={progressMs} class="mt-3 h-2 w-full accent-[var(--chocolate-plum)]"></progress>
		{/if}
		{#if action}
			<p role="status" class="mb-0 mt-3 text-sm font-semibold">
				{action === 'paused' ? 'Paused by hand raise' : action === 'resumed' ? 'Resumed by hand raise' : 'Resume needs exercise framing'}
			</p>
		{/if}
	{/if}
</fieldset>
