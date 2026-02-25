# Beacon MVP — Row-Level Security (RLS) Explained

> profile_scope: **global** | auth_method: **otp**

Row-Level Security (RLS) is a PostgreSQL feature that enforces access control at the
database row level. In Supabase, every request from the client SDK uses the anon key
and runs as `auth.uid()` — the JWT-authenticated user's UUID. RLS policies gate which
rows that identity may read or write.

---

## Table-by-Table Policy Breakdown

### `users`

| Policy | Operation | SQL Condition | Rationale |
|--------|-----------|---------------|-----------|
| `users: self read` | SELECT | `auth.uid() = id` | A user may only read their own profile row. Other users' profiles are not directly queryable; they are exposed only through the participant join. |
| `users: self insert` | INSERT | `auth.uid() = id` | Prevents a user from creating a profile row for another user. The trigger `on_auth_user_created` also inserts with SECURITY DEFINER, so this policy is a belt-and-suspenders guard for direct client inserts. |
| `users: self update` | UPDATE | `auth.uid() = id` (USING and WITH CHECK) | A user can only update their own name/role/one_liner. |

**No DELETE policy**: User deletion is handled at the `auth.users` level via ON DELETE CASCADE; clients cannot delete their own user row directly.

---

### `events`

| Policy | Operation | SQL Condition | Rationale |
|--------|-----------|---------------|-----------|
| `events: authenticated read` | SELECT | `auth.role() = 'authenticated'` | Any logged-in user can read event metadata (name, join_code, dates). This is required to look up an event by code before joining. |

**No INSERT/UPDATE/DELETE policies**: Events are admin-only. Only the service-role key (used server-side or in Supabase dashboard) can create events.

---

### `event_participants`

| Policy | Operation | SQL Condition | Rationale |
|--------|-----------|---------------|-----------|
| `event_participants: shared event read` | SELECT | `event_id IN (SELECT ep2.event_id FROM event_participants ep2 WHERE ep2.user_id = auth.uid())` | A participant may only see other rows for events they themselves have joined. This prevents leaking participant lists across events. |
| `event_participants: self insert` | INSERT | `auth.uid() = user_id` | A user can only add themselves to an event, not impersonate others. |
| `event_participants: self update` | UPDATE | `auth.uid() = user_id` | Only the participant themselves can toggle `is_discoverable`. |
| `event_participants: self delete` | DELETE | `auth.uid() = user_id` | A participant may leave an event. |

---

### `connection_requests`

| Policy | Operation | SQL Condition | Rationale |
|--------|-----------|---------------|-----------|
| `connection_requests: parties read` | SELECT | `auth.uid() = requester_id OR auth.uid() = recipient_id` | Only the two parties to a request can see it. Third-party observation is blocked. |
| `connection_requests: validated insert` | INSERT | `auth.uid() = requester_id` **AND** caller is in event **AND** recipient is discoverable | Three-layer guard: (1) must be the requester, (2) must be a participant in the event, (3) target must have opted into discoverability. Without guard #3, a user could send requests to hidden participants. |
| `connection_requests: requester update` | UPDATE | `auth.uid() = requester_id` (USING and WITH CHECK) | Only the requester can withdraw their own request (status → 'withdrawn'). The recipient cannot modify the row. |

**No DELETE policy**: Requests are soft-deleted via status change to preserve audit history. Hard deletes are admin-only.

---

### `matches`

| Policy | Operation | SQL Condition | Rationale |
|--------|-----------|---------------|-----------|
| `matches: parties read` | SELECT | `auth.uid() = user_a_id OR auth.uid() = user_b_id` | Only the two matched users can see the match row. |

**No INSERT/UPDATE/DELETE policies**: All match creation goes through `detect_mutual_match()` (SECURITY DEFINER), which bypasses RLS to perform the idempotent insert. Clients can never insert matches directly.

---

## `detect_mutual_match` Function

| Attribute | Value |
|-----------|-------|
| Security mode | `SECURITY DEFINER` (runs as DB owner, bypasses RLS) |
| Called by | `connection.service.ts → sendConnectionRequest` |
| Inputs | `p_event_id`, `p_requester_id`, `p_recipient_id` |
| Behaviour | Checks for a reciprocal pending request → applies canonical UUID ordering → `INSERT ... ON CONFLICT DO NOTHING` → returns match row |
| Client access | Via `supabase.rpc('detect_mutual_match', {...})` — arguments still validated by function body |

---

## Summary Guarantee Table

| Threat | Protected by |
|--------|-------------|
| User A reads User B's profile | `users` SELECT policy: self-only |
| User A reads participants of an event they didn't join | `event_participants` SELECT: subquery on own event memberships |
| User A sends a request to a hidden participant | `connection_requests` INSERT: `is_discoverable = TRUE` check |
| User A fakes a match insert | No INSERT policy on `matches`; only SECURITY DEFINER function |
| User A withdraws someone else's request | `connection_requests` UPDATE: `requester_id = auth.uid()` |
| User A reads matches they're not part of | `matches` SELECT: parties-only |

---

## What RLS Does NOT Protect Against

> Understanding the limits of RLS is as important as understanding what it enforces.

| Gap | Explanation |
|-----|-------------|
| **Timing attacks** | An attacker can infer whether a row exists by measuring query latency even when RLS returns 0 rows. Mitigate with rate limiting at the API gateway. |
| **Aggregate inference** | Even with RLS, if a count/avg query is exposed, an attacker can infer population properties. Avoid exposing aggregate endpoints to unauthenticated users. |
| **Service-role key exposure** | The Supabase service-role key bypasses all RLS. Never expose it client-side. Keep it only in server environments (Edge Functions, backend APIs). |
| **Supabase Realtime channels** | Realtime subscriptions have separate access control. RLS policies are replicated to Realtime, but channel-level filters must also be applied in your subscription code. |
| **Function arguments** | `detect_mutual_match` is SECURITY DEFINER. Its body validates business rules, but the function itself is callable by any authenticated user. Ensure all inputs are validated inside the function. |
| **Application-layer bugs** | RLS enforces the contract at the DB layer, but a misconfigured service layer can still leak data by selecting broader columns or ignoring error responses. |

---

## Assumption Requiring Confirmation

**profile_scope = "global"** was used for this scaffold.

This means `name`, `role`, and `one_liner` are stored on the `users` table and are
**shared across all events**. When User A appears on the Discover screen, their profile
reflects their global identity — not an event-specific persona.

**If you want per-event profiles in the future:**
1. Move `name`, `role`, `one_liner` from `users` to `event_participants`.
2. Update `participant.service.ts → listDiscoverableParticipants` to read those columns
   directly from `event_participants` instead of joining `users`.
3. Create a new migration file (do not modify `001_initial_schema.sql`).
