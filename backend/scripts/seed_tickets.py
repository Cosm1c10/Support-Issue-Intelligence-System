"""
seed_tickets.py
===============
One-time seeding script for the Support Ticket Issue Intelligence System.

What this script does:
  1. Generates 80 realistic mock support tickets spread across 7 issue categories
  2. Distributes timestamps over the past 60 days to simulate real ticket flow
     — some categories trend UP, some DOWN, some STABLE (for trend detection demo)
  3. Calls OpenAI text-embedding-3-small to generate a 1536-dim vector per ticket
  4. Upserts all tickets into Supabase (idempotent — safe to re-run)
  5. Runs K-Means clustering (k=7) on the stored embeddings
  6. Uses GPT to name each cluster from its top representative tickets
  7. Calculates prev/current 30-day window counts → assigns Increasing/Decreasing/Stable
  8. Stores cluster metadata + membership back to Supabase

Usage:
  pip install -r requirements.txt
  cp .env.example .env          # fill in your keys
  python scripts/seed_tickets.py

Re-seeding:
  Tables are truncated before insert so the script is idempotent.
  Use  --skip-truncate  to append without truncating.
"""

import os
import sys
import time
import json

# Force UTF-8 output on Windows terminals (CP1252 doesn't support Unicode symbols)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
import argparse
import random
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import numpy as np
from openai import OpenAI
from supabase import create_client, Client
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]   # service-role key (bypasses RLS)
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

EMBEDDING_MODEL = "text-embedding-3-small"   # 1536 dims, cheap, accurate
CHAT_MODEL      = "gpt-4o-mini"              # for cluster naming

N_CLUSTERS = 7          # number of issue clusters
WINDOW_DAYS = 30        # days per trend window
TREND_THRESHOLD = 0.25  # >25% change → Increasing / Decreasing

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client    = OpenAI(api_key=OPENAI_KEY)


