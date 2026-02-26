-- =============================================================================
-- Remove automatic user creation trigger
-- Users will be created in app code after OTP verification
-- =============================================================================

-- Drop the automatic user creation trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop the function
DROP FUNCTION IF EXISTS handle_new_user();
