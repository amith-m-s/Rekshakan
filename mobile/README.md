# RescuerMap Resident Android App

The Expo SDK 57 resident app connects directly to the two free Render services:

- Rescue workflow API: `https://rescuermap-rset.onrender.com`
- Live statewide data: `https://rescuermap-dashboard-rset.onrender.com`

## Demo login

- Email: `resident@rescuermap.local`
- Password: `Demo123!`

## Features

- Resident authentication with persisted local session
- Active incident and request status
- Two-step location-aware help request
- Safe check-in
- Live evacuation zones, FIRMS hotspot count, and shelters
- Link to the complete interactive statewide map
- Free Render cold-start timeout and retry guidance

## Development

```sh
npm install
npm start
```

For a native Android development build, run `npm run android`.

## Standalone APK

Generate the native project once with `npx expo prebuild --platform android`, then build:

```sh
ANDROID_HOME="$HOME/Library/Android/sdk" npm run build:apk
```

The release APK is written to `android/app/build/outputs/apk/release/app-release.apk`.
The `android/` directory and generated APKs are intentionally ignored; the Expo configuration and source are committed.
