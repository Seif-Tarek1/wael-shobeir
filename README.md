# اللواء وائل شوبير — تقويم وتذكيرات

تطبيق أندرويد عربي بسيط لإضافة المواعيد والتذكيرات على التقويم، مع تنبيهات في وقتها.

**تحميل التطبيق:** https://seif-tarek1.github.io/wael-shobeir/
(رابط مباشر للملف: https://github.com/Seif-Tarek1/wael-shobeir/releases/latest/download/wael-shobeir.apk)

## المميزات
- تقويم شهري يبدأ بالسبت، مع التاريخ الهجري.
- نوعان: **موعد** (يظهر في التقويم) و**تذكير** (مهمة تُعلَّم عند إنجازها).
- اختيار وقت التنبيه: في الموعد، قبل ١٠ دقائق، ٣٠ دقيقة، ساعة، يوم، أو بدون تذكير.
- التكرار: مرة واحدة، يوميًا، أسبوعيًا، شهريًا.
- يعمل بدون إنترنت، وكل البيانات محفوظة على الهاتف فقط.
- وضع ليلي تلقائي.

## Technical notes (English)
- Web app in `www/` (plain HTML/CSS/JS, no framework, no network access), wrapped with Capacitor 8 for Android.
- Notifications: `@capacitor/local-notifications`, exact alarms (`USE_EXACT_ALARM`), rescheduled on every change and every time the app is opened. Repeating items get their next occurrences scheduled individually (up to 30 each, max 400 total).
- Storage: `@capacitor/preferences` (Android SharedPreferences); all stored data is validated on load.
- Every push to `main` that touches the app builds a signed APK in GitHub Actions and publishes it as the latest GitHub Release.

### Signing key — important
Updates only install over the existing app if they are signed with the **same key**.
The key is **not** in this repository. It lives in the GitHub secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and the original
file is kept offline by the owner. Back it up; if it is lost, users must uninstall and reinstall.

### Local development
```bash
npm ci
npm run fonts                    # copy self-hosted Tajawal font into www/fonts
npx cap sync android             # copy www/ into the Android project
python scripts/make_icons.py     # regenerate launcher/notification icons (needs Pillow)
cd android && ./gradlew assembleDebug
```
Preview the UI in a browser by serving `www/` with any static server.
