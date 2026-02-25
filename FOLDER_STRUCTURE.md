# Beacon MVP — Folder Structure

> profile_scope: **global** | auth_method: **otp**

## Annotated Directory Tree

```
beacon/
├── app.json                        # Expo configuration (appId, scheme, plugins)
├── babel.config.js                 # Babel preset for Expo
├── tsconfig.json                   # TypeScript: strict mode, path aliases
├── package.json                    # Dependencies: expo, @supabase/supabase-js, react-navigation
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # All tables, RLS policies, indexes, detect_mutual_match()
│
├── src/
│   ├── lib/
│   │   └── supabase.ts             # createClient<Database> singleton (reads env vars)
│   │
│   ├── types/
│   │   └── database.ts             # Row interfaces, insert/update types, composite types,
│   │                               # Database interface for the Supabase generic
│   │
│   ├── services/                   # The ONLY layer that imports supabase
│   │   ├── auth.service.ts         # signInWithOtp, verifyOtp, getSession, signOut
│   │   ├── event.service.ts        # getEventByCode, joinEvent, joinEventByCode
│   │   ├── participant.service.ts  # toggleDiscoverable, listDiscoverableParticipants
│   │   ├── connection.service.ts   # sendConnectionRequest, withdrawRequest,
│   │   │                          # listRequests, detectMutualMatch
│   │   └── match.service.ts        # listMatches, getPostEventSummaryStub
│   │
│   ├── hooks/                      # Custom React hooks — import services, never supabase directly
│   │   └── (e.g. useAuth.ts, useEvent.ts, useParticipants.ts, useMatches.ts)
│   │
│   ├── screens/                    # Screen components — import hooks, never services directly
│   │   └── (e.g. OtpScreen.tsx, JoinEventScreen.tsx, DiscoverScreen.tsx, MatchesScreen.tsx)
│   │
│   ├── components/                 # Reusable presentational components
│   │   └── (e.g. ParticipantCard.tsx, MatchBadge.tsx, ToggleDiscoverable.tsx)
│   │
│   └── navigation/                 # React Navigation stack/tab definitions
│       └── (e.g. RootNavigator.tsx, AppNavigator.tsx)
```

## Architectural Rules

These rules are enforced by convention (not a linter rule, yet) and must be maintained
by every contributor:

| Rule | Rationale |
|------|-----------|
| **Services are the ONLY layer that imports `supabase`** | Centralises all DB access. Any future backend migration only touches services. |
| **Hooks import services; never supabase directly** | Hooks handle React state, caching, and side-effects but remain agnostic to the DB client. |
| **Screens import hooks; never services directly** | Screens are pure view controllers. Business logic and async stays in hooks. |
| **Screens NEVER call supabase directly** | Guarantees the service layer is the single source of truth for data contracts. |
| **Types live in `src/types/database.ts`** | One canonical definition; no duplicate Row interfaces in service files. |

## Environment Variables

The following must be set in `.env` (or Expo's `extra` field in `app.json`):

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

Never commit real values. Use `.env.example` with placeholder strings.

## Key Design Decisions

- **profile_scope = global**: User's `name`, `role`, and `one_liner` are stored on the
  `users` table and are shared across all events. If you need per-event profiles in the
  future, move these columns to `event_participants` and update `participant.service.ts`.

- **auth_method = otp**: Two-step flow — `signInWithOtp` sends the code,
  `verifyOtp` exchanges it for a session. No magic-link redirect handling needed.

- **detect_mutual_match is SECURITY DEFINER**: The function runs as the DB owner to bypass
  RLS on the `matches` table. Clients cannot insert matches directly.
