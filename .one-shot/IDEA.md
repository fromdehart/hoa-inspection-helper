# Idea — hoa-inspection-helper

Received: Sun Mar 22 01:39:12 AM EDT 2026

AI Property Inspection & Compliance Platform — V1 Plan

⸻

1. Product Overview

A mobile-first system that allows inspectors to:
 • Select preloaded properties (via CSV)
 • Capture photos (front / side / back)
 • Move seamlessly house-to-house using a “Next” workflow
 • Use AI to detect violations based on configurable rules

Admins can:
 • Define rules via simple text inputs
 • Generate structured reports and letters from templates
 • Track compliance and resolution

Homeowners can:
 • View violations with photo evidence
 • Upload proof of fixes
 • Get AI-assisted verification

⸻

2. Admin Backend (Web App)

A. Property Management (CSV Upload)

Upload a CSV with:
 • Address (required)
 • Unit (optional)
 • Parcel/Class ID (optional)

Behavior:
 • Properties are grouped automatically by street
 • These become selectable in the inspector app
 • No GPS or OCR needed

⸻

B. AI Configuration (3 Text Areas)
 1. Violation Detection Rules
Freeform text describing what to look for (e.g., rotting wood, peeling paint, missing gutters)
 2. Approved Colors
Defines acceptable exterior colors
 3. HOA / Community Guidelines
Additional rules like trash visibility, lawn maintenance, etc.

These are passed directly into the AI prompt.

⸻

C. Template Management

Admins define structured templates.

Report Template (internal):
 • Address
 • Inspection date
 • Violations
 • Photos

Letter Template (external):
 • Opening (static)
 • Violations (dynamic list of AI-generated descriptions)
 • Closing (static with deadlines and instructions)

AI does not generate full letters—only the violation descriptions.

⸻

D. Dashboard
 • View all properties
 • Filter by status (not started, in progress, completed)
 • View violations and inspection history
 • Drill into each property

⸻

E. Review and Send
 • Admin reviews AI-detected violations
 • Edits if needed
 • Generates report and letter from template
 • Sends to homeowner

⸻

3. Inspector Mobile App

A. Street-Based Navigation

Home screen shows streets:
 • Abner Ave
 • Maple Dr
 • Oak Ct

Each street expands into a list of houses.

⸻

B. Street View

Properties are ordered:
Odds descending, then evens ascending

This matches real walking patterns:
 • Walk down one side of the street
 • Turn around and come back

⸻

C. Property Row

Each row shows:
 • Address
 • Status indicators for:
 • Front
 • Side
 • Back

Each indicator shows:
 • Filled (photo exists)
 • Empty (no photo yet)

⸻

D. Property Detail Screen

Sections:
 • Front
 • Side
 • Back

Each section allows:
 • Viewing thumbnails
 • Adding photos

Optional:
 • Speech-to-text notes attached to the property or photos

⸻

E. Next House Flow (Core Feature)

Inside a property:
 • Primary button: Next

When tapped:
 • Saves current property automatically
 • Opens next property in sequence
 • Camera is ready immediately

Also shows:
“Next: [address]”

This allows continuous inspection without returning to the list.

⸻

F. Completion Logic

No required sections.

Status is based on activity:
 • Not started: no photos
 • In progress: some photos
 • Complete: photos taken and submitted

⸻

4. AI Processing Layer

Inputs:
 • All images for the property
 • Speech-to-text notes (if any)
 • Admin-configured rules (3 text areas)

⸻

Processing:
 1. Detect issues in images
 2. Interpret rules based on admin text
 3. Generate structured output:
 • Description
 • Location (front/side/back)
 • Severity
 • Linked image

⸻

Before/After Comparison:

When homeowner uploads proof:
 • AI compares original vs new image
 • Outputs:
 • Resolved
 • Not resolved
 • Needs review

⸻

5. Homeowner Portal

A. View Violations
 • Address
 • List of issues
 • Photo evidence
 • Clear descriptions

⸻

B. Upload Fix
 • Upload photo
 • Optional note

⸻

C. AI Verification
 • Compares before/after
 • Shows:
 • Resolved
 • Not resolved
 • Needs review

⸻

D. Transparency
 • View full inspection history
 • Download report

⸻

6. End-to-End Workflow

Inspection:
 1. Inspector selects street
 2. Opens first house
 3. Takes photos
 4. Taps Next
 5. Continues through entire street
