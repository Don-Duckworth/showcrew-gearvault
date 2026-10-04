// ShowCrew GearVault — cloud configuration. Fill in the two values from Supabase → Project Settings → API (or "Connect").
// The anon / publishable key is designed to be public: Row Level Security + required two-factor (aal2) protect the data.
// NEVER put the service_role / secret key here.
export const SUPABASE_URL = 'https://ggtkglxvuxvmuqtpvlgs.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_h7YiH-40ys7UtZLLhJxEUA_jkBw6b8x'; // publishable key (public by design)

// Show a "Create account" link on the sign-in screen. Keep false once Don's account exists
// (and also turn off "Allow new users to sign up" in Supabase → Authentication → Sign In / Providers).
export const ALLOW_SIGNUP = false;

// Private storage bucket created by supabase/migrations/0001_init.sql.
export const STORAGE_BUCKET = 'gear-files';
