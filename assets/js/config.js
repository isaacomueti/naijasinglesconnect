/*
 * Public Supabase settings. Both values are designed to be shipped to browsers:
 * the publishable key only allows what the row level security rules in
 * supabase/schema.sql permit. Never put the secret / service_role key here.
 *
 * Add ?demo=1 to any page URL to switch that browser tab to the sample data,
 * and ?demo=0 to switch back to the live database.
 */
window.NSC_CONFIG = {
  supabaseUrl: 'https://iyzbrjrkbsepzicipwgd.supabase.co',
  supabaseKey: 'sb_publishable_NcONnTgnBE1GVsFV22EXOA_PkIQOHhB'
};
