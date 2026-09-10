# Haleview

Haleview records a health profile and shows simple progress data. It calculates BMI, a wellness score, goal progress, and local guidance. The Hale assistant can also use DeepSeek when the user allows online AI.

Haleview is not a medical service. Check health guidance before acting on it.

## Start with Docker

Docker is the only required setup dependency.

```text
docker compose up --build
```

Open `http://127.0.0.1:27450`.

The backend health check is at `http://127.0.0.1:27451/health`.

To stop the app:

```text
docker compose down
```

## Configuration

Copy `.env.example` to `.env`. Keep `.env` and all secret files outside Git.

### DeepSeek

Online AI is optional. The app works without it.

Set `DEEPSEEK_API_KEY` in the ignored `.env` file. Docker mounts that file as a runtime secret. The key is read by the backend. It is not placed in frontend code, exports, logs, or Docker image metadata.

These values can also be changed in `.env`:

- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_TIMEOUT_MS`

For a backend process outside Docker, use `DEEPSEEK_API_KEY_FILE` to point to a secret file.

### Email

For local Docker use without an email provider, the registration and password reset pages show a one-time link. This works only when `PUBLIC_APP_URL` is a loopback address. A public deployment never shows account links in an API response.

To send email with Resend, place the key in `backend/data/resend.key`. Set `AUTH_EMAIL_FROM` only when the sender is allowed by Resend. The Resend test sender can send to the Resend account address without a domain.

If a configured email provider rejects a verification message, account creation stops with a clear error and can be tried again.

### Google and GitHub

Set the public client IDs in `.env`:

- `GOOGLE_CLIENT_ID`
- `GITHUB_CLIENT_ID`

Place the private client secrets in these ignored files:

- `backend/data/google-client-secret`
- `backend/data/github-client-secret`

Set the redirect addresses in `.env` when the public app address changes. The local defaults are listed in `.env.example`.

### Storage keys

SQLite health records and account email addresses are protected with AES-256-GCM. Email searches use a keyed lookup hash, so the database does not need a readable email address. A development encryption key is created in the ignored backend data folder when no key is supplied. Keep the encryption key and database together in backups.

The JWT signing key is also stored in the ignored backend data folder. Keeping it preserves active sessions after a normal restart.

## Access modes

The first page explains the app and offers account access.

- Account mode stores data in the local SQLite database. It supports email and password, email verification, password reset, Google, GitHub, and optional two-step sign-in.
- Guest mode stores the profile and history in this browser. Clearing browser storage removes guest data.
- A guest profile can be carried into profile setup after sign-in.

Two-step sign-in shows a QR code for an authenticator app. The browser generates the QR code locally. The setup URI is not sent to a QR service. A manual setup key is shown as a fallback. An account can disable two-step sign-in in Settings by entering the current authenticator code.

Access tokens last 15 minutes. An active page refreshes the session before expiry. The page signs out after 15 minutes without keyboard or pointer activity. Refresh tokens last 30 days and rotate when used.

## Tutorial

The tutorial opens once for a new account or a new guest with no saved profile. It explains access, profile setup, the dashboard, progress records, and Hale.

The tutorial is optional:

- Select `Skip tutorial` to go to profile setup.
- Select `Tutorial` in profile setup to open it again.
- Select `Settings`, then `Tutorial`, to replay it later.

The browser stores only a tutorial-seen flag for this feature. It does not store health data in that flag.

## Main use

1. Choose account access or guest mode.
2. Follow the tutorial or skip it.
3. Complete the four profile steps.
4. Confirm data use.
5. Leave online AI off, or allow it for Hale.
6. Save the profile.
7. Read the dashboard.
8. Add activity records in `Records`.
9. Review changes in `Progress`.
10. Open `Hale` for guidance.

The number controls support both methods:

- Drag the slider.
- Select the number and type a value.

Invalid values show a message before the profile is saved.

## Pages

| Address | Purpose |
| --- | --- |
| `/` | App overview |
| `/access` | Account and guest access |
| `/tutorial` | Optional tutorial |
| `/profile/setup` | Profile setup and editing |
| `/profile` | Saved profile |
| `/dashboard` | Main health overview |
| `/dashboard/progress` | Trends, goals, and comparisons |
| `/dashboard/records` | Weight and activity history |
| `/dashboard/hale` | Hale guidance |
| `/settings` | Data, tutorial, AI, and account settings |

Unknown frontend addresses show a 404 page. Missing static files return HTTP 404.

## Profile data

The profile can include:

- Age and gender.
- Height, current weight, and target weight.
- Occupation type and activity level.
- Fitness goal and planned active days.
- Dietary preferences and restrictions.
- Exercise types, session duration, fitness level, place, and time.
- Endurance, pushups, and squats.
- Data-use consent, online AI choice, visibility, and email choice.

Kilograms and centimetres are used before storage, calculations, charts, and AI processing. Standard units keep comparisons and chart scales consistent.

## Calculations

Haleview calculates:

- BMI and the underweight, normal weight, overweight, or obese class.
- A wellness score from 0 to 100.
- Weight, activity, goal, and habit progress.
- Current and target comparisons.
- Weekly and monthly summaries.
- Milestones and activity streaks.

The wellness score uses four normalized parts:

```text
score = (bmi_score * 0.3)
      + (activity_score * 0.3)
      + (goal_progress * 0.2)
      + (habits_score * 0.2)
