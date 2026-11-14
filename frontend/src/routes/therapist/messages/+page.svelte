<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { isTherapistMessage, type TherapistMessage } from '#lib/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let messages = $state<TherapistMessage[]>(untrack(() => data.messages));
	let filter = $state<'drafts' | 'sent'>('drafts');
	let selectedId = $state<string | null>(null);
	let editing = $state(true);
	let patientId = $state('');
	let subject = $state('');
	let body = $state('');
	let review = $state<TherapistMessage | null>(null);
	let pending = $state<'save' | 'send' | 'reload' | null>(null);
	let errorMessage = $state('');
	let notice = $state('');
	let conflict = $state(false);
	let sessionExpired = $state(false);

	const selected = $derived(messages.find((message) => message.id === selectedId));
	const draftCount = $derived(messages.filter((message) => message.approved_at === null).length);
	const sentCount = $derived(messages.length - draftCount);
	const visibleMessages = $derived(
		messages.filter((message) => (message.approved_at === null) === (filter === 'drafts'))
	);
	const dirty = $derived(
		editing &&
			(patientId !== (selected?.patient_id ?? '') ||
				subject !== (selected?.subject ?? '') ||
				body !== (selected?.body ?? ''))
	);

	beforeNavigate((navigation) => {
		if (pending || (dirty && !window.confirm('Discard unsaved changes?'))) {
			navigation.cancel();
		}
	});

	function protectUnload(event: BeforeUnloadEvent) {
		if (dirty || pending) {
			event.preventDefault();
			event.returnValue = '';
		}
	}

	function dateLabel(value: string): string {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'UTC'
		}).format(new Date(value)) + ' UTC';
	}

	function discardAllowed(): boolean {
		return !pending && (!dirty || window.confirm('Discard unsaved changes?'));
	}

	function clearFeedback() {
		errorMessage = '';
		notice = '';
		sessionExpired = false;
	}

	function openMessage(message: TherapistMessage) {
		if (!discardAllowed()) return;
		selectedId = message.id;
		patientId = message.patient_id;
		subject = message.subject;
		body = message.body;
		editing = false;
		review = null;
		conflict = false;
		clearFeedback();
	}

	function newDraft() {
		if (!discardAllowed()) return;
		selectedId = null;
		patientId = '';
		subject = '';
		body = '';
		editing = true;
		review = null;
		filter = 'drafts';
		conflict = false;
		clearFeedback();
	}

	function cancelEditing() {
		if (selected) openMessage(selected);
		else newDraft();
	}

	function storeMessage(message: TherapistMessage) {
		messages = [message, ...messages.filter((item) => item.id !== message.id)].sort(
			(left, right) =>
				right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
		);
		selectedId = message.id;
		patientId = message.patient_id;
		subject = message.subject;
		body = message.body;
		editing = false;
		filter = message.approved_at === null ? 'drafts' : 'sent';
		review = null;
		conflict = false;
	}

	async function requestMessage(path: string, method: 'GET' | 'POST' | 'PUT', payload?: object) {
		const response = await fetch(path, {
			method,
			headers: method === 'GET' ? {} : {
				'Content-Type': 'application/json',
				'X-Requested-With': 'TherapyInQuestion'
			},
			body: payload === undefined ? undefined : JSON.stringify(payload),
			cache: 'no-store'
		});
		if (!response.ok) {
			sessionExpired = response.status === 401;
			if (response.status === 409) {
				conflict = true;
				review = null;
			}
			throw new Error(
				response.status === 401
					? 'Your session expired. Sign in again to continue.'
					: response.status === 403
						? 'You do not have access to clinic messages.'
						: response.status === 404
							? 'This message or patient is no longer available.'
							: response.status === 409
								? 'This message changed or was already sent. Reload the saved message to review it.'
								: response.status === 422
									? 'Choose a patient and enter a subject of 1-160 characters and a message of 1-5000 characters.'
									: 'The message request failed. Please try again.'
			);
		}
		const result: unknown = await response.json();
		if (!isTherapistMessage(result)) {
			throw new Error('The service returned an unexpected response. Please try again.');
		}
		return result;
	}

	async function saveDraft(event: SubmitEvent) {
		event.preventDefault();
		if (pending || conflict || selected?.approved_at) return;
		clearFeedback();
		const snapshot = { patient_id: patientId, subject: subject.trim(), body: body.trim() };
		if (!snapshot.patient_id || !snapshot.subject || !snapshot.body) {
			errorMessage = 'Choose a patient and enter a subject and message.';
			return;
		}
		pending = 'save';
		try {
			const message = await requestMessage(
				selectedId ? `/api/therapist/messages/${selectedId}` : '/api/therapist/messages',
				selectedId ? 'PUT' : 'POST',
				snapshot
			);
			storeMessage(message);
			notice = 'Draft saved.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Could not save the draft. Please try again.';
		} finally {
			pending = null;
		}
	}

	function beginReview() {
		if (!selected || selected.approved_at || editing || dirty || pending || conflict) return;
		clearFeedback();
		review = { ...selected };
	}

	async function confirmSend() {
		if (!review || pending || conflict || dirty) return;
		const snapshot = review;
		pending = 'send';
		clearFeedback();
		try {
			const message = await requestMessage(`/api/therapist/messages/${snapshot.id}/approve`, 'POST', {
				patient_id: snapshot.patient_id,
				subject: snapshot.subject,
				body: snapshot.body
			});
			storeMessage(message);
			notice = 'Message sent.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Could not send the message. Please try again.';
		} finally {
			pending = null;
		}
	}

	async function reloadMessage() {
		if (!selectedId || !discardAllowed()) return;
		pending = 'reload';
		clearFeedback();
		try {
			const message = await requestMessage(`/api/therapist/messages/${selectedId}`, 'GET');
			storeMessage(message);
			notice = 'Saved message reloaded.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Could not reload the message. Please try again.';
		} finally {
			pending = null;
		}
	}
