<script lang="ts">
	import { homeFor, isUser } from '#lib/auth.js';

	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let pending = $state(false);
	let errorMessage = $state('');
	let invalidCredentials = $state(false);

	function clearError() {
		errorMessage = '';
		invalidCredentials = false;
	}

	function fillDemo(role: 'therapist' | 'patient') {
		email = `${role}@example.com`;
		password = 'demo';
		clearError();
	}

	async function login(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		pending = true;
		clearError();
		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Requested-With': 'TherapyInQuestion'
				},
				body: JSON.stringify({ email: email.trim(), password })
			});
			if (!response.ok) {
				invalidCredentials = response.status === 401;
				errorMessage = invalidCredentials
					? 'Incorrect email or password.'
					: response.status === 422
						? 'Enter a valid email address and password.'
						: 'Sign-in is temporarily unavailable. Please try again.';
				pending = false;
				return;
			}
			const user: unknown = await response.json();
			if (!isUser(user)) {
				errorMessage = 'The service returned an unexpected response. Please try again.';
				pending = false;
				return;
			}
			window.location.assign(homeFor(user));
		} catch {
			errorMessage = 'We could not sign you in. Check your connection and try again.';
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in - Therapy in Question</title>
	<meta name="description" content="Sign in to your Therapy in Question workspace." />
</svelte:head>

<main id="main-content" class="login-shell">
	<section aria-labelledby="login-heading">
		<h1 id="login-heading">Sign in</h1>
		<p class="muted intro">Access your clinic workspace.</p>

		<form onsubmit={login} oninput={clearError} aria-busy={pending}>
			<fieldset disabled={pending}>
				<legend class="sr-only">Your sign-in details</legend>
				<div class="field">
					<label for="email">Email address</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="username"
						autocapitalize="none"
						spellcheck={false}
						required
						bind:value={email}
						aria-invalid={invalidCredentials || undefined}
						aria-describedby={errorMessage ? 'login-error' : undefined}
					/>
				</div>
				<div class="field">
					<label for="password">Password</label>
					<div class="password-field">
						<input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="current-password"
							required
							bind:value={password}
							aria-invalid={invalidCredentials || undefined}
							aria-describedby={errorMessage ? 'login-error' : undefined}
						/>
						<button
							type="button"
							class="password-toggle"
							aria-controls="password"
							aria-pressed={showPassword}
							onclick={() => (showPassword = !showPassword)}
						>
							{showPassword ? 'Hide' : 'Show'}<span class="sr-only"> password</span>
						</button>
					</div>
				</div>
				{#if errorMessage}
					<p id="login-error" class="error-message" role="alert">{errorMessage}</p>
				{/if}
				<button class="submit-button" type="submit">
					{pending ? 'Signing in...' : 'Sign in'}
				</button>
			</fieldset>
		</form>
	</section>

	<aside class="demo-section" aria-labelledby="demo-heading">
		<div class="demo-actions">
			<button class="button-secondary" type="button" onclick={() => fillDemo('therapist')} disabled={pending}>
				Use therapist account
			</button>
			<button class="button-secondary" type="button" onclick={() => fillDemo('patient')} disabled={pending}>
				Use patient account
			</button>
		</div>
	</aside>
</main>

<style>
	.login-shell {
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		padding: clamp(2rem, 7vw, 4.5rem) 1.5rem 3rem;
	}

	.demo-notice {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
	}

	.intro {
		margin-bottom: 2rem;
	}

	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.field {
		margin-bottom: 1.25rem;
	}

	label {
		display: block;
		margin-bottom: 0.4rem;
		font-size: 0.95rem;
		font-weight: 600;
	}

	input {
		width: 100%;
		min-height: 48px;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--chocolate-plum);
		border-radius: 5px;
		background: var(--surface);
		color: var(--chocolate-plum);
	}

	input[aria-invalid='true'] {
		border-color: var(--error);
	}

	.password-field {
		display: flex;
		align-items: stretch;
		gap: 0.5rem;
	}

	.password-field input {
		min-width: 0;
		flex: 1;
	}

	.password-toggle {
		min-width: 68px;
		padding: 0.5rem;
		border-color: var(--border);
		background: transparent;
		color: var(--accent);
		font-size: 0.875rem;
	}

	.password-toggle:hover:not(:disabled) {
		background: var(--surface-hover);
	}

	.submit-button {
		width: 100%;
		min-height: 48px;
	}

	.demo-section {
		margin-top: 2.25rem;
		padding-top: 1.75rem;
	}

	.demo-section h2 {
		margin-bottom: 0.5rem;
		font-size: 1.1rem;
	}

	.demo-section p {
		font-size: 0.925rem;
	}

	.demo-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.demo-actions button {
		flex: 1 1 170px;
		font-size: 0.875rem;
	}
</style>
