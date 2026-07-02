# Phase 2 (21/22) — Admin Team Management

**Page URL:** `/admin-users`
**Sidebar location:** Users group → Admin Team (users icon)
**Commit:** `pending`

## What This Feature Does

Multi-admin management with 3 role levels:
- **Founder**: full access, can manage admin team, cannot be deleted/modified by others
- **Admin**: full access to all pages, cannot manage admin team
- **Viewer**: read-only access, for auditors/investors/consultants
- Create new admins (founder only)
- Change roles (admin ↔ viewer, cannot assign/revoke founder)
- Activate/deactivate (founder only, cannot self-deactivate)
- Delete (founder only, cannot delete founders or self)
- View last login time + IP + 2FA status

## 3 Role Permissions

| Permission | Founder | Admin | Viewer |
|-----------|---------|-------|--------|
| View all pages | ✓ | ✓ | ✓ |
| Create/edit/delete data | ✓ | ✓ | ✗ |
| Manage admin team | ✓ | ✗ | ✗ |
| Manage founder accounts | ✓ | ✗ | ✗ |
| Can be deleted | ✗ | ✓ | ✓ |
| Can be deactivated | ✗ (by self only) | ✓ | ✓ |

## How to Test

### 1. Open the page
- Login → Users group → **Admin Team** (users icon, 2nd item)
- ⚠️ If your role is not "founder", you'll see "Access Denied" page

### 2. Overview tab (founder only)
- 4 KPI cards: Founders, Admins, Viewers, 2FA Enabled
- **Role Permissions** card — explains what each role can do
- **Security Best Practices** amber card

### 3. Click "All Admins" tab
- Table with: Name (+email), Role, Status (toggle), 2FA, Last Login (time + IP), Actions (delete)
- Founders show red "Founder" badge (immutable)
- Admins/Viewers show dropdown to change role
- Active/inactive toggle switch (founders can't be toggled)

### 4. Create a new admin
- Click **"+ New Admin"**
- Modal opens (white background)
- Fill in: Email, Name, Password (min 8 chars), Role (admin or viewer)
- Click "Create Admin"
- Green toast: "Admin user created"

### 5. Change role
- In the list, find a non-founder admin
- Change dropdown from "Admin" to "Viewer" (or vice versa)
- Green toast: "Admin user updated"

### 6. Deactivate (not delete)
- Click the green toggle on any non-founder admin
- Toggle turns grey → account deactivated (can't login)
- Click again → reactivated

### 7. Delete an admin
- Click trash icon on any non-founder admin
- Confirm → admin permanently deleted
- Cannot delete founders or your own account

### 8. Test access denial (if you have a viewer/admin account)
- Login as a non-founder admin
- Navigate to /admin-users → see "Access Denied" page
- All API calls return 403 Forbidden

### 9. Verify audit trail
- Audit Log → `admin_user_create`, `admin_user_update`, `admin_user_delete` actions

## Security Features

- **Founder-only access**: API checks `role === 'founder'` on every endpoint (403 otherwise)
- **Cannot create founders via API**: only admin/viewer roles can be assigned
- **Cannot modify other founders**: protected even from other founders
- **Cannot self-deactivate**: prevents locking yourself out
- **Cannot delete self or founders**: prevents accidental lockout
- **Password hashing**: bcrypt with 12 rounds
- **2FA status visible**: see which admins have TOTP enabled
- **Last login tracking**: IP + timestamp for security monitoring
