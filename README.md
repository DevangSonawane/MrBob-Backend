# Home Services Platform — Backend

Backend API for the Home Services Platform: customer app, professional app, and admin/ops
dashboard all talk to this single service. Built as a **modular monolith** — one deployable
app with hard module boundaries (`auth`, `users`, `professionals`, `bookings`, `dispatch`,
`payments`, `amc`, `reviews`, `zones`, `partners`, `notifications`) so any one of them can be
extracted into its own service later without a rewrite. See the architecture doc for the
full extraction plan (dispatch and payments are the likely first candidates).

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ / Express 5 |
| Database | PostgreSQL via Prisma ORM |
| Auth | Phone + OTP login, JWT access/refresh tokens |
| Validation | Zod |
| Docs | OpenAPI 3 spec in `src/docs`, served by swagger-ui-express (`/api-docs`) |
| Logging | Pino |
| Payments | Razorpay |
| Notifications | WhatsApp Business API + Firebase Cloud Messaging (stubbed, see below) |
| Local DB | Docker Compose (Postgres) |
| Deploy (now) | Render (`render.yaml` blueprint) |
| Deploy (later) | AWS EC2/ECS, per the architecture doc |
| CI | GitHub Actions (lint + test on PR) |

## Project layout

```
src/
  config/         env, logger, prisma client
  docs/           the OpenAPI spec: shared schemas + one file per API area (see "API documentation")
  middlewares/     auth (JWT), centralized error handler
  modules/         one folder per module: *.routes.js, *.controller.js, *.service.js, *.schema.js
  routes/          mounts every module's router under API_BASE_PATH
  utils/           ApiError, catchAsync, validate, pagination
  db/seed/         dev seed data (a city, a zone, 3 service categories, a super admin user)
  app.js           Express app (middleware pipeline, routes, error handling)
  server.js        process entrypoint, graceful shutdown
prisma/
  schema.prisma    all models, grouped and commented by owning module
```

Each module follows the same shape: `routes.js` (Express Router) → `controller.js` (thin, calls
the service) → `service.js` (business logic, Prisma calls) → `schema.js` (Zod request schemas
used by `validate()`).

## API documentation

Swagger UI at `/api-docs` documents every endpoint: who can call it, parameters, the request
body with an example, the success response with an example, and each error it can return.

The spec lives in `src/docs`:

- `components.js` — shared schemas (User, Booking, VendorApplication…), error responses, and
  the example payloads.
- `paths/*.js` — one file per area, built with the small helpers in `helpers.js`.
- `index.js` — assembles the document; the order of `sections` is the order in Swagger UI.

When you add or change a route, update its entry in `src/docs/paths`. `tests/apiDocs.test.js`
fails if a route is undocumented (or a documented route no longer exists), and the vendor
onboarding tests check the documented examples have the same fields as real responses.

## Getting started

### 1. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` and the JWT secrets at minimum. Everything else (Razorpay, Firebase,
WhatsApp, Google Maps, Cloudflare R2) is optional for local dev — each integration falls back
to a logged stub when its keys are unset, so you can build against the API without live
credentials for any of them.

### 3. Start Postgres

Either run Postgres locally, or use Docker Compose:

```bash
docker compose up -d postgres
```

### 4. Run migrations and seed data

```bash
npm run prisma:migrate
npm run seed
```

The seed creates one city (Bengaluru), one zone (Koramangala), three service categories
(Electrician, Plumber, AC Repair), and one super admin user (`+919999999999`). Re-running it
promotes that account to `SUPER_ADMIN` if it was created before the role existed.

### 5. Run the server

```bash
npm run dev
```

- API base: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/api-docs`
- Health check: `http://localhost:4000/health`

### Full stack via Docker Compose

```bash
docker compose up --build
```

Runs Postgres + the API together; the API container applies migrations on boot.

## Auth flow

Two independent login paths, both issuing the same JWT access (15m) + refresh (30d) token
pair. Send `Authorization: Bearer <accessToken>` on subsequent requests.

**Phone + OTP** (no password):

1. `POST /auth/otp/request { phone }` — generates a 4-digit OTP (5 min TTL, discarded after 5 wrong attempts). In dev, with no
   `WHATSAPP_API_TOKEN` set, the OTP is written to the server log instead of sent.
2. `POST /auth/otp/verify { phone, otp, name? }` — verifies the OTP, creates the user on first
   login (role `CUSTOMER`).
3. `POST /auth/refresh { refreshToken }` — rotates the token pair.

**No SMS provider yet?** Set `OTP_STATIC_CODE` to a 4-digit value (e.g. `1234`) and every
OTP — customer and vendor — is that fixed code, so the apps can be built and tested end to
end. The request step is still required before verify. Unset it once real delivery exists:
while it is on, anyone who knows the code can sign in as any phone number.

The OTP store is an in-memory `Map` (`src/modules/auth/otp.store.js`) — fine for a single
dev/staging instance, but swap it for Redis before running more than one instance behind a
load balancer.

