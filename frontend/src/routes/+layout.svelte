<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let logoutPending = $state(false);
	let logoutError = $state('');
	const workspacePath = $derived(data.user?.role === 'therapist' ? '/therapist' : '/patient');
	const messagesPath = $derived(
		data.user?.role === 'therapist' ? '/therapist/messages' : '/patient/inbox'
	);

	async function logout() {
		if (logoutPending) return;
		logoutPending = true;
		logoutError = '';
		try {
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'X-Requested-With': 'TherapyInQuestion' }
			});
			if (response.status !== 204) {
				logoutError = 'We could not sign you out. Please try again.';
				logoutPending = false;
				return;
			}
			window.location.assign('/login');
		} catch {
			logoutError = 'We could not reach the service. Check your connection and try again.';
			logoutPending = false;
		}
	}
</script>


<a class="skip-link" href="#main-content">Skip to main content</a>
<header class="site-header">
	<div class="header-inner">
		<a class="wordmark" href="/" data-sveltekit-reload>
			<img src="/logo.svg" alt="Therapy in Question" width="224" height="48" class="block h-12 w-56" />
		</a>
		{#if data.user}
			<div class="account">
				<nav aria-label="Workspace" class="flex items-center gap-5 text-sm">
					<a href={workspacePath} aria-current={page.url.pathname === workspacePath ? 'page' : undefined}>Workspace</a>
					<a href={messagesPath} aria-current={page.url.pathname === messagesPath ? 'page' : undefined}>
						{data.user.role === 'therapist' ? 'Messages' : 'Inbox'}
					</a>
				</nav>
				<div class="identity">
					<span class="account-name">{data.user.full_name}</span>
					<span class="muted">{data.user.clinic_name}</span>
				</div>
				<button class="button-secondary" onclick={logout} disabled={logoutPending}>
					{logoutPending ? 'Signing out...' : 'Sign out'}
				</button>
			</div>
		{:else if page.url.pathname === '/'}
			<nav aria-label="About Therapy in Question" class="flex items-center gap-6 text-sm font-semibold">
				<a href="/#how-it-works">How it works</a>
				<a href="/#privacy">Privacy</a>
				<a href="/login" class="button">Sign in</a>
			</nav>
		{/if}
	</div>
	{#if logoutError}
		<p class="header-error error-message" role="alert">{logoutError}</p>
	{/if}
</header>

{@render children()}
