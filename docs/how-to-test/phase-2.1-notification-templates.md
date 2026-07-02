# Phase 2 (1/22) — Notification Templates

**Page URL:** `/notification-templates`
**Sidebar location:** Engagement group → Notification Templates (bell icon)
**Commit:** `375bc16` (+ fix `9b1824c`, `25449f9`)

## What This Feature Does

Reusable templates for SMS, Email, and Push notifications:
- Create/edit/duplicate/delete templates
- 3 channels: SMS, Email (with subject), Push
- 5 categories: general, payment, onboarding, churn, promotional
- 3 languages: en, hi, bilingual
- Variable substitution: `{{userName}}`, `{{amount}}`, `{{plan}}`, etc. (auto-detected from body)
- Versioning: each edit bumps version (v1 → v2 → v3...)
- Status lifecycle: draft → active → archived
- Live preview with sample variable values
- All actions logged to AuditLog

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Engagement** group in sidebar (pink megaphone icon, between Growth and Users)
- Click **Notification Templates** (bell icon)

### 2. Overview tab (default)
- 4 KPI cards: Total Templates, Active, Drafts, Archived — all 0 on first visit
- **Active Templates by Channel** card — 3 channels (SMS blue, Email violet, Push amber) with 0 counts
- **"How templates work"** transparency card explaining `{{variable}}` syntax + versioning

### 3. Create your first template — SMS
- Click **"+ New Template"** button (top-right)
- Editor modal opens (white background, fully readable)
- Fill in:
  - **Name**: `Payment Reminder SMS`
  - **Channel**: `sms`
  - **Category**: `payment`
  - **Language**: `en`
  - **Status**: `draft`
  - **Body**: `Hi {{userName}}, your payment of ₹{{amount}} is due on {{dueDate}}. Pay now to avoid service interruption. - BahiKhata Pro`
- As you type the body, see below it: **"Detected variables: `{{userName}}` `{{amount}}` `{{dueDate}}`"** (auto-detected)
- Click **"Show Preview"** toggle — shows body with sample values substituted:
  > `Hi Rahul, your payment of ₹1,500 is due on 15 Jul 2026. Pay now to avoid service interruption. - BahiKhata Pro`
- Click **"Create Template"**
- Green toast: "Template saved (v1)"

### 4. Create a second template — Email
- Click "+ New Template" again
- **Name**: `Welcome Email`
- **Channel**: `email`
- **Category**: `onboarding`
- **Subject**: `Welcome to BahiKhata Pro, {{userName}}!`
- **Body**: `Dear {{userName}},\n\nThank you for subscribing to BahiKhata Pro ({{plan}} plan). Your subscription is active until {{dueDate}}.\n\nBest regards,\nBahiKhata Pro Team`
- Note: subject field only appears when channel = email
- Try saving without subject → red toast: "Subject is required for email templates"
- Fill in subject, save → success

### 5. Create a third template — Push
- Channel: `push`, Body: `New invoice {{invoiceNumber}} created for {{shopName}}. Tap to view.`
- Save

### 6. Verify Overview tab updates
- Go back to Overview tab
- Should show: Total=3, Drafts=3, Active=0
- Channel distribution: SMS=0 active, Email=0 active, Push=0 active (all are drafts)

### 7. Activate a template
- Go to "All Templates" tab
- Click the template name to open editor
- Change status from `draft` to `active`
- Click "Update Template" → toast "Template saved (v2)" (version bumped!)
- Go back to Overview → Active count = 1, Drafts = 2

### 8. Test duplicate
- Click the duplicate icon (copy) on any template row
- Editor opens with same content + " (Copy)" suffix + status=draft
- Click "Create Template" → new template created

### 9. Test search
- Type "payment" in search bar → only Payment Reminder SMS shows
- Type "welcome" → only Welcome Email shows

### 10. Test filters
- Click "sms" channel pill → only SMS template shows
- Click "draft" status pill → only draft templates show
- Combine: "email" channel + "active" status → shows active email templates only

### 11. Test delete
- Click trash icon on any template
- Confirmation dialog: `Delete "X"? This cannot be undone.`
- Click OK → template deleted, green toast shown
- Verify in Audit Log page — delete action should be logged

### 12. Test version bumping
- Open any template, change the body, save
- Toast shows "Template saved (v2)" or higher
- Each subsequent edit increments version

### 13. Verify pagination
- Create 25+ templates (or use duplicate)
- Pagination controls appear at bottom of list tab

## Variable Substitution Syntax

Use `{{variableName}}` in body. Variables are auto-detected on save.

Common variables:
- `{{userName}}` — user's name
- `{{userEmail}}` — user's email
- `{{amount}}` — payment amount
- `{{plan}}` — subscription plan (free/pro/elite)
- `{{dueDate}}` — payment due date
- `{{shopName}}` — user's shop name
- `{{invoiceNumber}}` — invoice number

## Sample Preview Values

| Variable | Sample Value |
|----------|--------------|
| userName | Rahul |
| amount | 1,500 |
| plan | Pro |
| dueDate | 15 Jul 2026 |
| shopName | Sharma Kirana |
| invoiceNumber | INV-001 |

## Chrome Force-Dark Fix

If the modal appears dark/unreadable ("sunglasses glass" effect):
1. Fixed in commits `9b1824c` + `25449f9`
2. Added `color-scheme: light` to CSS + HTML meta tag
3. Modal uses explicit `style={{ backgroundColor: '#ffffff' }}`
4. If still happening: check `chrome://flags/#enable-force-dark` is disabled
