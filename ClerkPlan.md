**Title**
Clerk Auth + District Onboarding Plan (Learning‑First)

**Summary**
Clerk is a hosted authentication service that handles sign‑up/sign‑in (including OAuth, which is “sign in with Google/Facebook”) so you don’t store or validate passwords yourself. It matters because it reduces security risk and saves time, while still letting your app own domain data like district. You’ll use it when you want reliable auth flows quickly and still control your own profile fields. In the backend, you’ll add middleware (a function that runs between request and response) to verify Clerk sessions and attach auth state to requests. ([clerk.com](https://clerk.com/docs/authentication/social-connections/overview?utm_source=openai))

**Learning Resources (read in order)**

1. Clerk React Quickstart — read “Set your Clerk API keys” and “Add `<ClerkProvider>` to your app.” ([clerk.com](https://clerk.com/docs/react/getting-started/quickstart?utm_source=openai))
2. Request authentication (React) — read the “React‑based applications” section on using `useAuth().getToken()` and `Authorization: Bearer …` for API calls. ([clerk.com](https://clerk.com/docs/backend-requests/making-requests?utm_source=openai))
3. `clerkMiddleware()` (Express) — read the top description and the “Use `clerkMiddleware()`, `requireAuth()`, and `getAuth()` together” example to understand how auth state is attached to `req.auth`. ([clerk.com](https://clerk.com/docs/reference/express/clerk-middleware?utm_source=openai))
4. Social connections (OAuth) overview — read “Before you start” and “Enable a social connection,” especially the development instance notes. ([clerk.com](https://clerk.com/docs/authentication/social-connections/overview?utm_source=openai))

**Decisions Locked**

- Replace the custom JWT flow with Clerk session tokens verified on the server.
- Use Clerk’s prebuilt Sign‑In/Sign‑Up UI components inside your existing routes.
- Store `district/state` in your DB, linked via a new `clerk_user_id`.

**Implementation Steps**

1. **Clerk app setup**  
   Create a Clerk application, grab the Publishable Key and Secret Key, and enable Google and Facebook social connections in the Clerk dashboard. In development, Clerk provides shared OAuth credentials, so no extra provider setup is required at first. ([clerk.com](https://clerk.com/docs/authentication/social-connections/overview?utm_source=openai))  
   Add `VITE_CLERK_PUBLISHABLE_KEY` to `client/.env` and `CLERK_SECRET_KEY` to `server/.env`. ([clerk.com](https://clerk.com/docs/react/getting-started/quickstart?utm_source=openai))

2. **Client auth integration (ClerkProvider + token for API calls)**  
   Install `@clerk/clerk-react`. Wrap the app with `<ClerkProvider>` so Clerk hooks/components work. ([clerk.com](https://clerk.com/docs/react/getting-started/quickstart?utm_source=openai))  
   Update your auth fetch helper to call `useAuth().getToken()` and send `Authorization: Bearer <session_token>` for API calls (cross‑origin in dev). ([clerk.com](https://clerk.com/docs/backend-requests/making-requests?utm_source=openai))

3. **Server auth integration (replace JWT)**  
   Install `@clerk/express`. Add `clerkMiddleware()` before other middleware so `req.auth` is attached based on session tokens in headers/cookies. ([clerk.com](https://clerk.com/docs/reference/express/clerk-middleware?utm_source=openai))  
   Replace `getUserFromToken` and `requireUser` to read `req.auth.userId` and return `401` for unauthenticated API requests instead of redirects.

4. **DB schema changes**  
   Add `clerk_user_id` (unique) to `users`. Make `password` nullable (Clerk owns credentials).  
   Update user queries to support lookups by `clerk_user_id` and to create/update users without passwords.

5. **Onboarding endpoint (district step)**  
   Add `POST /users/me/onboarding` that:
   - Requires Clerk auth (must have `req.auth.userId`)
   - Accepts `address`
   - Uses `getDistrictFromAddress()` to resolve `state` and `district`
   - Upserts the local user row with `clerk_user_id`, `state`, `district`, plus name/email from Clerk (or from the client if you choose)

6. **UI flows (two‑step sign‑up)**  
   Replace `Login.jsx` and `Signup.jsx` with Clerk Sign‑In/Sign‑Up components.  
   After successful Clerk sign‑up, redirect to `/onboarding` to collect address and store district.

7. **Route guarding**  
   If a user is authenticated but lacks `state/district` in the DB, force them to `/onboarding` before `/feed` or `/profile`.

8. **Cleanup**  
   Deprecate `/users/login` and `/users/signup`. Remove JWT utils and localStorage token usage.

**Public API / Interface Changes**

- `Authorization` header now expects a Clerk session token, not a custom JWT. ([clerk.com](https://clerk.com/docs/reference/express/clerk-middleware?utm_source=openai))
- New endpoint: `POST /users/me/onboarding` to set district after sign‑up.
- `POST /users/login` and `POST /users/signup` are removed or deprecated.

**Test Cases and Scenarios**

- Email/password sign‑up via Clerk → onboarding → `/users/me` returns district.
- Google sign‑in (OAuth) works in dev without provider config. ([clerk.com](https://clerk.com/docs/authentication/social-connections/overview?utm_source=openai))
- Facebook sign‑in works in dev without provider config. ([clerk.com](https://clerk.com/docs/authentication/social-connections/overview?utm_source=openai))
- Authenticated API call with `Authorization: Bearer <token>` succeeds; without token returns `401`. ([clerk.com](https://clerk.com/docs/backend-requests/making-requests?utm_source=openai))
- Authenticated user without district is redirected to `/onboarding`.

**Assumptions and Defaults**

- No migration of existing password users unless you ask for it.
- District/state live in the app DB and are keyed by `clerk_user_id`.
- The client and server are cross‑origin in dev, so API requests must send a Bearer token. ([clerk.com](https://clerk.com/docs/backend-requests/making-requests?utm_source=openai))
