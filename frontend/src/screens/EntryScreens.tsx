import type { FormEvent } from "react";
import { ThemeToggle } from "../components/ThemeToggle";
import { LandingPreview } from "../components/LandingPreview";
import { ChartLine, Leaf, UserRound, type LucideIcon } from "lucide-react";

type AccountMode = "signin" | "create";

interface NotFoundScreenProps {
  signedIn: boolean;
  onReturn: () => void;
}

export function NotFoundScreen({ signedIn, onReturn }: NotFoundScreenProps) {
  return (
    <main className="status-page">
      <div className="appearance-row"><ThemeToggle /></div>
      <section className="status-card">
        <p className="eyebrow">404</p>
        <h1>Page not found.</h1>
        <p>The address does not match a Haleview page.</p>
        <button className="primary-button" type="button" onClick={onReturn}>
          {signedIn ? "Return to Haleview" : "Return home"}
        </button>
      </section>
    </main>
  );
}

interface OverviewScreenProps {
  onOpenAccess: () => void;
  onContinueAsGuest: () => void;
}

export function OverviewScreen({ onOpenAccess, onContinueAsGuest }: OverviewScreenProps) {
  return (
    <main className="overview-screen">
      <header className="overview-topbar">
        <strong>Haleview</strong>
        <div className="overview-account"><ThemeToggle /><button className="text-button" type="button" onClick={onOpenAccess}>Sign in</button></div>
      </header>

      <section className="overview-hero" aria-labelledby="overview-title">
        <div className="overview-hero-copy">
          <h1 id="overview-title">Plan your meals.<br /><span>See your progress.</span></h1>
          <p>Find meals that fit your preferences, turn ingredients into a shopping list, and keep track of your nutrition.</p>
          <div className="overview-actions">
            <button className="primary-button" type="button" onClick={onOpenAccess}>Get started</button>
            <button className="secondary-button" type="button" onClick={onContinueAsGuest}>Continue as guest</button>
          </div>
        </div>
        <LandingPreview />
      </section>

      <section className="overview-points" aria-label="Haleview overview">
        <OverviewPoint className="profile-point" icon={UserRound} number="01" title="Start with your profile" text="Add your goals, food preferences and activity level. These details guide your calculations and meal choices." />
        <OverviewPoint className="progress-point" icon={Leaf} number="02" title="Plan meals and shopping" text="Explore recipes, build a meal plan and turn its ingredients into a shopping list." />
        <OverviewPoint className="hale-point" icon={ChartLine} number="03" title="See your progress" text="Record meals and activity, review changes over time and get guidance from Hale." />
      </section>

      <section className="hale-overview-card" aria-labelledby="hale-overview-title">
        <span className="hale-overview-icon" aria-hidden="true"><Leaf /></span>
        <div className="hale-overview-copy"><h2 id="hale-overview-title">Guidance in context.</h2>
          <p>Hale connects your profile with your recent progress. Core calculations and local guidance work without online AI.</p>
        </div>
      </section>

      <footer className="overview-footer">Your profile remains private unless you change its sharing setting.</footer>
    </main>
  );
}

interface OverviewPointProps {
  className: string;
  icon: LucideIcon;
  number: string;
  title: string;
  text: string;
}