```

BMI and activity each have a 30 percent effect. Goal progress and habits each have a 20 percent effect. Saving a changed profile recalculates the result.

## Hale and online AI

Local guidance is always available. Online AI is off by default.

When online AI is off:

- Guidance is calculated locally.
- The page shows `Local guidance`.
- No request is sent to DeepSeek.

When the user allows online AI:

- The backend may send age, body measures, activity, goals, preferences, restrictions, and recent records to DeepSeek.
- Names and email addresses are not sent.
- The page shows `AI generated by DeepSeek` when DeepSeek produced the result.
- The user can select `Generate with AI` on the Hale page.

Removing names and email reduces personal context without removing the health values needed for general guidance. The backend uses a fixed JSON response shape. It rejects invalid items and removes advice that conflicts with a listed dietary restriction. It does not request a diagnosis.

If the first DeepSeek response does not match the required shape or safety rules, the backend sends one correction request. Authentication, rate-limit, network, and timeout errors are not retried.

The prompt is zero-shot. It gives the model the required fields, limits, and output schema without example answers. This keeps the request short. Few-shot examples can improve format consistency, but they use more context and can bias the answer.

The request includes at most 12 recent records. A longer history may show more patterns, but it also adds noise and uses more model context. Missing targets use a clear null value. Haleview does not invent missing measurements or progress.

The backend rejects unsupported history claims and builds progress facts from saved records. Weekly and monthly summaries include the calculated wellness score, goal progress, activity, and weight trend. DeepSeek can add a short focus statement, but it cannot replace those calculated facts.

The latest accepted guidance is cached. The last 50 guidance versions are stored with timestamps and included in a personal data export. A refresh asks for a new result. If DeepSeek fails, times out, reaches a limit, or returns no safe items, the backend uses the latest saved result or local guidance. Provider output can still be wrong. Users must review it before use.

DeepSeek is the one external model. It is used for short, structured guidance. The configured timeout is 55 seconds because generation is a separate user action and must not block profile storage.

## Dashboard

The dashboard and its tabs show:

- BMI class and healthy-range comparison.
- Wellness score and component values.
- Goal progress, current values, and target values.
- Weight history and wellness component history.
- Weekly activity records and activity completion.
- Weight, activity, and habit goals with milestones, status, and review dates.
- Weekly activity compared with the 30-day weekly average.
- Milestones and streaks.
- Weekly and monthly summaries.
- High, medium, and low guidance priorities.

Charts use browser canvas, HTML, and CSS. The wellness gauge uses the required score-range gradient. The history chart uses solid areas for BMI, activity, goal, and habit contributions. No chart service receives health data. Canvas redraws only when its data or size changes.

The frontend separates screens and reusable health visuals from the application controller. The backend separates profile, history, authentication, OAuth, email, and recommendation work by module.

## Code layout

- `frontend/src/App.tsx` controls session state, saved data, and page routing.
- `frontend/src/screens` contains complete pages and page sections.
- `frontend/src/components` contains shared navigation and health visuals.
- `frontend/src/styles` contains foundation, entry, app, health, page, and responsive rules.
- `backend/src/app.ts` defines the HTTP routes.
- Other backend modules handle one subject, such as authentication, storage, profiles, email, or guidance.

Run these commands in both `frontend` and `backend` after a code change:

```text
npm run lint
npm run check
npm run build
```

## Errors and limits

Form and API errors appear without a page reload. Profile calculations and local guidance continue when DeepSeek is unavailable.

The backend allows 60 requests in 60 seconds for one signed-in account or one anonymous IP address. Extra requests receive HTTP 429 and a `Retry-After` header. The limit is stored in memory and resets when the backend restarts. A larger deployment should use a shared rate-limit store.

Local Docker ports bind to `127.0.0.1`. Use an HTTPS reverse proxy when exposing the app outside the machine.