# ──────────────────────────────────────────────────────────────
# Mock Ticket Dataset
# Each entry carries a `_category` (internal label) and a
# `_days_ago` (how many days before today the ticket was filed).
# The category + timestamp spread is what drives trend detection.
# ──────────────────────────────────────────────────────────────
#
# Trend design:
#   network_connectivity  → INCREASING  (prev: 4, curr: 11)
#   billing_payment       → STABLE      (prev: 6, curr: 6)
#   app_crashes           → DECREASING  (prev: 8, curr: 3)
#   login_auth            → INCREASING  (prev: 3, curr: 8)
#   data_loss_sync        → STABLE      (prev: 4, curr: 4)
#   performance           → STABLE      (prev: 5, curr: 5)
#   feature_requests      → DECREASING  (prev: 4, curr: 2)
#
RAW_TICKETS = [

    # ────────── NETWORK CONNECTIVITY (4 prev + 11 curr = 15) ──────────
    {"_category": "network_connectivity", "_days_ago": 58,
     "subject": "Cannot connect to application server",
     "description": "I've been unable to connect to the application server since this morning. Getting connection timeout errors constantly. The issue happens on multiple devices and networks.",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 52,
     "subject": "Persistent SaaS connectivity issues",
     "description": "Our team is experiencing persistent connectivity issues with the SaaS platform. The connection drops randomly every 30 minutes and we lose all unsaved work.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 45,
     "subject": "VPN connectivity failure after update",
     "description": "After the latest software update the VPN connectivity to our company servers stopped working entirely. Cannot access internal resources remotely.",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 38,
     "subject": "API calls timing out intermittently",
     "description": "API calls to the platform are timing out intermittently. About 1 in 5 requests fails with a connection timeout. This is affecting our production integrations.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    # --- current window starts (≤ 30 days ago) ---
    {"_category": "network_connectivity", "_days_ago": 28,
     "subject": "Application disconnects every few minutes",
     "description": "The application keeps disconnecting from the server every few minutes. We get kicked out and have to log back in repeatedly. This started happening 3 days ago.",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 26,
     "subject": "Unable to maintain stable connection to platform",
     "description": "Unable to maintain a stable connection to the platform. Network logs show repeated TCP resets. Our IT team confirmed this is on the server side, not ours.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 23,
     "subject": "WebSocket connection drops on dashboard",
     "description": "The WebSocket connection to the live dashboard keeps dropping. Real-time updates stop working and the page shows stale data. Hard refresh doesn't fix it.",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 20,
     "subject": "Network latency spiking to 5000ms",
     "description": "Network latency on the platform has been spiking to 5000ms+ regularly. Tasks that normally complete in 1 second now take several minutes or fail outright.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 16,
     "subject": "Connection reset errors in browser console",
     "description": "Getting ERR_CONNECTION_RESET errors in the browser console when trying to use the platform. Cleared cache, tried different browsers, different networks — same issue.",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 12,
     "subject": "SSH tunnel to server not establishing",
     "description": "The SSH tunnel required for secure access to the platform is failing to establish. Getting 'Connection refused' after the handshake. Worked fine last week.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 9,
     "subject": "Platform unreachable from multiple regions",
     "description": "Multiple users across different geographic regions are reporting that the platform is completely unreachable. Getting DNS resolution failures and connection refusals.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 6,
     "subject": "Packet loss causing data corruption",
     "description": "Severe packet loss (40%+) on the platform connection is causing data corruption and failed uploads. Our monitoring tools confirm the packet loss begins at your CDN edge.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 3,
     "subject": "Load balancer returning 503 errors",
     "description": "The load balancer is intermittently returning 503 Service Unavailable errors. This happens under normal load, not even peak traffic. Affects all API consumers.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 2,
     "subject": "TLS handshake failures on HTTPS connections",
     "description": "TLS handshake is failing on all HTTPS connections to the production endpoint. SSL certificate appears to have expired or been misconfigured after last night's deployment.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"_category": "network_connectivity", "_days_ago": 1,
     "subject": "Complete platform outage for enterprise tier",
     "description": "All enterprise tier customers are experiencing a complete platform outage. None of our 200+ users can access any features. We need immediate escalation.",
     "priority": "Critical", "ticket_type": "Outage", "product_area": "Connectivity"},


    # ────────── BILLING / PAYMENT (6 prev + 6 curr = 12, STABLE) ──────────
    {"_category": "billing_payment", "_days_ago": 55,
     "subject": "Charged twice for the same subscription",
     "description": "I was charged twice for my monthly subscription on the same billing date. Please refund the duplicate charge immediately. Order IDs: INV-4821 and INV-4822.",
     "priority": "High", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 48,
     "subject": "Invoice shows wrong plan pricing",
     "description": "My invoice for this month shows the Enterprise plan price but I downgraded to Professional last month. The billing portal also still shows Enterprise. Please correct and refund.",
     "priority": "Medium", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 42,
     "subject": "Payment declined but account shows active",
     "description": "My card payment was declined by my bank (confirmed by bank — no issue on their side) but my account still shows as active. Worried this will cause a sudden suspension.",
     "priority": "Medium", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 36,
     "subject": "Unable to update payment method",
     "description": "The billing settings page throws a 500 error when I try to update my credit card details. I've tried 3 different cards. My current card expires soon — urgent.",
     "priority": "High", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 33,
     "subject": "Promo code discount not applied to invoice",
     "description": "I used promo code LAUNCH30 during signup which should give 30% off for 3 months. My first invoice shows full price. Please apply the discount retroactively.",
     "priority": "Low", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 31,
     "subject": "Tax exempt status not reflected in billing",
     "description": "We submitted our tax exemption certificate last month but our invoices continue to include tax charges. We need corrected invoices for our accounting records.",
     "priority": "Medium", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 25,
     "subject": "Annual plan charged monthly by mistake",
     "description": "I signed up for the annual plan but I'm being charged monthly. This has happened for 3 months. Please correct to annual billing and refund the overcharges.",
     "priority": "High", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 20,
     "subject": "Currency conversion discrepancy on invoice",
     "description": "My invoice shows a USD amount but I'm charged in EUR. The exchange rate used appears to be outdated by 2 months, resulting in me paying significantly more than expected.",
     "priority": "Medium", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 14,
     "subject": "Refund not received after 30 days",
     "description": "I requested a refund 30 days ago after cancelling my subscription (ticket #REF-2291). The refund was approved but has not appeared on my statement. Please investigate.",
     "priority": "High", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 10,
     "subject": "Seat count billed does not match active users",
     "description": "We're being billed for 25 seats but only have 18 active users in the admin panel. We removed 7 users last billing cycle. Please correct and credit the difference.",
     "priority": "Medium", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 5,
     "subject": "Invoice not generated for last month",
     "description": "No invoice was generated for our account last month despite the charge appearing on our credit card. We need the invoice for our accounts payable records immediately.",
     "priority": "Medium", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"_category": "billing_payment", "_days_ago": 2,
     "subject": "Enterprise discount applied incorrectly",
     "description": "Our enterprise contract specifies a 40% volume discount but invoices only reflect 25%. This has been ongoing for 4 months. Requesting a full audit and retroactive credit.",
     "priority": "High", "ticket_type": "Billing Issue", "product_area": "Billing"},


    # ────────── APPLICATION CRASHES (8 prev + 3 curr = 11, DECREASING) ──────────
    {"_category": "app_crashes", "_days_ago": 60,
     "subject": "App crashes on startup after latest update",
     "description": "After installing the latest update (v2.4.1) the application crashes immediately on startup with a segmentation fault. Rolling back to v2.4.0 resolves the issue.",
     "priority": "Critical", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 57,
     "subject": "Dashboard crashes when loading large datasets",
     "description": "The dashboard crashes with an out-of-memory error when loading datasets over 500MB. This worked fine in the previous version. Memory usage spikes to 12GB before crash.",
     "priority": "High", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 53,
     "subject": "Mobile app freezes and force closes",
     "description": "The iOS mobile app freezes on the 'My Projects' screen and then force closes. This happens every time, making the mobile app completely unusable on iPhone 15 Pro.",
     "priority": "Critical", "ticket_type": "Bug Report", "product_area": "Mobile"},

    {"_category": "app_crashes", "_days_ago": 49,
     "subject": "Export to PDF triggers application crash",
     "description": "Exporting any report to PDF causes the application to crash and lose the current session. The exported file is never created. Affects all report types.",
     "priority": "High", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 46,
     "subject": "Browser tab crashes on data visualization page",
     "description": "The browser tab crashes (out of memory) on the advanced data visualization page when there are more than 10,000 data points. Chrome and Firefox both affected.",
     "priority": "High", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 41,
     "subject": "Application hangs indefinitely on search",
     "description": "Performing a full-text search with more than 3 filter conditions causes the application to hang indefinitely. Have to kill the browser tab to recover.",
     "priority": "High", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 37,
     "subject": "Crash when importing CSV with special characters",
     "description": "Importing a CSV file containing special characters (é, ü, ñ) causes an unhandled exception and crashes the import wizard. No error message is shown.",
     "priority": "Medium", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 32,
     "subject": "Real-time collaboration causes frequent crashes",
     "description": "When 5 or more users edit a document simultaneously the application crashes for all participants. Losing unsaved collaborative work is a critical business problem.",
     "priority": "Critical", "ticket_type": "Bug Report", "product_area": "Collaboration"},

    # current window — fewer crashes (fix deployed)
    {"_category": "app_crashes", "_days_ago": 22,
     "subject": "Occasional crash on project creation",
     "description": "Intermittent crash when creating a new project with a name longer than 50 characters. Not reproducible every time but occurs maybe 1 in 10 attempts.",
     "priority": "Medium", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 11,
     "subject": "App crashes after extended idle period",
     "description": "After leaving the app open overnight the session token appears to expire in a way that crashes the app rather than redirecting to login. Intermittent but annoying.",
     "priority": "Low", "ticket_type": "Bug Report", "product_area": "Application"},

    {"_category": "app_crashes", "_days_ago": 4,
     "subject": "Widget rendering crash on custom dashboards",
     "description": "A specific widget type (Gauge Chart v2) causes a crash when added to custom dashboards. Other widget types appear to work fine. Stack trace sent separately.",
     "priority": "Medium", "ticket_type": "Bug Report", "product_area": "Application"},


    # ────────── LOGIN / AUTHENTICATION (3 prev + 8 curr = 11, INCREASING) ──────────
    {"_category": "login_auth", "_days_ago": 56,
     "subject": "SSO login fails with SAML error",
     "description": "SAML-based SSO login is failing with error: 'Assertion validation failed — audience mismatch'. Our IdP configuration has not changed. Urgent for enterprise access.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 44,
     "subject": "2FA codes not being accepted",
     "description": "Time-based 2FA codes from Google Authenticator are being rejected even though my device clock is synced. I'm completely locked out of my account.",
     "priority": "High", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 34,
     "subject": "Password reset email never arrives",
     "description": "Requested a password reset email multiple times but it never arrives. Checked spam folder. The email used is the same one that receives marketing emails from your service.",
     "priority": "Medium", "ticket_type": "Access Issue", "product_area": "Authentication"},

    # current window — auth issues spiking
    {"_category": "login_auth", "_days_ago": 27,
     "subject": "OAuth Google login returns 400 error",
     "description": "Sign in with Google OAuth is returning a 400 Bad Request error: 'redirect_uri_mismatch'. This broke overnight — we haven't changed our OAuth configuration.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 23,
     "subject": "Session expires too frequently",
     "description": "User sessions are expiring every 10–15 minutes even with 'Remember me' checked. This is causing constant disruption for our team members who need extended sessions.",
     "priority": "High", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 19,
     "subject": "Multiple failed login attempts despite correct password",
     "description": "Receiving 'Invalid credentials' errors when logging in with the correct password. Account is not locked (checked with admin panel). Clearing cookies/cache doesn't help.",
     "priority": "High", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 15,
     "subject": "New user invite links expired before use",
     "description": "Invite links sent to new team members are showing as expired even though they were sent just 2 hours ago. The invite expiry appears to be misconfigured.",
     "priority": "Medium", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 10,
     "subject": "Active Directory sync stopped working",
     "description": "AD sync for automatic user provisioning has stopped working. New employees added to AD are not being created in the platform. Last successful sync was 5 days ago.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 6,
     "subject": "Biometric login fails on Android app",
     "description": "Fingerprint / Face ID login on the Android app stopped working after the last app update. Falling back to password works but biometric auth is completely broken.",
     "priority": "High", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 2,
     "subject": "LDAP authentication broken after server migration",
     "description": "After migrating our LDAP server to a new host the platform can no longer authenticate users against it. Updated the LDAP settings but still getting bind errors.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"_category": "login_auth", "_days_ago": 1,
     "subject": "All admin users locked out after permission update",
     "description": "After applying a permission policy update all admin users are locked out of the admin panel. Regular users can still log in. This is a full admin access outage.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},


    # ────────── DATA LOSS / SYNC (4 prev + 4 curr = 8, STABLE) ──────────
    {"_category": "data_loss_sync", "_days_ago": 54,
     "subject": "Saved changes not persisting after session end",
     "description": "Any changes saved during a session are lost after logging out and back in. The save confirmation is shown but the data reverts to the previous state on reload.",
     "priority": "Critical", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 47,
     "subject": "Cloud sync not updating across devices",
     "description": "Changes made on desktop are not syncing to mobile and vice versa. Sync status shows 'Up to date' on both devices but content is different. Sync has been broken for 4 days.",
     "priority": "High", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 40,
     "subject": "Bulk import lost half the records",
     "description": "After a bulk CSV import of 5,000 records only 2,347 appeared in the system with no error message. The missing records contain critical customer data.",
     "priority": "Critical", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 33,
     "subject": "Deleted files reappearing after sync",
     "description": "Files I deleted reappear after each sync cycle. Have deleted the same files 5 times. Sync seems to restore them from an older snapshot each time.",
     "priority": "High", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 22,
     "subject": "Database backup restore failed silently",
     "description": "Restoring from a database backup appeared to succeed (no errors) but the restored data is from 3 weeks before the backup date. Critical recent data is missing.",
     "priority": "Critical", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 16,
     "subject": "Real-time collaboration data conflicts not resolving",
     "description": "When two users edit the same field simultaneously the conflict resolution algorithm is sometimes discarding one user's changes entirely without warning.",
     "priority": "High", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 8,
     "subject": "Export contains fewer rows than displayed in UI",
     "description": "Exporting a dataset shows 8,432 rows in the preview but the downloaded CSV only contains 6,100 rows. Data is being silently truncated on export.",
     "priority": "High", "ticket_type": "Data Issue", "product_area": "Data Management"},

    {"_category": "data_loss_sync", "_days_ago": 3,
     "subject": "Webhook events not being delivered",
     "description": "Webhook events configured for 'record.updated' stopped being delivered 3 days ago. Our downstream integrations are all out of sync as a result.",
     "priority": "High", "ticket_type": "Data Issue", "product_area": "Data Management"},


    # ────────── PERFORMANCE / SLOWNESS (5 prev + 5 curr = 10, STABLE) ──────────
    {"_category": "performance", "_days_ago": 59,
     "subject": "Dashboard takes 45 seconds to load",
     "description": "The main dashboard is taking 45 seconds to load on first visit. This only started after the recent infrastructure migration. Our previous SLA was sub-3-second load times.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Dashboard"},

    {"_category": "performance", "_days_ago": 50,
     "subject": "Report generation hangs on large date ranges",
     "description": "Generating reports for date ranges over 6 months causes the system to hang. The spinner spins indefinitely and the report never appears. Smaller ranges work fine.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Reporting"},

    {"_category": "performance", "_days_ago": 43,
     "subject": "Search results take 30+ seconds to appear",
     "description": "Full-text search now takes 30+ seconds to return results. Previously it was near-instant. Our team relies on search constantly and this is severely impacting productivity.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Search"},

    {"_category": "performance", "_days_ago": 35,
     "subject": "Slow API response times degrading integrations",
     "description": "API response times have degraded from ~200ms to 8-12 seconds for all endpoints. Our third-party integrations are timing out and failing as a result.",
     "priority": "Critical", "ticket_type": "Performance Issue", "product_area": "API"},

    {"_category": "performance", "_days_ago": 32,
     "subject": "Autocomplete suggestions very slow to appear",
     "description": "Autocomplete suggestions in search and form fields take 5–8 seconds to appear, making them useless in practice. Network tab shows the autocomplete endpoint is the bottleneck.",
     "priority": "Medium", "ticket_type": "Performance Issue", "product_area": "Application"},

    {"_category": "performance", "_days_ago": 24,
     "subject": "Image uploads taking minutes instead of seconds",
     "description": "Uploading images (even small 500KB files) is taking 3–5 minutes. Drag and drop upload progress bar shows upload speed of ~5KB/s. Used to be fast.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "File Management"},

    {"_category": "performance", "_days_ago": 17,
     "subject": "Notification emails delayed by hours",
     "description": "Email notifications are being delivered 3–6 hours after the triggering event. For time-sensitive alerts this makes them useless.",
     "priority": "Medium", "ticket_type": "Performance Issue", "product_area": "Notifications"},

    {"_category": "performance", "_days_ago": 11,
     "subject": "Calendar view extremely slow with many events",
     "description": "The calendar view becomes completely unresponsive when displaying more than 200 events in a month. Scrolling and clicking events takes 10+ seconds to respond.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Calendar"},

    {"_category": "performance", "_days_ago": 7,
     "subject": "Bulk operations timing out at 100+ records",
     "description": "Bulk update / delete operations fail with a timeout error when selecting more than 100 records. The operation completes partially, leaving data in an inconsistent state.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Application"},

    {"_category": "performance", "_days_ago": 2,
     "subject": "Memory leak causing browser slowdown over time",
     "description": "After leaving the application open for 2+ hours browser memory usage grows to 4GB+, causing severe system slowdown. A page refresh temporarily resolves it.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Application"},


    # ────────── FEATURE REQUESTS (4 prev + 2 curr = 6, DECREASING) ──────────
    {"_category": "feature_requests", "_days_ago": 58,
     "subject": "Request: Dark mode for the dashboard",
     "description": "Please add a dark mode option for the dashboard. Working late at night the bright white UI is very straining on the eyes. Many of our team members have requested this.",
     "priority": "Low", "ticket_type": "Feature Request", "product_area": "UI/UX"},

    {"_category": "feature_requests", "_days_ago": 51,
     "subject": "Request: Bulk CSV export with custom columns",
     "description": "We need the ability to export custom column selections to CSV. Currently the export includes all columns. Please add column selection to the export dialog.",
     "priority": "Low", "ticket_type": "Feature Request", "product_area": "Reporting"},

    {"_category": "feature_requests", "_days_ago": 44,
     "subject": "Request: Keyboard shortcuts for common actions",
     "description": "Please add keyboard shortcuts for common actions like creating new records (Ctrl+N), saving (Ctrl+S), and searching (Ctrl+K). Power users would benefit greatly.",
     "priority": "Low", "ticket_type": "Feature Request", "product_area": "UI/UX"},

    {"_category": "feature_requests", "_days_ago": 36,
     "subject": "Request: Scheduled report delivery via email",
     "description": "We need the ability to schedule automatic report delivery to email recipients on a recurring basis (daily, weekly, monthly). Currently we have to manually export and send.",
     "priority": "Medium", "ticket_type": "Feature Request", "product_area": "Reporting"},

    {"_category": "feature_requests", "_days_ago": 21,
     "subject": "Request: Multi-language support for the interface",
     "description": "Our team includes members from France, Germany, and Japan. Please add multi-language support or at minimum French and German translations for the interface.",
     "priority": "Low", "ticket_type": "Feature Request", "product_area": "Internationalization"},

    {"_category": "feature_requests", "_days_ago": 8,
     "subject": "Request: Two-factor authentication backup codes",
     "description": "Please provide backup/recovery codes for 2FA. Currently if a user loses access to their authenticator app they are completely locked out with no recovery path.",
     "priority": "Medium", "ticket_type": "Feature Request", "product_area": "Authentication"},
]


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def days_ago(n: int) -> datetime:
    """Return a datetime exactly n days before now, with slight random jitter."""
    jitter_hours = random.uniform(-4, 4)
    return now_utc() - timedelta(days=n, hours=jitter_hours)

def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Batch-embed a list of texts using OpenAI text-embedding-3-small.
    Respects the 2048-token per item limit by chunking.
    Rate-limits at ~1000 tokens/sec for free-tier safety.
    """
    print(f"  Generating embeddings for {len(texts)} texts …")
    embeddings = []
    batch_size = 20  # OpenAI allows up to 2048 items but we stay conservative

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = openai_client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch,
        )
        batch_embeddings = [item.embedding for item in response.data]
        embeddings.extend(batch_embeddings)
        print(f"    Embedded {min(i + batch_size, len(texts))}/{len(texts)}")
        if i + batch_size < len(texts):
            time.sleep(0.3)  # polite rate limiting

    return embeddings


def name_cluster(ticket_subjects: list[str]) -> tuple[str, str]:
    """
    Use GPT to produce a short cluster name and one-sentence description
    from the most representative ticket subjects.
    Returns (name, description).
    """
    subjects_text = "\n".join(f"- {s}" for s in ticket_subjects[:6])
    prompt = (
        "You are an expert at categorizing customer support tickets.\n"
        "Given the following support ticket subjects from a single issue cluster, "
        "provide:\n"
        "1. A short, clear issue name (3–5 words, title case, no punctuation)\n"
        "2. A one-sentence description of the underlying problem\n\n"
        f"Ticket subjects:\n{subjects_text}\n\n"
        "Respond in JSON with keys 'name' and 'description' only."
    )
    response = openai_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    data = json.loads(response.choices[0].message.content)
    return data["name"], data["description"]


def calculate_trend(prev: int, curr: int) -> str:
    """
    Compare two time-window counts and return trend label.
    Uses a ±25% threshold to avoid noise triggering spurious trends.
    """
    if prev == 0:
        return "Increasing" if curr > 0 else "Stable"
    ratio = (curr - prev) / prev
    if ratio > TREND_THRESHOLD:
        return "Increasing"
    elif ratio < -TREND_THRESHOLD:
        return "Decreasing"
    return "Stable"


# ──────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────

def truncate_tables():
    print("\n[1/6] Truncating existing data …")
    supabase.table("cluster_members").delete().neq("ticket_id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("issue_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("tickets").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("   Done.")


def insert_tickets_with_embeddings() -> list[dict]:
    print(f"\n[2/6] Inserting {len(RAW_TICKETS)} tickets with embeddings …")

    # Build text to embed: combine subject + description for richer signal
    embed_inputs = [
        f"{t['subject']}. {t['description']}" for t in RAW_TICKETS
    ]
    embeddings = embed_texts(embed_inputs)

    rows = []
    for i, ticket in enumerate(RAW_TICKETS):
        row = {
            "ticket_id":    f"TKT-{1000 + i}",
            "subject":      ticket["subject"],
            "description":  ticket["description"],
            "priority":     ticket["priority"],
            "ticket_type":  ticket["ticket_type"],
            "product_area": ticket["product_area"],
            "status":       "Open",
            "created_at":   days_ago(ticket["_days_ago"]).isoformat(),
            "embedding":    embeddings[i],
        }
        rows.append(row)

    # Upsert in batches of 20
    batch_size = 20
    inserted_rows = []
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        result = supabase.table("tickets").upsert(batch, on_conflict="ticket_id").execute()
        inserted_rows.extend(result.data)
        print(f"   Upserted {min(i + batch_size, len(rows))}/{len(rows)} tickets")

    print(f"   ✓ {len(inserted_rows)} tickets inserted.")
    return inserted_rows


def parse_embedding(value) -> list[float]:
    """
    Supabase Python client returns pgvector columns as a JSON string like '[0.1, 0.2, ...]'.
    Parse it into a Python list of floats if necessary.
    """
    if isinstance(value, str):
        return json.loads(value)
    return value  # already a list


def fetch_tickets_with_embeddings() -> tuple[list[dict], np.ndarray]:
    """Fetch all tickets + embeddings from Supabase for clustering."""
    print("\n[3/6] Fetching embeddings from Supabase for clustering …")
    result = supabase.table("tickets").select("id, ticket_id, subject, description, priority, product_area, created_at, embedding").execute()
    tickets = result.data
    matrix = np.array([parse_embedding(t["embedding"]) for t in tickets], dtype=np.float32)
    print(f"   Fetched {len(tickets)} tickets, embedding matrix shape: {matrix.shape}")
    return tickets, matrix


def run_kmeans_clustering(
    tickets: list[dict],
    matrix: np.ndarray,
) -> dict[int, list[dict]]:
    """
    Run K-Means on L2-normalised embeddings (equivalent to cosine K-Means).
    Returns a dict mapping cluster_label → list of ticket dicts.
    """
    print(f"\n[4/6] Running K-Means (k={N_CLUSTERS}) on embeddings …")
    normalised = normalize(matrix, norm="l2")

    km = KMeans(
        n_clusters=N_CLUSTERS,
        init="k-means++",
        n_init=10,
        random_state=42,
    )
    labels = km.fit_predict(normalised)
    centroids = km.cluster_centers_   # already on unit sphere (approx)

    cluster_map: dict[int, list[dict]] = {i: [] for i in range(N_CLUSTERS)}
    for ticket, label in zip(tickets, labels):
        ticket["_cluster_label"] = int(label)
        cluster_map[int(label)].append(ticket)

    for label, members in cluster_map.items():
        print(f"   Cluster {label}: {len(members)} tickets")

    return cluster_map, centroids


def build_and_store_clusters(
    cluster_map: dict[int, list[dict]],
    centroids: np.ndarray,
    cutoff_date: datetime,
) -> None:
    """
    For each K-Means cluster:
      1. Name it via GPT
      2. Compute prev / curr window counts for trend detection
      3. Insert into issue_clusters
      4. Insert member rows into cluster_members
    """
    print(f"\n[5/6] Naming clusters and calculating trends …")

    window_start = cutoff_date - timedelta(days=WINDOW_DAYS)     # prev window start
    window_mid   = cutoff_date - timedelta(days=WINDOW_DAYS)     # boundary (30 days ago)

    for label, members in cluster_map.items():
        # ── Name cluster via GPT ─────────────────────────────
        subjects = [m["subject"] for m in members]
        name, description = name_cluster(subjects)
        print(f"   Cluster {label} → \"{name}\"")

        # ── Trend detection ──────────────────────────────────
        prev_count = sum(
            1 for m in members
            if datetime.fromisoformat(m["created_at"]) < window_mid
        )
        curr_count = sum(
            1 for m in members
            if datetime.fromisoformat(m["created_at"]) >= window_mid
        )
        trend = calculate_trend(prev_count, curr_count)
        print(f"     prev={prev_count}  curr={curr_count}  trend={trend}")

        # ── Compute centroid as list ─────────────────────────
        centroid = centroids[label].tolist()

        # ── Insert cluster ───────────────────────────────────
        cluster_result = supabase.table("issue_clusters").insert({
            "name":               name,
            "description":        description,
            "ticket_count":       len(members),
            "prev_window_count":  prev_count,
            "curr_window_count":  curr_count,
            "trend":              trend,
            "centroid_embedding": centroid,
            "updated_at":         now_utc().isoformat(),
        }).execute()
        cluster_id = cluster_result.data[0]["id"]

        # ── Insert cluster membership ────────────────────────
        member_rows = [
            {
                "ticket_id":       m["id"],
                "cluster_id":      cluster_id,
                "similarity_score": 1.0,   # could refine with actual cosine similarity
            }
            for m in members
        ]
        supabase.table("cluster_members").insert(member_rows).execute()

        time.sleep(0.5)  # be polite to OpenAI rate limits between cluster naming calls

    print(f"   ✓ {N_CLUSTERS} clusters stored.")


def print_summary():
    print("\n[6/6] Summary")
    result = supabase.rpc("get_clusters_with_tickets").execute()
    for cluster in result.data:
        arrow = {"Increasing": "⬆", "Decreasing": "⬇", "Stable": "→"}.get(cluster["trend"], "→")
        print(
            f"  {arrow} {cluster['name']}  "
            f"({cluster['ticket_count']} tickets | "
            f"prev={cluster['prev_window_count']} curr={cluster['curr_window_count']} | "
            f"{cluster['trend']})"
        )
    print()


# ──────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Seed the Support Ticket Intelligence System")
    parser.add_argument(
        "--skip-truncate", action="store_true",
        help="Append tickets without truncating existing data"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  Support Ticket Intelligence System — Seeder")
    print("=" * 60)

    if not args.skip_truncate:
        truncate_tables()

    inserted = insert_tickets_with_embeddings()
    tickets, matrix = fetch_tickets_with_embeddings()
    cluster_map, centroids = run_kmeans_clustering(tickets, matrix)

    cutoff = now_utc()
    build_and_store_clusters(cluster_map, centroids, cutoff)
    print_summary()

    print("=" * 60)
    print("  Seeding complete! Supabase is ready.")
    print("  Next: set up the Next.js frontend and confirm.")
    print("=" * 60)


if __name__ == "__main__":
    main()