function OverviewPoint({ className, icon: Icon, number, title, text }: OverviewPointProps) {
  return (
    <article className={`overview-point ${className}`}>
      <div className="overview-point-meta">
        <span className="overview-point-icon" aria-hidden="true"><Icon /></span>
        <span>{number}</span>
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

interface AccessScreenProps {
  accountMode: AccountMode;
  accountEmail: string;
  accountPassword: string;
  accountBusy: boolean;
  accountError: string | null;
  accountMessage: string | null;
  oauthProviders: { google: boolean; github: boolean };
  resetVisible: boolean;
  resetEmail: string;
  resetToken: string | null;
  resetPassword: string;
  twoFactorChallenge: string | null;
  twoFactorCode: string;
  onAccountModeChange: (mode: AccountMode) => void;
  onAccountEmailChange: (value: string) => void;
  onAccountPasswordChange: (value: string) => void;
  onOAuth: (provider: "google" | "github") => void;
  onEmailSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onShowReset: () => void;
  onResetEmailChange: (value: string) => void;
  onResetSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onHideReset: () => void;
  onResetPasswordChange: (value: string) => void;
  onNewPasswordSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTwoFactorCodeChange: (value: string) => void;
  onTwoFactorSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onContinueAsGuest: () => void;
  onBack: () => void;
}

export function AccessScreen(props: AccessScreenProps) {
  const showAccountForm = !props.twoFactorChallenge && !props.resetToken && !props.resetVisible;
  const showGuestOption = !props.resetToken && !props.resetVisible && !props.twoFactorChallenge;

  return (
    <main className="access-screen">
      <section className="access-card" aria-labelledby="access-title">
        <div className="appearance-row"><ThemeToggle /></div>
        <header className="access-heading">
          <h1 id="access-title">Sign in</h1>
          <p>Use an account on any device, or continue as guest on this browser.</p>
        </header>

        {showAccountForm && (
          <div className="account-access">
            <div className="oauth-buttons">
              <ProviderButton provider="google" enabled={props.oauthProviders.google} busy={props.accountBusy} onSelect={props.onOAuth} />
              <ProviderButton provider="github" enabled={props.oauthProviders.github} busy={props.accountBusy} onSelect={props.onOAuth} />
            </div>
            <div className="account-divider"><span>or use email</span></div>
            <div className="account-switch segmented-switch" role="group" aria-label="Email account action" data-index={props.accountMode === "signin" ? "0" : "1"} data-segments="2">
              <button type="button" className={props.accountMode === "signin" ? "active" : ""} aria-pressed={props.accountMode === "signin"} onClick={() => props.onAccountModeChange("signin")}>Sign in</button>
              <button type="button" className={props.accountMode === "create" ? "active" : ""} aria-pressed={props.accountMode === "create"} onClick={() => props.onAccountModeChange("create")}>Create account</button>
            </div>
            <form className="account-form" aria-label={props.accountMode === "signin" ? "Email sign in" : "Email account creation"} onSubmit={props.onEmailSubmit}>
              <label>Email<input type="email" value={props.accountEmail} autoComplete="email" onChange={(event) => props.onAccountEmailChange(event.target.value)} /></label>
              <label>Password<input type="password" value={props.accountPassword} autoComplete={props.accountMode === "signin" ? "current-password" : "new-password"} onChange={(event) => props.onAccountPasswordChange(event.target.value)} /></label>
              <button className="primary-button" type="submit" disabled={props.accountBusy} aria-busy={props.accountBusy}>{props.accountMode === "signin" ? "Sign in" : "Create account"}</button>
              {props.accountMode === "signin" && <button className="text-button reset-toggle" type="button" onClick={props.onShowReset}>Reset password</button>}
            </form>
          </div>
        )}

        {props.resetVisible && !props.resetToken && (
          <form className="reset-form" onSubmit={props.onResetSubmit}>
            <h2>Reset password</h2>
            <p className="account-note">Enter the account email. We will send a reset link.</p>
            <label>Account email<input type="email" value={props.resetEmail} autoComplete="email" onChange={(event) => props.onResetEmailChange(event.target.value)} /></label>
            <button className="primary-button" type="submit" disabled={props.accountBusy} aria-busy={props.accountBusy}>Send reset link</button>
            <button className="text-button" type="button" onClick={props.onHideReset}>Back to sign in</button>
          </form>
        )}

        {props.resetToken && (
          <form className="reset-form" onSubmit={props.onNewPasswordSubmit}>
            <h2>Set new password</h2>
            <label>New password<input type="password" value={props.resetPassword} autoComplete="new-password" onChange={(event) => props.onResetPasswordChange(event.target.value)} /></label>
            <button className="primary-button" type="submit" disabled={props.accountBusy} aria-busy={props.accountBusy}>Set password</button>
          </form>
        )}

        {props.twoFactorChallenge && (
          <form className="reset-form" onSubmit={props.onTwoFactorSubmit}>
            <h2>Two-step sign-in</h2>
            <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={props.twoFactorCode} onChange={(event) => props.onTwoFactorCodeChange(event.target.value)} /></label>
            <button className="primary-button" type="submit" disabled={props.accountBusy} aria-busy={props.accountBusy}>Check code</button>
          </form>
        )}

        {props.accountError && <p className="account-message error-text" role="alert">{props.accountError}</p>}
        {props.accountMessage && <p className="account-message" role="status">{props.accountMessage}</p>}

        {showGuestOption && (
          <div className="guest-option">
            <button className="secondary-button guest-button" type="button" onClick={props.onContinueAsGuest}>Continue as guest</button>
            <p>Guest data is temporary. Leaving or reloading clears this visit.</p>
            <button className="text-button overview-back" type="button" onClick={props.onBack}>Back to overview</button>
          </div>
        )}
      </section>
    </main>
  );
}

interface ProviderButtonProps {
  provider: "google" | "github";
  enabled: boolean;
  busy: boolean;
  onSelect: (provider: "google" | "github") => void;
}

function ProviderButton({ provider, enabled, busy, onSelect }: ProviderButtonProps) {
  const name = provider === "google" ? "Google" : "GitHub";
  return (
    <button className="provider-button" type="button" onClick={() => onSelect(provider)} disabled={busy || !enabled}>
      {provider === "google" ? <img src="/provider-google.png" alt="" /> : <i className="fa-brands fa-github provider-icon" aria-hidden="true" />}
      <span>Continue with {name}</span>
    </button>
  );
}