</script>

<svelte:head>
	<title>Patient messages - Therapy in Question</title>
</svelte:head>

<svelte:window onbeforeunload={protectUnload} />

<main id="main-content" class="mx-auto max-w-7xl px-12 py-12">
	<div class="mb-10 flex items-center justify-between gap-6">
		<h1 class="mb-0!">Patient messages</h1>
		<button type="button" class="button-secondary" disabled={pending !== null} onclick={newDraft}>New draft</button>
	</div>

	<div class="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-12">
		<aside aria-label="Messages">
			<div class="mb-5 flex gap-2" aria-label="Message filters">
				<button
					type="button"
					class:button-secondary={filter !== 'drafts'}
					aria-pressed={filter === 'drafts'}
					disabled={pending !== null}
					onclick={() => { filter = 'drafts'; }}
				>Drafts ({draftCount})</button>
				<button
					type="button"
					class:button-secondary={filter !== 'sent'}
					aria-pressed={filter === 'sent'}
					disabled={pending !== null}
					onclick={() => { filter = 'sent'; }}
				>Sent ({sentCount})</button>
			</div>
			{#if visibleMessages.length === 0}
				<p class="py-4">{filter === 'drafts' ? 'No drafts.' : 'No sent messages.'}</p>
			{:else}
				<ul class="m-0 flex list-none flex-col gap-3 p-0">
					{#each visibleMessages as message (message.id)}
						<li>
							<button
								type="button"
								class={`button-secondary w-full flex-col items-start! gap-1 px-4! py-4! text-left ${selectedId === message.id ? 'bg-[var(--surface-hover)]!' : ''}`}
								aria-current={selectedId === message.id ? 'true' : undefined}
								disabled={pending !== null}
								onclick={() => openMessage(message)}
							>
								<span class="w-full wrap-anywhere font-semibold">{message.subject}</span>
								<span class="w-full wrap-anywhere text-sm font-normal">{message.patient_name}</span>
								<span class="text-sm font-normal">{dateLabel(message.approved_at ?? message.created_at)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>

		<section aria-label="Message workspace" class="min-w-0" aria-busy={pending !== null}>
			<div class="mb-6 flex items-center justify-between gap-4">
				<h2 class="mb-0!">{selected ? (selected.approved_at ? 'Sent message' : editing ? 'Edit draft' : 'Saved draft') : 'New draft'}</h2>
				{#if selected}
					<button type="button" class="button-secondary" disabled={pending !== null} onclick={reloadMessage}>
						{pending === 'reload' ? 'Reloading...' : 'Reload saved message'}
					</button>
				{/if}
			</div>

			{#if errorMessage}
				<div role="alert" class="mb-6 text-[var(--error)]">
					<p class="mb-2">{errorMessage}</p>
					{#if sessionExpired}<a href="/login">Sign in</a>{/if}
				</div>
			{/if}
			{#if notice}<p role="status" class="mb-6">{notice}</p>{/if}

			{#if editing}
				<form onsubmit={saveDraft} class="flex flex-col gap-6">
					<fieldset disabled={pending !== null} class="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
						<div class="flex flex-col gap-2">
							<label for="message-patient" class="font-semibold">Patient</label>
							<select id="message-patient" required bind:value={patientId} class="min-h-12 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base">
								<option value="" disabled>Select a patient</option>
								{#each data.patients as patient (patient.id)}
									<option value={patient.id}>{patient.full_name} ({patient.email})</option>
								{/each}
							</select>
						</div>
						<div class="flex flex-col gap-2">
							<label for="message-subject" class="font-semibold">Subject</label>
							<input id="message-subject" required maxlength="160" bind:value={subject} class="min-h-12 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
						</div>
						<div class="flex flex-col gap-2">
							<label for="message-body" class="font-semibold">Message</label>
							<textarea id="message-body" required maxlength="5000" rows="11" bind:value={body} class="w-full resize-y rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-[inherit] text-base leading-relaxed"></textarea>
						</div>
					</fieldset>
					{#if data.patients.length === 0}<p class="mb-0">No clinic patients.</p>{/if}
					<div class="flex items-center gap-3">
						<button type="submit" disabled={pending !== null || conflict || !dirty || data.patients.length === 0}>
							{pending === 'save' ? 'Saving...' : 'Save draft'}
						</button>
						<button type="button" class="button-secondary" disabled={pending !== null} onclick={cancelEditing}>Cancel</button>
						{#if dirty}<span>Unsaved changes</span>{/if}
					</div>
				</form>
			{:else if selected}
				{#if review}
					<h3 class="mb-5 text-xl font-semibold">Confirm recipient and message</h3>
				{/if}
				<article class="rounded bg-[var(--surface)] p-7">
					<dl class="mb-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm">
						<dt class="font-semibold">To</dt>
						<dd class="m-0 wrap-anywhere">{review?.patient_name ?? selected.patient_name}</dd>
						<dt class="font-semibold">Drafted by</dt>
						<dd class="m-0 wrap-anywhere">{selected.drafted_by_name}</dd>
						<dt class="font-semibold">Created</dt>
						<dd class="m-0">{dateLabel(selected.created_at)}</dd>
						{#if selected.approved_at}
							<dt class="font-semibold">Sent by</dt>
							<dd class="m-0 wrap-anywhere">{selected.approved_by_name}</dd>
							<dt class="font-semibold">Sent</dt>
							<dd class="m-0">{dateLabel(selected.approved_at)}</dd>
							<dt class="font-semibold">Read status</dt>
							<dd class="m-0">{selected.read_at ? `Read ${dateLabel(selected.read_at)}` : 'Unread'}</dd>
						{/if}
					</dl>
					<h3 class="mb-4 wrap-anywhere text-2xl font-semibold">{review?.subject ?? selected.subject}</h3>
					<p class="mb-0 whitespace-pre-wrap wrap-anywhere leading-7">{review?.body ?? selected.body}</p>
				</article>
				{#if !selected.approved_at}
					<div class="mt-6 flex gap-3">
						{#if review}
							<button type="button" disabled={pending !== null || conflict} onclick={confirmSend}>{pending === 'send' ? 'Sending...' : 'Confirm send'}</button>
							<button type="button" class="button-secondary" disabled={pending !== null} onclick={() => { review = null; }}>Cancel</button>
						{:else}
							<button type="button" disabled={pending !== null || conflict} onclick={beginReview}>Approve and send</button>
							<button type="button" class="button-secondary" disabled={pending !== null || conflict} onclick={() => { editing = true; clearFeedback(); }}>Edit draft</button>
						{/if}
					</div>
				{/if}
			{/if}
		</section>
	</div>
</main>
