# BMFlight Product Specification

## Summary
BMFlight is a public, mobile-first web interface at `https://texflow.work/BMFlight` that helps Blue Mountains residents understand and discuss low aircraft movements over the region, especially flights connected to Western Sydney International Airport at Badgerys Creek.

The initial implementation should expand `sydney_bluemountains_adsb_tracker.html` into a polished community platform with a live aircraft map, flight detail panels, shareable flight reports, and a signed-in community forum.

## Goals
- Show live and recently observed aircraft over Sydney, the Blue Mountains, Penrith, and Western Sydney Airport.
- Help residents quickly identify low-altitude or noisy overflights.
- Let users select a flight on the map and share a report with flight details, time, altitude, and their own comment.
- Provide a respectful community forum where signed-in residents can discuss flights and local impacts.
- Work well on mobile first, with a clean white and green visual theme and smooth, lightweight animations.

## Non-Goals
- BMFlight is not an official airport, ATC, or government service.
- BMFlight should not claim exact noise levels unless verified noise data is later integrated.
- BMFlight should not expose private user email addresses or phone numbers publicly.
- BMFlight should not allow anonymous forum posting.

## Target Users
- Blue Mountains residents who want to understand aircraft passing overhead.
- Local community groups discussing Western Sydney Airport flight paths.
- Residents who want to record and share specific low or loud aircraft events.
- Visitors and journalists looking for a readable view of aircraft activity over the region.

## Route and Placement
- Public page route: `/BMFlight`
- Recommended static entry point: `public/BMFlight/index.html`
- Server route should support:
  - `GET /BMFlight`
  - `GET /BMFlight/`
- Existing prototype source: `sydney_bluemountains_adsb_tracker.html`

## Visual Direction
BMFlight should feel calm, civic, and local rather than technical or military.

Theme:
- Background: white and soft off-white.
- Primary: eucalyptus green.
- Secondary: deep forest green.
- Accent: sky blue for live aircraft and alert states.
- Warning: amber/orange for low-altitude or notable reports.
- Text: near-black, with muted grey-green secondary text.

Hero:
- Use this image cleanly as the hero image:
  `https://garyphayes.photography/wp-content/uploads/2017/01/Gallery-Govett-SR-1600px-21.jpg`
- Display it as a wide, responsive Blue Mountains hero with a subtle green overlay for text readability.
- Hero copy should clearly explain the service in plain language:
  "Track low flights over the Blue Mountains."
- Include primary calls to action:
  - "View live map"
  - "Report a flight"
  - "Join the forum"

Animation:
- Smooth section entrance animations.
- Gentle aircraft marker movement between updates.
- Drawer and modal transitions should use short, non-distracting easing.
- Respect `prefers-reduced-motion`.

## Responsive Layout
Mobile is the priority.

Mobile:
- Hero at top, map directly below.
- Map should fill most of the viewport height but leave space for controls.
- Flight details open as a bottom sheet.
- Forum and report flows use full-screen or near-full-screen sheets.
- Touch targets should be at least 44px high.

Tablet/Desktop:
- Map and flight details can sit side-by-side.
- Forum can appear below the map or in a right-side community panel.
- Filters can be visible in a top toolbar.

## Live Map Requirements
The map should build from the current Leaflet prototype.

Data source:
- Initial source: `https://api.airplanes.live/v2/point/{lat}/{lon}/{radius_nm}`
- Current prototype uses:
  - Centre latitude: `-33.87`
  - Centre longitude: `151.21`
  - Radius: `120 nm`
- Recommended future centre should be reviewed for better Blue Mountains and Western Sydney Airport coverage.

Map features:
- Show aircraft with heading-aware icons.
- Show Blue Mountains region marker.
- Show Western Sydney International Airport / Badgerys Creek marker.
- Show Sydney Kingsford Smith marker only as context.
- Refresh data every 15 seconds by default.
- Include manual refresh with loading state.
- Include last updated timestamp.
- Include visible count of aircraft.

Flight marker states:
- Normal aircraft.
- Low altitude aircraft.
- Selected aircraft.
- Aircraft with emergency/squawk status.
- Aircraft likely approaching or departing WSI, if identifiable later.

Suggested low-altitude display logic:
- Under 5,000 ft: highlight as "low".
- Under 3,000 ft: highlight as "very low".
- Ground state should be distinct and not treated as low overflight.
- These thresholds should be configurable.

## Flight Detail Panel
When a user clicks or taps a flight, open a details panel.

Show:
- Callsign or ICAO hex.
- Registration.
- Aircraft type.
- Altitude.
- Ground speed.
- Track/heading.
- Vertical speed.
- Squawk.
- ADS-B source.
- Latitude/longitude.
- Last observed time.
- Link to view the aircraft on airplanes.live.

Add community context:
- "Share this flight" button.
- "Report low altitude" quick action.
- "Report loud noise" quick action.
- "Discuss in forum" button.

## Share Flight Feature
Users should be able to create a shareable flight report from a selected flight.

Flow:
1. User selects an aircraft on the map.
2. User taps "Share this flight".
3. BMFlight opens a share/report panel prefilled with flight details.
4. User can add a short comment.
5. User chooses one or more tags.
6. User submits or shares via native share sheet.

Suggested tags:
- Extremely low altitude
- Loud noise
- Frequent overflight
- Night flight
- Early morning flight
- Concerned resident
- General observation

Report content should include:
- User comment.
- Tags.
- Aircraft callsign/hex.
- Registration and type when available.
- Altitude at time of report.
- Speed and heading.
- Approximate location.
- Timestamp.
- Source attribution.
- Public share URL if stored server-side.

