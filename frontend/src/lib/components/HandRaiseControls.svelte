<script lang="ts">
	import { HAND_RAISE_HOLD_MS, type HandRaiseState } from '#lib/pose/hand-raise.js';

	let { enabled, disabled, available, active, state, progressMs, action, onchange }: {
		enabled: boolean;
		disabled: boolean;
		available: boolean;
		active: boolean;
		state: HandRaiseState;
		progressMs: number;
		action: 'paused' | 'countdown' | 'canceled' | null;
		onchange: (enabled: boolean) => void;
	} = $props();

	const labels: Record<HandRaiseState, string> = {
		waiting: 'Lower one hand to get ready',
		ready: 'Ready for a shoulder-height hand raise',
		raising: 'Keep your hand raised for 1 second',
		'lower-hand': 'Lower your hand before the next command',
		unavailable: 'Keep one shoulder, elbow and hand in view'
	};
</script>

<fieldset {disabled} class="m-0 mt-6 min-w-0 border-0 p-0">
	<legend class="font-semibold">Hands-free controls</legend>
	<label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-default">
		<input type="checkbox" checked={enabled} onchange={(event) => onchange(event.currentTarget.checked)} class="h-4 w-4 accent-[var(--chocolate-plum)]" />
		Hand raise controls
	</label>
	{#if enabled && !disabled}
		<p class="mb-3 text-sm">Raise either hand above your shoulder for 1 second to pause or start a countdown. Lower it before the next command.</p>
		<output aria-label="Hand raise detection" aria-live="off" class="block text-sm">
			{!available ? 'Tracking unavailable' : !active ? 'Not active' : labels[state]}
		</output>
		{#if available && active && state === 'raising'}
			<progress aria-label="Hand raise hold" max={HAND_RAISE_HOLD_MS} value={progressMs} class="mt-3 h-2 w-full accent-[var(--chocolate-plum)]"></progress>
		{/if}
		{#if action}
			<p role="status" class="mb-0 mt-3 text-sm font-semibold">
				{action === 'paused' ? 'Paused by hand raise' : action === 'countdown' ? 'Countdown requested. Return to your starting position.' : 'Countdown canceled by hand raise'}
			</p>
		{/if}
	{/if}
</fieldset>
