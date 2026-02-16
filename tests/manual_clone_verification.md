# Manual Verification for Campaign Clone Fix

## Objective
Verify that cloning a campaign correctly preserves data and allows editing of the new campaign's name and schedule.

## Prerequisites
1.  Launch the application (`npm run dev`).
2.  Ensure at least one campaign exists (create one if needed).

## Steps

1.  **Clone a Campaign**
    -   Go to the "Campaigns" tab.
    -   Locate an existing campaign (e.g., "Morning Campaign").
    -   Click the **Clone** (Copy) icon/button on the campaign row.

2.  **Verify Step 1: Campaign Details**
    -   **Expected**: The Campaign Wizard opens.
    -   **Expected**: The "Campaign Name" field should be pre-filled with "Morning Campaign (Copy)".
    -   **Action**: Try to edit the name (e.g., change to "Afternoon Clone").
    -   **Expected**: The field should be editable.
    -   **Action**: Check the Schedule/Interval fields.
    -   **Expected**: They should match the original campaign's settings and be editable.

3.  **Verify Step 2: Sources**
    -   Click **Next**.
    -   **Expected**: The list of Sources (Channels/Keywords) and Saved Videos from the original campaign should be present.

4.  **Save the Campaign**
    -   Proceed through the wizard steps.
    -   In Step 5 (Target Accounts), select a publish account.
    -   Click **Save & Close**.

5.  **Verify Creation**
    -   **Expected**: The new campaign "Afternoon Clone" should appear in the campaign list.
    -   **Expected**: It should have the correct status and schedule.
    -   **Action**: Click "Run Now" or wait for the schedule to trigger.
    -   **Expected**: The campaign should start scanning/processing using the preserved sources.

## Technical Context
The fix involved updating `CampaignWizard.tsx` to correctly synchronize the `formData` state with `initialData` when the wizard is opened in "Clone" mode. Previously, only `sources` were synced, leaving the config forms (Name, Schedule) in a stale or default state.
