# ArcGIS Developer API Access Playbook

This document is written for an automation agent that can browse the web and
complete signup forms. Follow the numbered checklist verbatim to register our
ArcGIS Developer account, generate an API key, and report the results back to
us. Do not improvise beyond the steps unless you encounter an unexpected
interface that prevents completion.

## Credentials to use

* **Email:** `kevin@sideapps.dev`
* **Password:** `Chat123$Forever`

Only use these credentials for the ArcGIS Developer portal. Do not reuse them
elsewhere.

## Signup and verification workflow

1. Open https://developers.arcgis.com/sign-up/ in a desktop browser session.
2. Start the registration flow for a new ArcGIS Developer account.
3. When prompted for contact information:
   * Use the email address `kevin@sideapps.dev`.
   * Choose a display name that clearly references "SideApps" (for example,
     "SideApps Automation").
   * Accept the developer terms of use and any privacy notices.
4. If the site offers social login options, ignore them and continue with the
   standard email-based signup.
5. When the password field appears, set it to `Chat123$Forever`.
6. Submit the form and wait for confirmation that the account was created.
7. If the portal requires email verification:
   * Pause your execution and notify the user that a verification message was
     sent to `kevin@sideapps.dev`.
   * Wait for explicit user feedback that the email was processed before
     continuing.
8. After verification (if required), sign in to https://developers.arcgis.com/
   with the same email and password to confirm that the credentials work.

## Generating the API key

1. While signed in, navigate to https://developers.arcgis.com/dashboard/.
2. Click **New API key** (or **Create API key** if the button text differs).
3. Fill in the form with the following values:
   * **Name:** `SideApps Summit County Scraper`
   * **Description:** Mention that the key will be used by the Summit County
     rental data scraper.
4. Under **Capabilities** or **Privileges**, enable the scopes required for
   hosted feature layers (usually labeled **Location services** or "Access to
   premium content"). Leave other scopes disabled.
5. Submit the form and wait for the confirmation screen that shows the generated
   key value.
6. Copy the API key and store it in your working memory until you can report it
   back to the user. Do **not** paste the key into public channels or source
   files.
7. Confirm whether the dashboard displays usage or quota information. Capture a
   short summary (e.g., remaining credit balance, default rate limits).

## Final report for the user

When all steps succeed, send a summary that includes:

1. Confirmation that the account was created and verified (if applicable).
2. Confirmation that you can sign in with the provided credentials.
3. The generated API key value.
4. Any relevant notes about rate limits, capability scopes, or follow-up actions
   required from the user.
5. A screenshot of the dashboard page showing the API key details, if the
   tooling you control allows it. Ensure the screenshot only contains
   non-sensitive information or blur the API key before capturing.

If any step fails, stop immediately, describe what happened, and wait for
further instructions.