**Email + password**:

1. `POST /auth/signup { name, email, password, phone? }` — creates a `CUSTOMER` account
   (password hashed with bcrypt) and logs in immediately.
2. `POST /auth/login { email, password }`.

Either path lands the user in the same place: a `User` row with `isOnboarded: false`.

## Onboarding

After first login (via either path), the client is expected to walk the user through
onboarding before letting them do anything role-specific:

- `GET /onboarding/status` — `{ isOnboarded, role, hasProfessionalProfile, vendorOnboardingStatus }`.
- `POST /onboarding/customer { cityId, name?, phone?, address? }` — fills in the rest of the
  customer profile and sets `isOnboarded: true`.
- Professionals (vendors) go through the step-by-step flow below instead.

## Vendor onboarding

The vendor app walks a vendor through five steps. Swagger lists them first, one section per
step, with full request and response examples.

| # | Step | Who | Endpoints (under `/vendor-onboarding`) |
|---|---|---|---|
| 1 | Phone number | Vendor | `POST /otp/request { phone }` |
| 2 | Verify OTP | Vendor | `POST /otp/verify { phone, otp }` → tokens + the application |
| 3 | Enter details | Vendor | `PUT /personal-details`, `PUT /profile-photo`, `PUT /services`, `PUT /documents/{aadhaar\|pan}`, `PUT /bank-details`, then `POST /submit` |
| 4 | Verify vendor | Admins, then a super admin | `POST /applications/{id}/documents/{type}/verify` for Aadhaar, PAN and bank account, then `POST /applications/{id}/approve` |
| 5 | Vendor verified | Vendor | `GET /status` → `status: APPROVED`, `flow.isVerified: true` |

Every response that includes the application carries a `flow` object — the five steps, each
`PENDING`, `CURRENT`, `COMPLETE`, `ACTION_REQUIRED` or `REJECTED`, plus `currentStep` — so the
app can draw its progress tracker without working anything out itself.

**Steps 1 & 2.** Verifying the OTP creates the account on first use (role `PROFESSIONAL`),
opens a `DRAFT` application, and returns the tokens together with the application, so a
returning vendor lands wherever they left off. Admin and deactivated numbers are refused.
In dev, without `WHATSAPP_API_TOKEN`, the OTP is written to the server log.

