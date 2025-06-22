import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nojlfilayycebrtyybzf.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vamxmaWxheXljZWJydHl5YnpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MTgyOTUsImV4cCI6MjA2NjA5NDI5NX0.4WzHmtycN8mpc0fI5ZDHQackiKu3XSr41GTQ8dQDHjQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);