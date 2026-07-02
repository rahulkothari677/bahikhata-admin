# Phase 2 (12/22) — A/B Testing

**Page URL:** `/experiments`
**Sidebar location:** Growth group → A/B Testing (flask icon)
**Commit:** `pending`

## What This Feature Does

Experiment framework with control/treatment groups:
- Create experiments with 1 control + 1+ treatment variants
- **Deterministic assignment**: same user always gets same variant (via hash)
- 3 metric types: conversion, revenue, retention
- Traffic allocation (% of users included in experiment)
- Variant weights (must sum to 100)
- Conversion tracking (when user completes goal event)
- Auto-determine winner (highest conversion rate, min 30 users per variant)
- Statistical significance via Z-test for proportions (p < 0.05)

## How It Works

```
1. Admin creates experiment:
   - Name: "Pricing Page Redesign"
   - Metric: conversion
   - Target event: payment
   - Traffic: 100% of users
   - Variants:
     - control (50%): "Default pricing page"
     - treatment_a (50%): "New pricing page with savings highlighted"

2. User visits the app:
   - hash(userId + experimentId) % 100 < trafficPct? → included
   - hash(userId + experimentId + 'variant') % 100 → variant based on weights
   - Assignment stored in ExperimentAssignment (unique per user per experiment)

3. User completes goal (e.g. makes payment):
   - trackConversion(experimentId, userId, conversionValue)
   - Updates convertedAt + conversionValue on assignment

4. Admin views results:
   - Conversion rate per variant (converted / assigned)
   - Winner auto-determined when experiment completed
   - Statistical significance check (min 30 users per variant)
```

## How to Test

### 1. Open the page
- Login to admin panel
- Find **Growth** group in sidebar (amber rocket icon)
- Click **A/B Testing** (flask icon, 4th item)

### 2. Overview tab (default)
- 4 KPI cards: Running Experiments (0), Completed (0), Total Assignments (0), Total Experiments (0)
- **"How A/B testing works"** transparency card

### 3. Create your first experiment
- Click **"+ New Experiment"** (top-right)
- Modal opens (white background)
- Fill in:
  - **Name**: `Pricing Page Test`
  - **Description**: `Testing new pricing layout with savings highlighted`
  - **Metric**: `Conversion Rate`
  - **Goal**: `Increase`
  - **Target Event**: `payment`
  - **Traffic %**: `100`
  - **Start At**: Leave empty (saves as draft) or set to now (starts immediately)
  - **Variants**:
    - Key: `control`, Name: `Default Page`, Weight: `50`
    - Key: `treatment_a`, Name: `New Page`, Weight: `50`
- Click **"Create Experiment"**
- Green toast: "Experiment created"

### 4. View in List tab
- Switch to "All Experiments" tab
- See your experiment with:
  - Status badge: `draft` (grey) or `running` (amber)
  - Metric badge: `Conversion Rate`
  - 2 variants · 100% traffic · 0 assigned
- Click the row → expands to show results (empty initially)

### 5. Start the experiment
- Click the expanded experiment
- Click **"Start Experiment"** button (green)
- Status changes from `draft` to `running` (amber badge)
- New action buttons appear: **Complete & Pick Winner** + **Cancel**

### 6. View results (after users are assigned)
- Once users visit the app, they'll be assigned to variants
- The expanded results section shows:
  - Card per variant with: name, key, assigned count, converted count, conversion rate %, revenue (if revenue metric)
  - Winner badge (🏆) on the variant with highest conversion rate
  - Progress bars showing conversion rate per variant
  - Statistical significance note:
    - Amber ⚠ if < 30 users per variant
    - Green ✓ if ≥ 30 users per variant and significant result

### 7. Complete the experiment
- Click **"Complete & Pick Winner"**
- Optional: enter a conclusion in the prompt dialog
- Status changes to `completed` (green badge)
- Winner badge appears next to experiment name
- Winner variant card gets green highlight + 🏆 trophy icon

### 8. Test filters
- Click "running" pill → only running experiments
- Click "completed" → only completed experiments
- Click "all" → shows all

### 9. Test variant management
- Click "+ New Experiment"
- Click **"+ Add Variant"** → adds treatment_b
- Try removing a variant (X button) — can't remove control
- Change weights — must sum to 100 (error toast if not)

### 10. Test delete
- Click trash icon on any experiment
- Confirm: "Delete experiment X? All assignment data will be lost."
- Experiment + all assignments deleted

## Experiment Lifecycle

```
draft → running → completed
                ↘ cancelled
```

| Status | Color | Meaning |
|--------|-------|---------|
| `draft` | Grey (neutral) | Created but not started |
| `running` | Amber (warning) | Users being assigned, data collecting |
| `completed` | Green (success) | Finished, winner determined |
| `cancelled` | Red (danger) | Stopped early (no winner) |

## Variant Requirements

- Must have exactly 1 variant with key `control`
- At least 2 variants total (control + 1+ treatment)
- Weights must sum to 100
- Variant keys must be unique
- Control variant cannot be removed

## Metric Types

| Metric | Description | Conversion Value |
|--------|-------------|------------------|
| `conversion` | Did user complete the goal event? | 0 or 1 (binary) |
| `revenue` | How much revenue did user generate? | ₹ amount |
| `retention` | Did user return after N days? | 0 or 1 (binary) |

## Statistical Significance

- **Minimum sample size**: 30 users per variant
- **Z-test for proportions**: compares conversion rates between variants
- **p-value thresholds**:
  - p < 0.001: very strong evidence (z > 3.29)
  - p < 0.01: strong evidence (z > 2.58)
  - p < 0.05: statistically significant (z > 1.96)
  - p < 0.10: weak evidence (z > 1.64)
  - p ≥ 0.10: not significant

If results are not significant (p ≥ 0.05), the winner badge won't appear — you need more data.

## Performance at Scale

| Metric | Value |
|--------|-------|
| Overview tab | ~50ms (6 parallel count + findMany) |
| List tab | ~200ms (findMany + results per experiment) |
| Assignment | ~50ms (1 unique lookup + 1 create) |
| Conversion tracking | ~50ms (1 updateMany) |
| Results computation | ~100ms (2 groupBy per experiment) |

## Integration Points

This feature connects to:
- **Main app** (future): `assignUser()` called on user visit, `trackConversion()` called on goal completion
- **Feature Flags** (`/features`): Could use experiment results to auto-enable features for winning variant
- **Campaigns** (`/campaigns`): Could A/B test campaign messaging
