# How the App Works — Capacitor vs Web Wrapper vs Updates

**Purpose:** Simple explanation of how the app works, what Capacitor is, iOS support, and how updates work.

**Last updated:** July 3, 2026

---

## 1. What Is Capacitor / Web Wrapper?

Your app has two parts:

1. **Web app (the real code):** Runs on Vercel at `bahikhata-pro.vercel.app`. This is where all the actual logic lives — database, AI, UI, everything.

2. **Capacitor (the frame):** An Android/iOS app that loads your web app inside a native WebView. It adds native features (camera, haptics, share) that browsers can't access.

```
┌─────────────────────────────┐
│  BahiKhata Pro (App Icon)   │  ← Users download this from Play Store
│  ┌───────────────────────┐  │
│  │                       │  │
│  │   Your web app        │  │  ← Loads from Vercel every time app opens
│  │   (same as browser)   │  │     Always gets the latest version
│  │                       │  │
│  └───────────────────────┘  │
│  [Camera] [Haptics] [Share] │  ← Native features via Capacitor plugins
└─────────────────────────────┘
```

### Website vs App:

| | Website (browser) | Capacitor App |
|---|---|---|
| How to open | Type URL in Chrome | Tap app icon |
| Camera access | Limited | Full access |
| Haptic feedback | No | Yes (vibration) |
| File sharing | Limited | Full (WhatsApp, email, etc.) |
| Push notifications | No | Yes (with FCM) |
| Offline mode | Yes (service worker) | Yes (same) |
| Home screen icon | No (bookmark only) | Yes (real app icon) |
| Play Store discovery | No | Yes |

---

## 2. iOS Support

| Platform | Status | What You Need |
|----------|--------|--------------|
| Android | ✅ Ready to build | Android Studio (Windows/Mac/Linux) |
| iOS | ⚠️ Code ready, needs Mac to build | Mac + Xcode + Apple Developer ($99/year) |

**For now: Start with Android** (95% of Indian market). Add iOS later.

---

## 3. How Updates Work (Most Important)

### For code changes (95% of updates):

**Just deploy to Vercel. ALL devices update automatically.**

```
You change code → git push → Vercel deploys (2 min) → ALL users get update
```

- Android users: see update on next app open
- iPhone users: see update on next app open
- Browser users: see update on next page refresh

**No Play Store update needed. No App Store update needed. No manual action.**

### When you need to rebuild APK (5% of updates):

| Change | Rebuild APK? |
|--------|-------------|
| Add/remove/fix web features | ❌ No — Vercel deploy |
| Change UI/colors/text | ❌ No — Vercel deploy |
| Fix bugs | ❌ No — Vercel deploy |
| Change database/API | ❌ No — Vercel deploy |
| Change app name or icon | ✅ Yes — native config |
| Add new Android permission | ✅ Yes — native manifest |
| Update Capacitor plugins | ✅ Yes — native dependency |
| Increase version for Play Store | ✅ Yes — version code |

---

## 4. Why This Approach Is Better Than Native

| Native App (Java/Swift) | Capacitor (Our approach) |
|------------------------|-------------------------|
| Every change → rebuild → Play Store → wait 1-3 days | Every change → Vercel → live in 2 min |
| Users must update from Play Store | Users get update automatically |
| Android + iOS = 2 separate codebases | Same code for both platforms |
| Bug fix takes days to reach users | Bug fix takes minutes |

**Same approach used by:** Instagram Lite, Facebook Lite, Twitter Lite, many Indian fintech apps.
