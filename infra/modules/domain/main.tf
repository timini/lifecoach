# Domain registration + DNS managed zone for the lifecoach web app.
#
# Why this module exists: Cloud Run preview hostnames live under `*.run.app`,
# which is on the Public Suffix List. Firebase Auth's authorized-domains
# allowlist does NOT honor subdomain wildcards under public suffixes, so
# every per-PR preview hostname would need its own explicit allowlist entry
# (operational pain + auth/unauthorized-continue-uri errors when missed).
#
# This module brings a non-public-suffix domain we own into the project,
# managed entirely via Terraform. Once registered:
#   - A single Firebase allowlist entry of `preview.lifecoach.dev` covers
#     every `pr-N.preview.lifecoach.dev` subdomain.
#   - The preview env's google_cloud_run_domain_mapping points each PR's
#     web service at its `pr-${pr_number}.preview.lifecoach.dev` hostname.
#   - DNS records live in this module's google_dns_managed_zone; preview
#     env writes per-PR CNAMEs into that zone.
#
# Cost: ~$12/yr domain renewal + ~$0.20/mo for the managed zone.
#
# Reversibility caveat: google_clouddomains_registration is a sticky
# resource. Once Cloud Domains accepts the registration request the
# domain is yours until it expires; removing the resource from Terraform
# state does NOT unregister or refund. Treat the first apply as a real
# commitment.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project that owns the domain registration and the DNS zone."
}

variable "domain_name" {
  type        = string
  description = "The apex domain to register and host the DNS zone for (e.g. \"lifecoach.dev\")."

  validation {
    # Public-suffix domains can be registered but defeat the whole purpose
    # of this module. .run.app, .firebaseapp.com, .web.app, .github.io etc.
    # would land us right back at the original problem.
    condition     = !endswith(var.domain_name, ".run.app") && !endswith(var.domain_name, ".web.app") && !endswith(var.domain_name, ".firebaseapp.com") && !endswith(var.domain_name, ".github.io")
    error_message = "domain_name must not end with a public suffix used elsewhere in the stack (run.app, web.app, firebaseapp.com, github.io). Pick a domain you control end-to-end."
  }
}

variable "region" {
  type        = string
  description = "Cloud Domains region for the registration resource. Use \"global\"."
  default     = "global"
}

variable "registrant_contact" {
  type = object({
    email         = string
    phone_number  = string
    postal_address = object({
      region_code         = string
      postal_code         = string
      administrative_area = string
      locality            = string
      address_lines       = list(string)
      recipients          = list(string)
    })
  })
  description = "Whois registrant contact. Visibility is set to REDACTED_CONTACT_DATA so this never appears in public Whois, but Cloud Domains still needs valid values for verification."
  sensitive   = true
}

variable "yearly_price_units" {
  type        = string
  description = "Expected yearly price in major currency units (\"12\" for $12 USD). Must match Cloud Domains' published price for the TLD; mismatch causes the apply to fail BEFORE billing, which is the correct behaviour — if Google ever changes the price we want a deliberate version bump rather than a silent surprise charge."
  default     = "12"
}

variable "yearly_price_currency" {
  type    = string
  default = "USD"
}

# --- Registration ---------------------------------------------------------

