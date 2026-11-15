<script lang="ts">
	import { isInboxMessage, type InboxMessage } from '#lib/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let messages = $state<InboxMessage[]>([]);
	let selectedId = $state<string | null>(null);
	let unreadOnly = $state(false);
	let readingId = $state<string | null>(null);
	let refreshing = $state(false);
	let errorMessage = $state('');
	let sessionExpired = $state(false);
	const unreadCount = $derived(messages.filter((message) => message.read_at === null).length);
	const visibleMessages = $derived(
		unreadOnly ? messages.filter((message) => message.read_at === null) : messages
	);
	const selectedMessage = $derived(messages.find((message) => message.id === selectedId));
	const busy = $derived(refreshing || readingId !== null);

	$effect(() => {
		messages = data.messages;
	});

	function timestamp(value: string) {
		return `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
	}

	function responseError(response: Response) {
		sessionExpired = response.status === 401;
		return sessionExpired ? 'Your session expired. Sign in again.' : 'We could not update your inbox. Please try again.';
	}

	async function openMessage(id: string) {
		if (busy) return;
		selectedId = id;
		errorMessage = '';
		sessionExpired = false;
		const message = messages.find((item) => item.id === id);
		if (!message || message.read_at !== null) return;
		readingId = id;
		try {
			const response = await fetch(`/api/patient/messages/${id}/read`, {
				method: 'POST',
				headers: { 'X-Requested-With': 'TherapyInQuestion' }
			});
			if (!response.ok) {
				errorMessage = responseError(response);
				return;
			}
			const updated: unknown = await response.json();
			if (!isInboxMessage(updated)) {
				errorMessage = 'The service returned an unexpected response. Please try again.';
				return;
			}
			messages = messages.map((item) => item.id === updated.id ? updated : item);
		} catch {
			errorMessage = 'We could not reach the service. Please try again.';
		} finally {
			readingId = null;
		}
	}

	async function refreshMessages() {
		if (busy) return;
		refreshing = true;
		errorMessage = '';
		sessionExpired = false;
		try {
			const response = await fetch('/api/patient/messages', { cache: 'no-store' });
			if (!response.ok) {
				errorMessage = responseError(response);
				return;
			}
			const updated: unknown = await response.json();
			if (!Array.isArray(updated) || !updated.every(isInboxMessage)) {
				errorMessage = 'The service returned an unexpected response. Please try again.';
				return;
			}
			messages = updated;
			if (!messages.some((message) => message.id === selectedId)) selectedId = null;
		} catch {
			errorMessage = 'We could not reach the service. Please try again.';
		} finally {
			refreshing = false;
		}
	}
</script>

<svelte:head>
	<title>Inbox - Therapy in Question</title>
</svelte:head>

<main id="main-content" class="mx-auto max-w-[1200px] px-10 py-10">
	<div class="mb-7 flex items-center justify-between gap-6">
		<h1>Inbox</h1>
		<button class="button-secondary" onclick={refreshMessages} disabled={busy}>
			{refreshing ? 'Refreshing...' : 'Refresh'}
		</button>
	</div>
	{#if errorMessage}
		<div class="mb-6 rounded bg-(--camera-error) p-4 text-(--error)" role="alert">
			<p class="mb-0">{errorMessage}</p>
			{#if sessionExpired}<a href="/login" target="_blank" rel="noreferrer">Sign in</a>{/if}
		</div>
	{/if}
	<div class="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-8">
		<section aria-label="Messages">
			<div class="mb-5 flex gap-3" role="group" aria-label="Filter messages">
				<button class="button-secondary" aria-pressed={!unreadOnly} onclick={() => unreadOnly = false}>
					All ({messages.length})
				</button>
				<button class="button-secondary" aria-pressed={unreadOnly} onclick={() => unreadOnly = true}>
					Unread ({unreadCount})
				</button>
			</div>
			{#if visibleMessages.length === 0}
				<p>{unreadOnly ? 'No unread messages.' : 'No messages.'}</p>
			{:else}
				<ul class="m-0 list-none space-y-3 p-0">
					{#each visibleMessages as message (message.id)}
						<li>
							<button
								class={`button-secondary w-full text-left ${selectedId === message.id ? 'bg-(--surface-hover)!' : ''}`}
								aria-pressed={selectedId === message.id}
								disabled={busy}
								onclick={() => openMessage(message.id)}
							>
								<span class="block w-full space-y-1">
									<span class="block break-words font-semibold">{message.subject}</span>
									<span class="block text-sm">{message.therapist_name}</span>
									<span class="block text-xs">{timestamp(message.approved_at)}</span>
									<span class="block text-sm">{message.read_at === null ? 'Unread' : 'Read'}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section aria-label="Selected message" aria-live="polite" class="min-w-0 rounded-md bg-(--surface) p-7">
			{#if selectedMessage}
				<h2 class="break-words">{selectedMessage.subject}</h2>
				<p class="mb-1">{selectedMessage.therapist_name}</p>
				<p class="mb-7 text-sm">Sent {timestamp(selectedMessage.approved_at)}</p>
				<p class="mb-7 whitespace-pre-wrap wrap-anywhere leading-relaxed">{selectedMessage.body}</p>
				{#if selectedMessage.read_at !== null}
					<p class="mb-0 text-sm">Read {timestamp(selectedMessage.read_at)}</p>
				{:else}
					<button class="button-secondary" onclick={() => openMessage(selectedMessage.id)} disabled={busy}>
						{readingId === selectedMessage.id ? 'Marking as read...' : 'Mark as read'}
					</button>
				{/if}
			{:else}
				<p class="mb-0">No message selected.</p>
			{/if}
		</section>
	</div>
</main>
