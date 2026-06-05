# ProofSprint

ProofSprint turns a shipped product into a short validation sprint. A builder creates a sprint, shares a tester link, collects structured feedback, and gets a Proof Score with risks and next experiments.

## Open Locally

Open `index.html` in a browser.

## Current MVP

- Create a proof sprint with product URL, audience, hypothesis, mission, and validation signal.
- Choose multiple validation signals: clarity, value, confidence, onboarding, and pricing.
- Validate required creator/tester fields with friendly inline errors.
- Guard against oversized public tester links by limiting sprint copy length.
- Share a tester link.
- Collect tester scores for clarity, value, confidence, and friction.
- Save and load sprints/responses from Supabase when configured.
- Generate a dashboard with Proof Score, summary, risk, next experiment, quotes, and export.
- Import proof packets for manual response collection.
- Let testers copy or email a feedback packet after submission.
- Load a demo dashboard with seeded evidence.
- Use `proofsprint-thumbnail.png` as a 3:2 project thumbnail.

## Tracking Events Ready For Novus

The app calls `window.proofSprintTrack(eventName, properties)` for these required hackathon events:

- `test_created`
- `tester_started`
- `feedback_submitted`
- `dashboard_viewed`

It also tracks additional product behavior for richer analysis:

- `test_shared`
- `product_opened`
- `task_completed`
- `feedback_imported`
- `insight_exported`
- `demo_dashboard_loaded`
- `creator_validation_failed`
- `tester_validation_failed`
- `proof_packet_email_started`
- `cloud_sprint_saved`
- `cloud_response_saved`

Paste the real Novus.ai snippet into `index.html` and keep the existing `window.proofSprintTrack` bridge.

## Supabase Setup

1. Create a free Supabase project.
2. Open the SQL editor.
3. Run `supabase-schema.sql`.
4. Go to Project Settings / API Keys.
5. Copy the project URL and publishable key. A legacy anon key also works.
6. Paste them into `index.html`:

```js
window.PROOFSPRINT_SUPABASE = {
  url: "https://YOUR_PROJECT.supabase.co",
  publishableKey: "sb_publishable_..."
};
```

Do not paste a secret key or service role key into the frontend.

Deploy as a static site on Netlify or Vercel once Novus and persistence are connected.