resource "google_clouddomains_registration" "domain" {
  project  = var.project_id
  location = var.region

  domain_name = var.domain_name

  # HSTS-preloaded TLDs (.dev, .app, .page, .foo, .new, ...) require the
  # registrant to explicitly acknowledge that every subdomain is forced
  # to HTTPS by every modern browser. Cloud Domains rejects registration
  # requests for these TLDs without `domain_notices` containing
  # `HSTS_PRELOADED`. The ack is informational — there's nothing to opt
  # out of, HSTS preload is intrinsic to the TLD — but the API still
  # demands it.
  #
  # Non-HSTS TLDs (.com, .io, ...) get an empty list and the field is a
  # no-op. The closed set below is every Google-owned HSTS-preloaded TLD
  # listed at https://hstspreload.org as of 2026-05.
  domain_notices = contains(
    ["dev", "app", "page", "foo", "new", "boo", "rsvp", "channel", "how", "soy", "ing", "meme", "fly", "phd", "prof", "esq", "day", "moe"],
    regex("[^.]+$", var.domain_name)
  ) ? ["HSTS_PRELOADED"] : []

  # `renewal_method` is computed by the provider (Cloud Domains assigns
  # AUTOMATIC_RENEWAL by default; changing it requires the Cloud Domains
  # console). Only `transfer_lock_state` is user-configurable on this
  # block. We lock transfers so the domain can't be moved out from under
  # us without first explicitly unlocking.
  management_settings {
    transfer_lock_state = "LOCKED"
  }

  # Whois data is stored privately and replaced in public lookups with
  # Google's proxy. Without this every registrant is exposed in public
  # Whois — a privacy + spam vector.
  contact_settings {
    privacy = "REDACTED_CONTACT_DATA"

    registrant_contact {
      email        = var.registrant_contact.email
      phone_number = var.registrant_contact.phone_number
      postal_address {
        region_code         = var.registrant_contact.postal_address.region_code
        postal_code         = var.registrant_contact.postal_address.postal_code
        administrative_area = var.registrant_contact.postal_address.administrative_area
        locality            = var.registrant_contact.postal_address.locality
        address_lines       = var.registrant_contact.postal_address.address_lines
        recipients          = var.registrant_contact.postal_address.recipients
      }
    }
    admin_contact {
      email        = var.registrant_contact.email
      phone_number = var.registrant_contact.phone_number
      postal_address {
        region_code         = var.registrant_contact.postal_address.region_code
        postal_code         = var.registrant_contact.postal_address.postal_code
        administrative_area = var.registrant_contact.postal_address.administrative_area
        locality            = var.registrant_contact.postal_address.locality
        address_lines       = var.registrant_contact.postal_address.address_lines
        recipients          = var.registrant_contact.postal_address.recipients
      }
    }
    technical_contact {
      email        = var.registrant_contact.email
      phone_number = var.registrant_contact.phone_number
      postal_address {
        region_code         = var.registrant_contact.postal_address.region_code
        postal_code         = var.registrant_contact.postal_address.postal_code
        administrative_area = var.registrant_contact.postal_address.administrative_area
        locality            = var.registrant_contact.postal_address.locality
        address_lines       = var.registrant_contact.postal_address.address_lines
        recipients          = var.registrant_contact.postal_address.recipients
      }
    }
  }

  # Delegate DNS to the Cloud DNS managed zone created below so we manage
  # records in the same Terraform plan. Cloud Domains pushes these as the
  # registry-level nameserver delegation.
  dns_settings {
    custom_dns {
      name_servers = google_dns_managed_zone.zone.name_servers
    }
  }

  yearly_price {
    units         = var.yearly_price_units
    currency_code = var.yearly_price_currency
  }

  # The registration resource is sticky — destroying it from TF state does
  # not unregister the domain at Cloud Domains. Preventing destroy here
  # blocks accidental `terraform destroy` from removing it from state and
  # losing the connection to the live registration.
  lifecycle {
    prevent_destroy = true
  }
}

# --- DNS managed zone -----------------------------------------------------

resource "google_dns_managed_zone" "zone" {
  project     = var.project_id
  name        = replace(var.domain_name, ".", "-")
  dns_name    = "${var.domain_name}."
  description = "Public DNS zone for ${var.domain_name}. Records managed via Terraform."

  # DNSSEC is required by the .dev TLD policy; on for safety on other TLDs.
  dnssec_config {
    state = "on"
  }
}

# --- Outputs --------------------------------------------------------------

output "domain_name" {
  value       = var.domain_name
  description = "The registered apex domain (e.g. \"lifecoach.dev\")."
}

output "dns_zone_name" {
  value       = google_dns_managed_zone.zone.name
  description = "Cloud DNS managed-zone resource name. Preview env consumes this to create per-PR CNAME records."
}

output "name_servers" {
  value       = google_dns_managed_zone.zone.name_servers
  description = "NS records the registrar points at. Output for debugging — Terraform wires this up via dns_settings.custom_dns automatically."
}
