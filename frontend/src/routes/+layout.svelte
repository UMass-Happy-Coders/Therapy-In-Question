<script lang="ts">
	import '../app.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let logoutPending = $state(false);
	let logoutError = $state('');

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
		<a class="wordmark" href="/" data-sveltekit-reload>Therapy in Question</a>
		{#if data.user}
			<div class="account">
				<div class="identity">
					<span class="account-name">{data.user.full_name}</span>
					<span class="muted">{data.user.clinic_name}</span>
				</div>
				<button class="button-secondary" onclick={logout} disabled={logoutPending}>
					{logoutPending ? 'Signing out...' : 'Sign out'}
				</button>
			</div>
		{/if}
	</div>
	{#if logoutError}
		<p class="header-error error-message" role="alert">{logoutError}</p>
	{/if}
</header>

{@render children()}
