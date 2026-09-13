# Monthly AI Studio

Monthly AI Studio prepares researched monthly content according to the active package. All packages receive the same AI research, strategy, image creation, review and Content Studio workflow; only the monthly post allowance differs (12, 30 or 60). Nothing is approved, scheduled or published without the user.

## Execution contract

1. The planner snapshots the verified Business Brain, package allowance, selected month and untouched customer-owned photographs.
2. One research call gathers current market/platform context and stores visible source URLs. Research can guide strategy but cannot invent or verify business facts.
3. One planning call creates the complete month: distinct intents, topics, platform goals, proposed dates, source references and a unique photograph-specific art direction for every slot.
4. Each post uses one content call, one image call and one independent quality call. Quality review never causes an automatic regeneration or a second paid attempt.
5. The image model receives the real source photograph, exact approved copy, brand context, platform, intent and unique art direction. It cleans weak photography when needed and creates the complete final 4:5 design itself.
6. The first generated result is stored as a draft with its rationale, facts, sources, hashtags and quality findings. The user decides whether to approve, edit or explicitly request one AI revision in Content Studio.

## AI-only visual pipeline

There is no application-owned design composer and there are no coded layout presets. The server does not add a header, footer, frame, panel, typography layer, color block, logo treatment or decorative element after generation. It only rotates, crops/resizes the model result to 1080×1350 and encodes a bounded JPEG for storage.

The planning schema stores free-form art direction rather than a layout enum. Prompts require every design to respond to the actual photograph, lighting, environment, campaign intent and target platform. Reusable templates and generic bands are explicitly rejected by the quality review.

Uploaded originals are immutable gallery assets. AI results are separate derived assets with provenance. Content Studio regeneration is also AI-only: the current post image and the user's instruction are sent to the image model, and the existing asset remains untouched if the request fails.

## Cost and retry safety

Stable database keys permit at most one automatic paid request for research, whole-month planning and each post's content/image/quality stage. Provider errors stop the plan; they do not silently retry. Resuming a plan continues from the stored stage whenever it is safe. Explicit user regeneration is a new user-authorized request.

Monthly quota is enforced from the active entitlement. Planner reservations and existing posts prevent generation beyond the package allowance.

## Activation

Runtime secrets belong in the untracked root `.env` or the deployment secret store. `.env.example` documents:

- `AI_PROVIDER=openai|openrouter`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
- `AI_PLANNER_MODEL`
- `AI_IMAGE_MODEL`
- `AI_IMAGE_QUALITY`
- model/search/image price and budget variables
- `AI_MONTHLY_PLANNER_ENABLED`
- restricted `DATABASE_URL` and `WORKER_DATABASE_URL`
- `PROCESS_ROLE`

Keep `AI_MONTHLY_PLANNER_ENABLED=false` while changing prompts or inspecting data. Before activation, run typecheck, lint, unit tests, a production build, the database worker-role verifier and the explicit provider smoke/evaluation gates. A complete reviewed live month is still required before treating a model/prompt combination as production-approved.

## Current safety state

The Aurum plan was stopped and reset after historical runs showed excessive repeated provider calls. Its old generated posts and derived assets were removed while the original uploads and provider cost history were preserved. Automatic regeneration was removed and the paid-stage keys were made prompt-version independent.
