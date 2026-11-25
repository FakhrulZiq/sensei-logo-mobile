# SenSei Catalog for Android

A small Android admin app for bank and brand names, colours, aliases, categories and logos. The interface is bundled in the APK; it is not hosted on a web server. Catalog data is saved through the existing `sensei-be` API, and changes reach the main app after **Publish changes**.

## Setup

1. Run `npm install` in this directory.
2. Copy `.env.example` to `.env`. Set the public Firebase web configuration from the same Firebase project used by `sensei-rn`. `VITE_API_URL` points to the existing API. These values are bundled at build time.
3. The Firebase Android app uses package ID `my.sensei.logo.app`. Keep its downloaded `google-services.json` in this directory. `npm run android:sync` copies it to `android/app/` before syncing. Add your debug or release SHA-1 fingerprint to this Firebase Android app; Google sign-in must be enabled for the project.
4. Grant your Google account the backend `ADMIN` custom claim using `sensei-be`'s `npm run admin:set -- your@email.com`. Sign out and back in to refresh the claim.
5. The Android project is already generated and its Google sign-in Gradle flags are set. Run `npm run android:sync` and `npm run android:open` to build or run with Android Studio. A debug APK is produced by running `cd android && ./gradlew assembleDebug`.

After edits, use `npm run android:sync` to copy a fresh web build into the Android project. For a browser preview, run `npm run dev`; the development origin must be included in the API's `CORS_ORIGINS`.

The Android build uses Capacitor's native HTTP adapter, so the installed app does not need a CORS entry. It does need network access to Firebase and the SenSei API. Logos are limited to PNG, JPEG, or WebP files of 2 MB or less by the existing backend.

## Release builds

Run `npm run android:release` to build a signed APK and Android App Bundle. The outputs are `android/app/build/outputs/apk/release/app-release.apk` and `android/app/build/outputs/bundle/release/app-release.aab`.

The signing key and its password are in `.release/sensei-logo-release.jks` and `.release/signing.properties`. Both are ignored by Git. **Back up both files securely**; keep them together to sign future updates to directly installed APKs. Do not publish the keystore or signing properties. The release certificate's SHA-1 and SHA-256 have been registered in Firebase for Google sign-in. If you distribute through Google Play App Signing, also register the Play Console **app signing certificate** fingerprints in Firebase, since Play signs the APK delivered to users with that certificate.