Native sharing:
- Use `navigator.share` when available.
- Fallback to copy-to-clipboard.
- Fallback text should be readable in SMS, email, and social media.

Example share text:
```text
BMFlight report: Aircraft QFA123 over the Blue Mountains at 2,850 ft, 245 kts, heading 276°. Comment: "Extremely low altitude and loud noise." Viewed at 2026-06-07 20:15 AEST. https://texflow.work/BMFlight/report/{id}
```

## Forum Requirements
BMFlight should include a local community forum.

Forum capabilities:
- Public read access.
- Sign-in required to comment or create a post.
- Posts can be attached to a specific flight report.
- Users can create general discussion posts.
- Users can reply to posts.
- Basic moderation controls should be planned from the start.

Forum categories:
- Low flights
- Noise reports
- WSI airport updates
- Questions
- Community notices

Comment requirements:
- Signed-in users only.
- Users must agree to Privacy Policy and Terms and Conditions during signup.
- Comments should show username and timestamp.
- Comments should not show email address.
- Include report/delete moderation path.

Moderation:
- Hide or remove abusive comments.
- Rate-limit posting.
- Prevent spammy duplicate comments.
- Keep audit metadata server-side.

## Authentication and Signup
Users need an account to comment or post.

Signup fields:
- Email address.
- Username.
- Password or passwordless magic link.
- Required checkbox: "I agree to the Privacy Policy."
- Required checkbox: "I agree to the Terms and Conditions."

Recommended auth model:
- Email plus passwordless magic link for simplicity.
- Session cookie with `HttpOnly`, `Secure`, and `SameSite=Lax`.
- Username uniqueness check.
- Email verification before posting.

User profile:
- Public username.
- Private email.
- Created timestamp.
- Terms accepted timestamp.
- Privacy policy accepted timestamp.

## Privacy and Terms
The signup flow must require consent to standard Privacy Policy and Terms and Conditions.

Minimum privacy notes:
- Store email for authentication and account recovery.
- Store username for public posts.
- Store comments and reports the user submits.
- Store timestamps, IP-derived abuse metadata, and basic moderation logs.
- Do not publish email addresses.
- Allow users to request account deletion.

Required links:
- `/privacy-policy`
- `/terms-and-conditions`

## API Requirements
Recommended server API surface:

Public:
- `GET /api/bmflight/aircraft`
- `GET /api/bmflight/reports`
- `GET /api/bmflight/reports/:id`
- `GET /api/bmflight/forum/posts`
- `GET /api/bmflight/forum/posts/:id`

Authenticated:
- `POST /api/bmflight/reports`
- `POST /api/bmflight/forum/posts`
- `POST /api/bmflight/forum/posts/:id/comments`
- `POST /api/bmflight/forum/comments/:id/report`

Auth:
- `POST /api/bmflight/auth/signup`
- `POST /api/bmflight/auth/login`
- `POST /api/bmflight/auth/logout`
- `GET /api/bmflight/auth/me`

## Data Model
Suggested storage can start as JSON files, matching the current repo style, then move to SQLite/Postgres if usage grows.

User:
- `id`
- `email`
- `username`
- `password_hash` or magic-link identity fields
- `email_verified_at`
- `privacy_accepted_at`
- `terms_accepted_at`
- `created_at`

Flight report:
- `id`
- `created_at`
- `created_by_user_id`, optional for native share-only drafts
- `comment`
- `tags`
- `aircraft_hex`
- `callsign`
- `registration`
- `aircraft_type`
- `altitude_ft`
- `ground_speed_kts`
- `track_deg`
- `vertical_rate_fpm`
- `squawk`
- `lat`
- `lon`
- `observed_at`
- `source`

Forum post:
- `id`
- `title`
- `body`
- `category`
- `created_by_user_id`
- `related_report_id`
- `created_at`
- `updated_at`
- `status`

Forum comment:
- `id`
- `post_id`
- `body`
- `created_by_user_id`
- `created_at`
- `status`

## Accessibility
- Use semantic landmarks: header, main, nav, section, footer.
- Ensure all map controls are keyboard accessible.
- Provide text alternatives for important map information.
- Ensure contrast passes WCAG AA.
- Use focus traps in modal/sheet UI.
- Announce refresh/error states with `aria-live`.
- Avoid relying on colour alone for low-altitude status.

## Performance
- Keep the first page load lightweight.
- Lazy-load forum content below the map.
- Debounce refresh and prevent API spam.
- Cache the last successful aircraft response briefly.
- Avoid rendering aircraft without coordinates.
- Use marker updates instead of full map reinitialisation.

## Reliability and Safety
- Show friendly error state if airplanes.live is unavailable or rate-limiting.
- Include clear data source attribution.
- Include disclaimer that live ADS-B data can be delayed, incomplete, or inaccurate.
- Never make safety-critical claims.
- Do not encourage users to contact pilots or interfere with aviation operations.

## Initial Implementation Milestones
1. Create `/BMFlight` static page from the current tracker.
2. Apply white/green responsive design and hero image.
3. Add mobile bottom-sheet flight details.
4. Add share/report panel with comment and tags.
5. Add basic report persistence and public report pages.
6. Add signup/login with required privacy and terms consent.
7. Add forum posts and comments behind sign-in.
8. Add moderation/reporting basics.

## Open Questions
- Should reports be public immediately, or require moderation first?
- Should users be able to post anonymously to the public while still being known to moderators?
- Should BMFlight store historical aircraft snapshots, or only user-submitted reports?
- What exact Blue Mountains boundary should be highlighted on the map?
- What low-altitude threshold should be used for community alerts?
- Should WSI-specific flight path overlays be added once official routes are available?