**Step 3.** Six parts, saved in any order; each save returns the whole application with
`detailSteps` (which parts are complete) and `nextStep`. Also: `GET /` (the application) and
`GET /documents/{type}/files/{side}` / `GET /profile-photo` (the vendor's own uploads).
Editing is only possible while the application is `DRAFT` or `CHANGES_REQUESTED`.

**Step 4.** Underneath, the application moves through these statuses:

```
DRAFT ──submit──▶ SUBMITTED ──Aadhaar, PAN, bank verified──▶ PENDING_APPROVAL ──approve──▶ APPROVED
  ▲                   │                                            │
  │                   ├─ one of them is rejected ─┐                ├─ reject ──▶ REJECTED ─┐
  └── vendor edits ── CHANGES_REQUESTED ◀─────────┴─ request changes ─┘◀────── reopen ─────┘
```

Admin endpoints (`ADMIN` or `SUPER_ADMIN`; under `/vendor-onboarding/applications`):

| Endpoint | What it does |
|---|---|
| `GET /` | Queue, filter by `status`, `cityId`, `search`. |
| `GET /summary` | Counts by status. |
| `GET /{id}` | Full application: unmasked numbers, verification details, audit trail. |
| `GET /{id}/documents/{type}/files/{side}`, `GET /{id}/profile-photo` | View uploads. |
| `POST /{id}/documents/{type}/verify` | Mark the Aadhaar, PAN or bank account verified. |
| `POST /{id}/documents/{type}/reject { reason }` | Reject one; sends the application back to the vendor. |
| `POST /{id}/request-changes { reason, documents? }` | Send the application back; listed items must be re-uploaded. |

Super admin only:

| Endpoint | What it does |
|---|---|
| `POST /{id}/approve` | Final approval, only from `PENDING_APPROVAL`. Sets `kycStatus: VERIFIED` (what dispatch checks) and `isOnboarded: true`. |
| `POST /{id}/reject { reason }` | Final rejection. |
| `POST /{id}/reopen { reason }` | Reopen a rejected application: back to `CHANGES_REQUESTED` with everything intact. |

**Step 5.** `GET /status` is a small payload for the "verification in progress" screen to
poll. Once approved, any signed-in user can fetch the vendor's photo at
`GET /professionals/{id}/photo`.

### Super admin panel

Swagger groups everything the super admin dashboard calls under **Super admin panel** (the
same endpoints as in their own sections, listed together):

| Need | Endpoint |
|---|---|
| Vendors by status, with filters | `GET /vendor-onboarding/applications` — `status` (one or comma-separated), `search`, `cityId`, `zoneId`, `categoryId`, `submittedFrom`/`submittedTo`, `sortBy`, `sortOrder`, `page`, `limit` |
| Counts for status tabs | `GET /vendor-onboarding/applications/summary` — includes `awaitingFinalApproval` |
| One vendor in full | `GET /vendor-onboarding/applications/{id}` (+ document and photo endpoints) |
| Final decision | `POST /vendor-onboarding/applications/{id}/approve`, `/reject`, `/reopen`, `/request-changes` |
| All users, with filters | `GET /users` — `role` (one or comma-separated), `search`, `cityId`, `isActive`, `isOnboarded`, `vendorStatus`, `createdFrom`/`createdTo`, `sortBy`, `sortOrder`, `page`, `limit` |
| User counts | `GET /users/summary` |
| One user in full | `GET /users/{id}` — city, vendor status, usage counts |
| Manage accounts | `POST /users`, `PATCH /users/{id}/active` |

The vendor queue for the super admin is `status=PENDING_APPROVAL`. Lists and details are open
to admins as well; approve, reject and reopen are super admin only.

### Document verification

Verifying the Aadhaar, PAN and bank account goes through a provider (`src/modules/vendorOnboarding/kycVerification.service.js`),
selected by `KYC_VERIFICATION_PROVIDER`. The only provider today is `manual`, which leaves
every document for an admin to verify with the endpoints above. To add a verification API,
add a provider there that returns `VERIFIED` / `REJECTED` / `PENDING`; it runs automatically
on submit and manual review stays as the fallback.

### How documents are stored

- Aadhaar, PAN and bank account **numbers** are encrypted (AES-256-GCM, `KYC_ENCRYPTION_KEY`)
  and never stored or logged in plaintext. Vendors only ever see the last four characters;
  admins reviewing an application see the full number. A keyed hash stops one Aadhaar, PAN or
  bank account being used on two vendor accounts.
- Document **images** are private: stored in Cloudflare R2 when `R2_*` is configured, on local
  disk (`UPLOAD_DIR`) in dev/test, and only served through the authenticated endpoints above.
  JPEG, PNG, WebP or PDF, 5 MB max.
- In production, uploads return 503 until both `KYC_ENCRYPTION_KEY` and the `R2_*` values are
  set. Do not change `KYC_ENCRYPTION_KEY` once documents exist — they can't be decrypted
  without it.

### Roles

`SUPER_ADMIN` can do everything `ADMIN` can, plus the final approve/reject above and creating
or deactivating other super admins (`POST /users` with `role: SUPER_ADMIN`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon (auto-restart) |
| `npm start` | Start for production |
| `npm run lint` | ESLint |
| `npm run format` | Prettier write |
| `npm test` | Jest + Supertest |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:deploy` | Apply pending migrations (CI/prod) |
| `npm run prisma:studio` | Prisma Studio GUI |
| `npm run seed` | Run `src/db/seed/index.js` |

## Deploying

### Render (current target)

`render.yaml` defines a Postgres instance and a Docker web service with a health check at
`/health`. Push to the connected branch and Render builds from the `Dockerfile`. Secrets not
listed in `render.yaml` (Razorpay, Firebase, WhatsApp, Maps, R2) are set in the Render
dashboard, not committed.

### AWS (future)

The `Dockerfile` is plain multi-stage Node — it runs the same way on EC2/ECS as it does on
Render. When migrating, the only things that change are where `DATABASE_URL` points and how
the container is scheduled; no application code changes are expected.

## Extending a module → extracting a service later

Per the architecture doc's strangler-fig plan: give the module its own Postgres schema first
(no cross-schema joins), extract it into its own service while still reading/writing that
schema, then move the schema to its own database instance. To keep that mechanical:

- Don't import another module's `*.service.js` directly for anything beyond a read — go
  through Prisma the same way a network call would, not through shared in-process state.
- Keep cross-module references as foreign-key IDs, not embedded objects.
- `dispatch` and `payments` are the flagged first candidates — their services
  (`dispatch.service.js`, `payments.service.js`) are already written to only touch their own
  concerns plus read-only lookups.

## Known scaffold gaps (by design, for a first pass)

- OTP store is in-memory (see above) — move to Redis for multi-instance deployments.
- Razorpay, Firebase, WhatsApp, Google Maps, and Cloudflare R2 are wired up with real client
  code but fall back to logged stubs without credentials — add keys to `.env` to go live.
- Dispatch matching is rating-ranked, not geo/ETA-ranked — needs live professional location
  (Firebase presence + Google Maps) before it's real.
- File uploads exist for KYC documents only (`modules/storage`); job photos are not built yet.
- The R2 storage path is implemented but has only been exercised against local disk — test an
  upload and download against a real bucket before going live.
- Aadhaar/PAN/bank verification is manual (see "Document verification") until a provider is
  added. Nothing pays out to the saved bank account yet — it is captured and verified only.
