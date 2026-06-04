# Branded auth subdomain for Firebase Auth's __/auth/handler.
#
# Background
# ----------
# Firebase Auth's OAuth popup redirects through `https://<authDomain>/__/auth/handler`.
# That URL must be served by Firebase Hosting — there's no way to make
# arbitrary infrastructure serve it (it's a server-side OAuth handler page
# managed by Firebase, not just a static asset). The `authDomain` value
# ships in the browser bundle as NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.
#
# Default: <project>.firebaseapp.com (Firebase's auto-provisioned site).
# Functional but unbranded — users see `lifecoach-dev-zvb6d.firebaseapp.com`
# flash briefly during the Google sign-in popup.
#
# This file wires up `auth.tranquil.coach` as a Firebase Hosting custom
# domain on a dedicated site. After cert provisioning completes (~15-30 min
# on first apply), the auth handler is reachable at
# `https://auth.tranquil.coach/__/auth/handler` and we can flip
# `auth_domain_override` in module.firebase_auth to surface that URL to
# the browser instead.
#
# Deployment sequence (one-time):
#   1. Apply this PR with `auth_domain_override = ""` (current state).
#      Hosting site + custom domain + DNS records get created. Cert
#      provisioning begins. authDomain stays as firebaseapp.com — nothing
#      breaks.
#   2. Wait until `auth.tranquil.coach` resolves AND
#      `https://auth.tranquil.coach/__/auth/handler` returns 200
#      (check with `curl -sI`). Typically 15-30 minutes after apply.
#   3. In GCP Console → Credentials → OAuth client 1040526968723-...,
#      add `https://auth.tranquil.coach/__/auth/handler` to
#      "Authorized redirect URIs". Keep the firebaseapp.com URI as well
#      until step 4 has rolled out, then remove it.
#   4. Set `auth_domain_override = "auth.tranquil.coach"` on
#      module.firebase_auth in main.tf and apply. New web image builds
#      will inline auth.tranquil.coach as NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.
#   5. Confirm sign-in works on tranquil.coach + any PR preview.
#   6. (Optional) Remove `https://lifecoach-dev-zvb6d.firebaseapp.com/__/auth/handler`
#      from the OAuth client after a soak period.
#
# Cost
# ----
# Firebase Hosting custom domain + cert: free.
# Cloud DNS A record: ~$0.20/mo for the additional record set in the
# existing tranquil.coach zone.

# --- Firebase Hosting site --------------------------------------------------
# Dedicated site (not the project's default firebaseapp.com site) so the
# auth subdomain doesn't share configuration with whatever else we might
# host under the project's default site later.

resource "google_firebase_hosting_site" "auth" {
  provider = google-beta
  project  = var.project_id

  # Globally unique site_id; the firebaseapp.com URL becomes
  # https://<site_id>.web.app — kept short. Lowercase, hyphens only.
  site_id = "lifecoach-dev-auth"

  depends_on = [module.apis]
}

# --- Custom domain mapping --------------------------------------------------
# Registers auth.tranquil.coach as a custom domain on the Hosting site.
# Firebase provisions a managed SSL cert for it once the DNS A record
# (below) resolves to Firebase Hosting's anycast IP.
#
# wait_dns_verification = false: we own the DNS zone in this same project,
# so the records below are applied in the same plan; no point waiting
# inside this resource.

resource "google_firebase_hosting_custom_domain" "auth" {
  provider = google-beta
  project  = var.project_id

  site_id       = google_firebase_hosting_site.auth.site_id
  custom_domain = "auth.${var.custom_domain_name}"

  wait_dns_verification = false

  cert_preference = "GROUPED"
}

# --- DNS A records ----------------------------------------------------------
# Firebase Hosting's anycast IPs. Two A records is the recommended setup
# (Firebase serves both as a failover pair). These IPs are stable per
# Firebase's documented setup:
#   https://firebase.google.com/docs/hosting/custom-domain

resource "google_dns_record_set" "auth_subdomain_a" {
  project      = var.project_id
  managed_zone = module.domain.dns_zone_name
  name         = "auth.${var.custom_domain_name}."
  type         = "A"
  ttl          = 300
  rrdatas = [
    "199.36.158.100",
  ]
}

# --- Outputs ---------------------------------------------------------------

output "firebase_hosting_auth_domain" {
  value       = "auth.${var.custom_domain_name}"
  description = "Custom Firebase Hosting subdomain for the auth handler. Set module.firebase_auth.auth_domain_override to this value once the cert is ACTIVE."
}
